import { useEffect, useMemo, useState } from 'react';
import type { ScanRootConfigItem } from '../types/fileCheck';
import type { EpisodeSummary, ProjectMemberSummary, ProjectSummary, ProjectWorkspace } from '../types/project';
import type { EpisodeMutationResponse, ProjectInitializationResult, ProjectMutationResponse } from '../types/ipc';
import { useProjectStore } from '../stores/projectStore';
import { projectService, getDataSource } from '../services/repositoryService';
import { useDataSourceStore } from '../stores/dataSourceStore';
import { apiClient } from '../api/client';

const PROJECT_MEMBER_ROLE_OPTIONS = [
  { code: 'producer', label: '制片' },
  { code: 'director', label: '导演' },
  { code: 'maker', label: '制作人员' },
] as const;

type ProjectMemberRoleCode = typeof PROJECT_MEMBER_ROLE_OPTIONS[number]['code'];

const PROJECT_MEMBER_ROLE_CODES = PROJECT_MEMBER_ROLE_OPTIONS.map((option) => option.code);

type AvailableUserItem = {
  userId: string;
  userName: string;
  displayName: string;
  roles?: string[];
  isActive?: boolean;
};

type ProjectMemberDraft = {
  userId: string;
  projectRoleCode: string;
};

type ProjectMemberItem = {
  projectMemberId: string;
  projectCode: string;
} & ProjectMemberSummary;

function normalizeRoleCode(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase();
  const matchedRole = PROJECT_MEMBER_ROLE_OPTIONS.find((option) => option.label === value?.trim());

  return matchedRole?.code ?? normalized;
}

function getProjectMemberRoleLabel(value: string | null | undefined): string {
  const normalized = normalizeRoleCode(value);
  return PROJECT_MEMBER_ROLE_OPTIONS.find((option) => option.code === normalized)?.label ?? value ?? '制作人员';
}

function getAvailableUserProjectRole(user: AvailableUserItem | undefined): ProjectMemberRoleCode {
  const matchedRole = user?.roles
    ?.map((role) => normalizeRoleCode(role))
    .find((role): role is ProjectMemberRoleCode => PROJECT_MEMBER_ROLE_CODES.includes(role as ProjectMemberRoleCode));

  return matchedRole ?? 'maker';
}

function getAvailableUserDisplayName(user: AvailableUserItem | undefined): string {
  if (!user) {
    return '未知成员';
  }

  return user.displayName?.trim() || user.userName?.trim() || '未命名成员';
}

/**
 * ProjectPage 组件的属性接口
 */
interface ProjectPageProps {
  /** 项目就绪后的回调函数（可选） */
  onProjectReady?: () => void;
}

function emptyMutation(): ProjectMutationResponse {
  return { success: true };
}

function emptyEpisodeMutation(): EpisodeMutationResponse {
  return { success: true };
}

function getInitializationStatusLabel(status?: ProjectInitializationResult['status']): string {
  switch (status) {
    case 'not_requested':
      return '未执行';
    case 'skipped':
      return '已跳过';
    case 'success':
      return '成功';
    case 'partial_success':
      return '部分完成';
    case 'failed':
      return '失败';
    default:
      return '未执行';
  }
}

function getInitializationStatusTone(status?: ProjectInitializationResult['status']): string {
  switch (status) {
    case 'success':
      return 'success-copy';
    case 'partial_success':
      return 'warning-copy';
    case 'skipped':
      return 'warning-copy';
    case 'not_requested':
      return 'muted';
    case 'failed':
      return 'danger-copy';
    default:
      return 'muted';
  }
}

function summarizeMutationResult(result: { success: boolean; initResult?: ProjectInitializationResult; message?: string; error?: string }): string {
  if (!result.success) {
    return result.error ?? '项目创建失败';
  }

  if (!result.initResult) {
    return result.message ?? '项目创建成功，未返回初始化结果。';
  }

  const details: string[] = [];
  if (typeof result.initResult.createdLensCount === 'number') {
    details.push(`镜头落库 ${result.initResult.createdLensCount}`);
  }
  if (typeof result.initResult.lensFoldersPlanned === 'number' || typeof result.initResult.lensFoldersCreated === 'number') {
    details.push(`文件夹 ${result.initResult.lensFoldersCreated ?? 0}/${result.initResult.lensFoldersPlanned ?? 0}`);
  }
  if ((result.initResult.pendingClientActions?.length ?? 0) > 0) {
    details.push(`待处理 ${result.initResult.pendingClientActions?.join(', ')}`);
  }

  return `${getInitializationStatusLabel(result.initResult.status)}：${result.initResult.message}${details.length > 0 ? `（${details.join(' · ')})` : ''}`;
}

function createRootItem(fileKind: 'ma' | 'layout'): ScanRootConfigItem {
  return {
    rootId: crypto.randomUUID(),
    fileKind,
    label: '',
    absolutePath: '',
    priority: 100,
    isEnabled: true,
  };
}

function getRootConflictMessage(lensRoots: ScanRootConfigItem[], layoutRoots: ScanRootConfigItem[]): string | null {
  const normalizedLensRoots = lensRoots
    .filter((item) => item.isEnabled && item.absolutePath.trim())
    .map((item) => item.absolutePath.trim());
  const normalizedLayoutRoots = layoutRoots
    .filter((item) => item.isEnabled && item.absolutePath.trim())
    .map((item) => item.absolutePath.trim());

  for (const lensPath of normalizedLensRoots) {
    for (const layoutPath of normalizedLayoutRoots) {
      const normalizedLens = normalizeComparablePath(lensPath);
      const normalizedLayout = normalizeComparablePath(layoutPath);
      if (normalizedLens === normalizedLayout) {
        return `检测到镜头根目录与 Layout 根目录重复：${lensPath}`;
      }

      if (normalizedLayout.startsWith(`${normalizedLens}\\`) || normalizedLens.startsWith(`${normalizedLayout}\\`)) {
        return `检测到镜头根目录与 Layout 根目录存在包含关系：镜头 ${lensPath} ↔ Layout ${layoutPath}`;
      }
    }
  }

  return null;
}

function normalizeComparablePath(value: string): string {
  return value.replace(/[\\/]+/g, '\\').replace(/[\\/]+$/, '').toUpperCase();
}

export function ProjectPage({ onProjectReady }: ProjectPageProps) {
  const { activeProjectId, activeEpisodeId, projects, setWorkspace, setCurrentProjectMembers: setCachedProjectMembers } = useProjectStore();
  const { dataSource, setDataSource } = useDataSourceStore();
  /**
   * 剧项目名称状态和设置器
   * 存储用户输入的剧项目名称
   */
  const [projectName, setProjectName] = useState('');
  /**
   * 项目根目录状态和设置器
   * 存储用户选择的项目根目录路径
   */
  const [projectRootPath, setProjectRootPath] = useState('');
  const [projectDefaultFps, setProjectDefaultFps] = useState('30');
  /**
   * 首集编号状态和设置器
   * 存储用户输入的首集编号，默认为EP01
   */
  const [initialEpisodeCode, setInitialEpisodeCode] = useState('EP01');
  /**
   * 首集名称状态和设置器
   * 存储用户输入的首集名称（可选）
   */
  const [initialEpisodeName, setInitialEpisodeName] = useState('');
  /**
   * 首集初始化Excel路径状态和设置器
   * 存储用户选择的首集初始化Excel文件路径（可选）
   */
  const [initExcelPath, setInitExcelPath] = useState('');
  /**
   * 镜头根目录配置状态和设置器
   * 存储镜头文件的根目录配置列表，初始包含一个MA类型的根目录
   */
  const [lensRoots, setLensRoots] = useState<ScanRootConfigItem[]>([createRootItem('ma')]);
  /**
   * Layout根目录配置状态和设置器
   * 存储Layout文件的根目录配置列表，初始包含一个layout类型的根目录
   */
  const [layoutRoots, setLayoutRoots] = useState<ScanRootConfigItem[]>([createRootItem('layout')]);
  /**
   * 新增集编号状态和设置器
   * 存储用户输入的新增集编号
   */
  const [episodeCode, setEpisodeCode] = useState('');
  /**
   * 新增集名称状态和设置器
   * 存储用户输入的新增集名称（可选）
   */
  const [episodeName, setEpisodeName] = useState('');
  /**
   * 新增集初始化Excel路径状态和设置器
   * 存储用户选择的新增集初始化Excel文件路径（可选）
   */
  const [episodeInitExcelPath, setEpisodeInitExcelPath] = useState('');
  /**
   * 新增集镜头根目录配置状态和设置器
   * 存储新增集的镜头文件根目录配置列表，初始包含一个MA类型的根目录
   */
  const [episodeLensRoots, setEpisodeLensRoots] = useState<ScanRootConfigItem[]>([createRootItem('ma')]);
  /**
   * 新增集Layout根目录配置状态和设置器
   * 存储新增集的Layout文件根目录配置列表，初始包含一个layout类型的根目录
   */
  const [episodeLayoutRoots, setEpisodeLayoutRoots] = useState<ScanRootConfigItem[]>([createRootItem('layout')]);
  /**
   * 集列表状态和设置器
   * 存储当前项目的所有集摘要信息
   */
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  /**
   * 项目操作结果状态和设置器
   * 用于显示项目创建、删除等操作的结果
   */
  const [result, setResult] = useState<ProjectMutationResponse>(emptyMutation);
  /**
   * 集操作结果状态和设置器
   * 用于显示集创建等操作的结果
   */
  const [episodeResult, setEpisodeResult] = useState<EpisodeMutationResponse>(emptyEpisodeMutation);
  /**
   * 是否正在提交表单的状态和设置器
   * 表示项目或集的创建/删除操作正在进行中
   */
  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * 已展开的项目ID列表状态和设置器
   * 存储当前在UI中展开以显示详细信息的项目ID列表
   */
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  /**
   * 已展开的集ID列表状态和设置器
   * 存储当前在UI中展开以显示详细信息的集ID列表
   */
  const [expandedEpisodeIds, setExpandedEpisodeIds] = useState<string[]>([]);
  /**
   * 已复制的路径状态和设置器
   * 存储用户最近复制的路径，用于显示"已复制"状态
   */
  const [copiedPath, setCopiedPath] = useState<string>('');
  /**
   * 可选用户列表状态（用于项目成员选择）
   * 存储可以添加为项目成员的用户列表
   */
  const [availableUsers, setAvailableUsers] = useState<AvailableUserItem[]>([]);
  /**
   * 选中的项目成员用户ID列表状态
   * 存储创建项目时选中的成员用户ID
   */
  const [selectedMembers, setSelectedMembers] = useState<ProjectMemberDraft[]>([]);
  /**
   * 用户列表加载状态
   */
  const [usersLoading, setUsersLoading] = useState(false);
  /**
   * 当前项目成员列表
   */
  const [currentProjectMembers, setCurrentProjectMembers] = useState<ProjectMemberItem[]>([]);
  /**
   * 当前项目成员加载状态
   */
  const [projectMembersLoading, setProjectMembersLoading] = useState(false);
  /**
   * 当前项目新增成员时选中的用户ID
   */
  const [selectedProjectMemberUserId, setSelectedProjectMemberUserId] = useState<string>('');
  /**
   * 当前项目新增成员时选中的角色
   */
  const [selectedProjectMemberRole, setSelectedProjectMemberRole] = useState<string>('maker');
  /**
   * 激活失败后的项目根目录重定位项目ID
   */
  const [activationRetryProjectId, setActivationRetryProjectId] = useState<string | null>(null);
  /**
   * 激活失败后的项目根目录重定位路径
   */
  const [activationRetryProjectRootPath, setActivationRetryProjectRootPath] = useState('');

  /**
   * 当前激活的项目对象（备忘录）
   * 根据activeProjectId从projects列表中查找对应的项目，如果没找到则返回null
   * 依赖activeProjectId和projects的变化
   */
  const activeProject = useMemo(() => projects.find((entry) => entry.projectId === activeProjectId) ?? null, [activeProjectId, projects]);
  const selectedMemberSummaries = useMemo(() => selectedMembers.map((member) => {
    const user = availableUsers.find((entry) => entry.userId === member.userId);

    return {
      ...member,
      displayName: getAvailableUserDisplayName(user),
      userName: user?.userName ?? '',
      roleLabel: getProjectMemberRoleLabel(member.projectRoleCode),
    };
  }), [availableUsers, selectedMembers]);
  const availableUsersByRole = useMemo(() => PROJECT_MEMBER_ROLE_OPTIONS.map((role) => ({
    ...role,
    users: availableUsers.filter((user) => getAvailableUserProjectRole(user) === role.code),
  })).filter((group) => group.users.length > 0), [availableUsers]);
  /**
   * 当前激活的集对象（备忘录）
   * 根据activeEpisodeId从episodes列表中查找对应的集，如果没找到则返回null
   * 依赖activeEpisodeId和episodes的变化
   */
  const activeEpisode = useMemo(() => episodes.find((entry) => entry.episodeId === activeEpisodeId) ?? null, [activeEpisodeId, episodes]);
  /**
   * 创建项目时的根目录冲突消息（备忘录）
   * 检查镜头根目录和Layout根目录是否存在冲突（重复或包含关系）
   * 依赖lensRoots和layoutRoots的变化
   */
  const createRootConflictMessage = useMemo(() => getRootConflictMessage(lensRoots, layoutRoots), [layoutRoots, lensRoots]);
  /**
   * 创建集时的根目录冲突消息（备忘录）
   * 检查新增集的镜头根目录和Layout根目录是否存在冲突（重复或包含关系）
   * 依赖episodeLensRoots和episodeLayoutRoots的变化
   */
  const episodeRootConflictMessage = useMemo(() => getRootConflictMessage(episodeLensRoots, episodeLayoutRoots), [episodeLayoutRoots, episodeLensRoots]);

   /**
    * 加载指定项目的集列表
    * 根据项目ID从服务端获取该项目下的所有集摘要信息，并更新状态
    * 如果项目ID为空，则清空集列表
    * @param projectId - 要加载集列表的项目ID（可选，如果不提供则使用当前激活的项目）
    * @returns 无返回值
    */
   /**
    * 加载指定项目的集列表
    * 根据项目ID从服务端获取该项目下的所有集摘要信息，并更新状态
    * 如果项目ID为空，则清空集列表
    * @param projectId - 要加载集列表的项目ID（可选，如果不提供则使用当前激活的项目）
    * @returns 无返回值
    */
async function loadEpisodes(projectId?: string): Promise<void> {
      if (!projectId) {
        setEpisodes([]);
        return;
      }

      const response = await projectService.listEpisodes(projectId);
      if (response.success) {
        setEpisodes(response.episodes);
      } else {
        setEpisodes([]);
        setEpisodeResult({ success: false, error: response.error });
      }
    }

   /**
    * 加载可选用户列表
    * 从服务端获取可添加为项目成员的用户列表
    * 仅在协同模式下且制片角色时加载
    * @returns 无返回值
    */
    async function loadAvailableUsers(): Promise<void> {
      // 仅在远程模式下加载用户列表
      if (getDataSource() !== 'remote') {
        return;
      }

     setUsersLoading(true);
     try {
    const response = await apiClient.request<AvailableUserItem[]>('/api/users', {
      method: 'GET'
    });
    setAvailableUsers(response);
     } catch {
       setAvailableUsers([]);
      } finally {
        setUsersLoading(false);
      }
    }

    async function loadCurrentProjectMembers(projectCode?: string): Promise<void> {
      if (getDataSource() !== 'remote' || !projectCode) {
        setCurrentProjectMembers([]);
        setCachedProjectMembers([]);
        return;
      }

      setProjectMembersLoading(true);
      try {
        const response = await apiClient.request<ProjectMemberItem[]>(`/api/project-members?projectCode=${encodeURIComponent(projectCode)}`, {
          method: 'GET',
        });
        const members = Array.isArray(response)
          ? response.map((member) => ({
            userId: member.userId,
            userName: member.userName,
            displayName: member.displayName,
            projectRoleCode: member.projectRoleCode,
            isActive: member.isActive,
          }))
          : [];
        setCurrentProjectMembers(Array.isArray(response) ? response : []);
        setCachedProjectMembers(members);
      } catch {
        setCurrentProjectMembers([]);
        setCachedProjectMembers([]);
      } finally {
        setProjectMembersLoading(false);
      }
    }

   // 加载可选用户列表（协同模式下）
    useEffect(() => {
      if (dataSource === 'remote') {
        void loadAvailableUsers();
      }
    }, [dataSource]);

    useEffect(() => {
      void loadCurrentProjectMembers(activeProjectId ?? undefined);
    }, [activeProjectId, dataSource]);

  /**
   * 当激活的项目ID发生变化时，自动加载该项目的集列表
   * 空依赖数组表示仅在activeProjectId发生变化时执行
   */
  useEffect(() => {
    void loadEpisodes(activeProjectId ?? undefined);
  }, [activeProjectId]);

   /**
    * 处理选择项目根目录按钮点击事件
    * 打开目录选择对话框让用户选择项目根目录，然后更新项目根目录状态
    * @returns 无返回值
    */
   async function handlePickProjectDirectory(): Promise<void> {
     const selected = await window.movtools.dialog.pickDirectory();
     if (selected) {
       setProjectRootPath(selected);
     }
   }

   /**
    * 处理选择初始化Excel文件按钮点击事件
    * 打开文件选择对话框让用户选择Excel文件，然后调用提供的setter函数设置选中的文件路径
    * 用于设置项目或集的初始化镜头Excel文件
    * @param setter - 用于设置选中文件路径的函数
    * @returns 无返回值
    */
   async function handlePickInitExcel(setter: (value: string) => void): Promise<void> {
     const selected = await window.movtools.dialog.pickFile({
       title: '选择初始化镜头 Excel',
       filters: [{ name: 'Excel Files', extensions: ['xls', 'xlsx'] }],
     });
     if (selected) {
       setter(selected);
     }
   }

   /**
    * 通用的目录选择处理函数
    * 打开目录选择对话框让用户选择一个目录，然后调用提供的setter函数设置选中的路径
    * 用于设置各种根目录路径（如镜头根目录、Layout根目录等）
    * @param setter - 用于设置选中目录路径的函数
    * @returns 无返回值
    */
   async function handlePickDirectory(setter: (value: string) => void): Promise<void> {
     const selected = await window.movtools.dialog.pickDirectory();
     if (selected) {
       setter(selected);
     }
   }

   /**
    * 处理选择根目录按钮点击事件
    * 打开目录选择对话框让用户选择一个目录，然后更新指定根目录的绝对路径
    * 用于设置镜头根目录或Layout根目录的路径
    * @param roots - 根目录配置项数组
    * @param setter - 用于更新根目录配置的函数
    * @param rootId - 要更新的根目录ID
    * @returns 无返回值
    */
   async function handlePickRootDirectory(
     roots: ScanRootConfigItem[],
     setter: (value: ScanRootConfigItem[]) => void,
     rootId: string,
   ): Promise<void> {
     const selected = await window.movtools.dialog.pickDirectory();
     if (!selected) {
       return;
     }

     setter(roots.map((item) => item.rootId === rootId ? { ...item, absolutePath: selected } : item));
   }

   /**
    * 更新指定根目录的属性
    * 根据根目录ID在根目录列表中查找对应项，然后应用提供的补丁对象更新其属性
    * 用于更新根目录的标签、优先级、路径等属性
    * @param roots - 根目录配置项数组
    * @param setter - 用于更新根目录配置的函数
    * @param rootId - 要更新的根目录ID
    * @param patch - 要应用的属性补丁对象
    * @returns 无返回值
    */
    function updateRootItems(
      roots: ScanRootConfigItem[],
      setter: (value: ScanRootConfigItem[]) => void,
      rootId: string,
      patch: Partial<ScanRootConfigItem>,
   ): void {
     setter(roots.map((item) => item.rootId === rootId ? { ...item, ...patch } : item));
   }

   /**
    * 添加新的根目录配置项
    * 在现有根目录列表末尾添加一个新的根目录配置项
    * 用于在UI中提供"新增根目录"功能
    * @param roots - 当前的根目录配置项数组
    * @param setter - 用于更新根目录配置的函数
    * @param fileKind - 要添加的根目录类型（'ma' 或 'layout'）
    * @returns 无返回值
    */
   function addRootItem(roots: ScanRootConfigItem[], setter: (value: ScanRootConfigItem[]) => void, fileKind: 'ma' | 'layout'): void {
     setter([...roots, createRootItem(fileKind)]);
   }

   /**
    * 移除指定的根目录配置项
    * 根据根目录ID从根目录列表中移除对应项，如果移除后列表为空则创建一个默认的根目录项
    * 用于在UI中提供"删除根目录"功能
    * @param roots - 当前的根目录配置项数组
    * @param setter - 用于更新根目录配置的函数
    * @param rootId - 要移除的根目录ID
    * @param fileKind - 要移除的根目录类型（'ma' 或 'layout'），用于在需要时创建默认项
    * @returns 无返回值
    */
   function removeRootItem(roots: ScanRootConfigItem[], setter: (value: ScanRootConfigItem[]) => void, rootId: string, fileKind: 'ma' | 'layout'): void {
     const nextRoots = roots.filter((item) => item.rootId !== rootId);
     setter(nextRoots.length > 0 ? nextRoots : [createRootItem(fileKind)]);
   }

   /**
    * 检查根目录列表中是否存在有效的根目录
    * 有效条件：根目录必须启用且绝对路径不为空（去除首尾空格后不为空字符串）
    * @param roots - 要检查的根目录配置项数组
    * @returns 如果存在至少一个有效根目录则返回true，否则返回false
    */
   function hasValidRoots(roots: ScanRootConfigItem[]): boolean {
     return roots.some((item) => item.isEnabled && item.absolutePath.trim());
   }

   /**
    * 渲染根目录编辑器界面
    * 用于展示和编辑指定类型（MA或Layout）的根目录配置列表
    * 包含标签、优先级、路径选择、启用状态和初始化Excel路径（仅MA类型）等编辑项
    * @param title - 编辑器标题
    * @param roots - 根目录配置项数组
    * @param setter - 更新根目录配置的函数
    * @param fileKind - 根目录类型，'ma' 表示镜头文件，'layout' 表示Layout文件
    * @param placeholder - 路径输入框的占位符提示文本
    * @returns JSX元素，渲染的根目录编辑器界面
    */
   function renderRootEditor(
     title: string,
     roots: ScanRootConfigItem[],
     setter: (value: ScanRootConfigItem[]) => void,
     fileKind: 'ma' | 'layout',
     placeholder: string,
   ) {
     return (
       <div className="stack-gap">
         <div className="section-heading">
           <div>
             <h4>{title}</h4>
             <p className="muted">支持多个团队同时配置，系统会按优先级处理。镜头根目录可单独绑定初始化 Excel。</p>
           </div>
           <button className="secondary-button" disabled={isSubmitting} onClick={() => addRootItem(roots, setter, fileKind)} type="button">新增根目录</button>
         </div>
         {roots.map((root, index) => (
           <article className="lens-history-card" key={root.rootId}>
             <div className="form-grid compact-grid">
               <label className="field">
                 <span>标签</span>
                 <input onChange={(event) => updateRootItems(roots, setter, root.rootId, { label: event.target.value })} placeholder={`例如 团队${index + 1}`} value={root.label} />
               </label>
               <label className="field">
                 <span>优先级</span>
                 <input min={0} onChange={(event) => updateRootItems(roots, setter, root.rootId, { priority: Number(event.target.value || 0) })} type="number" value={root.priority} />
               </label>
             </div>
             <label className="field">
               <span>根目录</span>
               <div className="inline-field-actions">
                 <input onChange={(event) => updateRootItems(roots, setter, root.rootId, { absolutePath: event.target.value })} placeholder={placeholder} value={root.absolutePath} />
                 <button className="secondary-button" disabled={isSubmitting} onClick={() => void handlePickRootDirectory(roots, setter, root.rootId)} type="button">选择目录</button>
               </div>
             </label>
             {fileKind === 'ma' ? (
               <label className="field">
                 <span>该根目录对应的初始化 Excel（可选）</span>
                 <div className="inline-field-actions">
                   <input onChange={(event) => updateRootItems(roots, setter, root.rootId, { initExcelPath: event.target.value })} placeholder="该根目录的镜头会从这个 Excel 初始化" value={root.initExcelPath ?? ''} />
                   <button className="secondary-button" disabled={isSubmitting} onClick={() => void handlePickInitExcel((value) => updateRootItems(roots, setter, root.rootId, { initExcelPath: value }))} type="button">选择文件</button>
                 </div>
               </label>
             ) : null}
             <div className="actions-row compact-actions wrap-actions">
               <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                 <input checked={root.isEnabled} onChange={(event) => updateRootItems(roots, setter, root.rootId, { isEnabled: event.target.checked })} type="checkbox" />
                 启用
               </label>
               <button className="secondary-button" disabled={isSubmitting} onClick={() => removeRootItem(roots, setter, root.rootId, fileKind)} type="button">删除</button>
             </div>
           </article>
         ))}
       </div>
     );
   }

   /**
    * 渲染根目录摘要信息
    * 用于以紧凑的格式显示根目录列表的摘要信息
    * 当根目录列表为空时显示提示信息，否则显示每个根目录的详细信息及操作按钮
    * @param title - 摘要标题
    * @param roots - 要显示的根目录配置项数组（可为undefined）
    * @param emptyLabel - 当根目录列表为空时显示的标签文本
    * @returns JSX元素，渲染的根目录摘要信息
    */
   function renderRootSummary(title: string, roots: ScanRootConfigItem[] | undefined, emptyLabel: string) {
     if (!roots || roots.length === 0) {
       return <small className="muted">{title}：{emptyLabel}</small>;
     }

    return (
      <div className="stack-gap compact-gap">
        <small className="muted">{title}：共 {roots.length} 个</small>
        {roots.map((root, index) => (
          <div className="actions-row compact-actions wrap-actions" key={`${title}-${root.rootId}`}>
            <small className="muted">
              {index + 1}. {(root.label || '未命名根目录').trim()} · {root.absolutePath || '未配置路径'} · 优先级 {root.priority} · {root.isEnabled ? '启用' : '停用'}{root.initExcelPath ? ` · Excel ${root.initExcelPath}` : ''}
            </small>
            <button className="secondary-button" disabled={!root.absolutePath} onClick={() => void handleCopyPath(root.absolutePath)} type="button">
              {copiedPath === root.absolutePath ? '已复制' : '复制路径'}
            </button>
          </div>
        ))}
      </div>
    );
  }

   /**
    * 复制路径到剪贴板
    * 将指定的路径复制到系统剪贴板，并设置复制状态以显示"已复制"反馈
    * 复制成功后会在1.5秒后自动清除复制状态
    * @param value - 要复制的路径字符串
    * @returns 无返回值（Promise）
    */
   async function handleCopyPath(value: string): Promise<void> {
     const normalized = value.trim();
     if (!normalized) {
       return;
     }

     await navigator.clipboard.writeText(normalized);
     setCopiedPath(normalized);
     window.setTimeout(() => {
       setCopiedPath((current) => current === normalized ? '' : current);
     }, 1500);
   }

   /**
    * 切换项目的展开/收起状态
    * 如果指定的项目当前处于展开状态，则将其收起；如果当前处于收起状态，则将其展开
    * 通过在已展开项目ID列表中添加或移除项目ID来实现状态切换
    * @param projectId - 要切换展开状态的项目ID
    * @returns 无返回值
    */
   function toggleExpandedProject(projectId: string): void {
     setExpandedProjectIds((current) => current.includes(projectId)
       ? current.filter((item) => item !== projectId)
       : [...current, projectId]);
   }

   /**
    * 切换集的展开/收起状态
    * 如果指定的集当前处于展开状态，则将其收起；如果当前处于收起状态，则将其展开
    * 通过在已展开集ID列表中添加或移除集ID来实现状态切换
    * @param episodeId - 要切换展开状态的集ID
    * @returns 无返回值
    */
   function toggleExpandedEpisode(episodeId: string): void {
     setExpandedEpisodeIds((current) => current.includes(episodeId)
       ? current.filter((item) => item !== episodeId)
       : [...current, episodeId]);
   }

   /**
    * 处理创建剧项目按钮点击事件
    * 收集表单数据，验证必填项和根目录配置，然后调用后端服务创建新的剧项目
    * 创建成功后会重置表单状态并加载新创建项目的集列表
    * @returns 无返回值（Promise）
    */
   async function handleCreateProject(): Promise<void> {
     if (!projectName.trim() || !projectRootPath.trim() || !initialEpisodeCode.trim() || !hasValidRoots(lensRoots) || !hasValidRoots(layoutRoots)) {
       setResult({ success: false, error: '请先填写剧项目名称、项目根目录、首集编号，并至少配置一个启用的首集镜头根目录和 layout 根目录。' });
       return;
     }

     if (createRootConflictMessage) {
       setResult({ success: false, error: `${createRootConflictMessage}。请调整后再创建项目。` });
       return;
     }

setIsSubmitting(true);
      try {
        const response = await projectService.createProject({
          projectName: projectName.trim(),
          projectRootPath: projectRootPath.trim(),
          projectDefaultFps: Number(projectDefaultFps) > 0 ? Number(projectDefaultFps) : 30,
          initialEpisodeCode: initialEpisodeCode.trim(),
          initialEpisodeName: initialEpisodeName.trim() || undefined,
          initExcelPath: initExcelPath.trim() || undefined,
          lensRoots,
          layoutRoots,
          members: selectedMembers.length > 0 ? selectedMembers : undefined,
        });
        setResult(response);
        if (response.workspace) {
          setWorkspace(response.workspace);
        }

        if (response.success) {
          setProjectName('');
          setProjectRootPath('');
          setProjectDefaultFps('30');
          setInitialEpisodeCode('EP01');
          setInitialEpisodeName('');
          setInitExcelPath('');
          setLensRoots([createRootItem('ma')]);
          setLayoutRoots([createRootItem('layout')]);
          setSelectedMembers([]);
          if (response.project) {
            await loadEpisodes(response.project.projectId);
          }
          onProjectReady?.();
        }
      } finally {
        setIsSubmitting(false);
      }
    }

    function toggleProjectMember(userId: string): void {
      setSelectedMembers((current) => {
        const exists = current.some((member) => member.userId === userId);
        if (exists) {
          return current.filter((member) => member.userId !== userId);
        }

        const user = availableUsers.find((entry) => entry.userId === userId);
        return [...current, { userId, projectRoleCode: getAvailableUserProjectRole(user) }];
      });
    }

    async function handleAddProjectMember(): Promise<void> {
      if (!activeProject?.projectId || !selectedProjectMemberUserId || !selectedProjectMemberRole) {
        setResult({ success: false, error: '请选择用户和项目角色' });
        return;
      }

      try {
        await apiClient.request<void>('/api/project-members', {
          method: 'POST',
          body: JSON.stringify({
            projectCode: activeProject.projectId,
            userId: selectedProjectMemberUserId,
            projectRoleCode: selectedProjectMemberRole,
          }),
        });
        setSelectedProjectMemberUserId('');
        setSelectedProjectMemberRole('maker');
        await loadCurrentProjectMembers(activeProject.projectId);
        setResult({ success: true });
      } catch (error) {
        setResult({ success: false, error: error instanceof Error ? error.message : '添加项目成员失败' });
      }
    }

    async function handleRemoveProjectMember(projectMemberId: string): Promise<void> {
      if (!confirm('确定要从此项目移除该成员吗？')) {
        return;
      }

      try {
        await apiClient.request<void>(`/api/project-members/${projectMemberId}`, {
          method: 'DELETE',
        });
        await loadCurrentProjectMembers(activeProject?.projectId);
        setResult({ success: true });
      } catch (error) {
        setResult({ success: false, error: error instanceof Error ? error.message : '移除项目成员失败' });
      }
    }

   /**
    * 处理打开已有项目按钮点击事件
    * 打开目录选择对话框让用户选择一个已有的项目目录，然后调用后端服务打开该项目
    * 打开成功后会更新工作区状态并加载项目的集列表
    * @returns 无返回值（Promise）
    */
   async function handleOpenExistingProject(): Promise<void> {
     const selected = await window.movtools.dialog.pickDirectory();
     if (!selected) {
       return;
     }

     setIsSubmitting(true);
     try {
       const response = await projectService.openProject(selected);
       setResult(response);
       if (response.workspace) {
         setWorkspace(response.workspace);
       }
       if (response.success) {
         const nextProjectId = response.project?.projectId ?? response.workspace?.activeProjectId ?? null;
         await loadEpisodes(nextProjectId ?? undefined);
         onProjectReady?.();
       }
     } finally {
       setIsSubmitting(false);
     }
   }

   /**
    * 处理设置激活项目按钮点击事件
    * 调用后端服务将指定的项目设置为当前激活项目
    * 设置成功后会更新工作区状态并加载该项目的集列表
    * @param projectId - 要设置为激活状态的项目ID
    * @returns 无返回值（Promise）
    */
    async function handleSetActive(projectId: string): Promise<void> {
      const response = await projectService.setActiveProject(projectId);
      setResult(response);
      if (response.workspace) {
        setWorkspace(response.workspace);
      }
      if (response.success) {
        await loadEpisodes(projectId);
        setActivationRetryProjectId(null);
        setActivationRetryProjectRootPath('');
      } else if (response.error) {
        setActivationRetryProjectId(projectId);
      }
    }

    async function handlePickActivationRetryProjectRoot(): Promise<void> {
      const selected = await window.movtools.dialog.pickDirectory();
      if (!selected) {
        return;
      }

      setActivationRetryProjectRootPath(selected);
    }

    async function handleRetryActivationWithProjectRoot(projectId: string): Promise<void> {
      const projectRootPath = activationRetryProjectRootPath.trim();
      if (!projectRootPath) {
        setResult({ success: false, error: '请先选择项目根目录。' });
        return;
      }

      const response = await projectService.setActiveProject(projectId, { projectRootPath });
      setResult(response);
      if (response.workspace) {
        setWorkspace(response.workspace);
      }
      if (response.success) {
        setActivationRetryProjectId(null);
        setActivationRetryProjectRootPath('');
        await loadEpisodes(projectId);
      }
    }

   /**
    * 处理设置激活集按钮点击事件
    * 调用后端服务将指定的集设置为当前激活集
    * 设置成功后会更新工作区状态
    * @param episodeId - 要设置为激活状态的集ID
    * @returns 无返回值（Promise）
    */
   async function handleSetActiveEpisode(episodeId: string): Promise<void> {
     const response = await projectService.setActiveEpisode(episodeId);
     setEpisodeResult(response);
     if (response.workspace) {
       setWorkspace(response.workspace);
     }
     if (response.success) {
       onProjectReady?.();
     }
   }

   /**
    * 处理创建新集按钮点击事件
    * 收集表单数据，验证必填项和根目录配置，然后调用后端服务在当前项目下创建新的集
    * 创建成功后会重置表单状态并重新加载当前项目的集列表
    * @returns 无返回值（Promise）
    */
   async function handleCreateEpisode(): Promise<void> {
     if (!activeProjectId) {
       setEpisodeResult({ success: false, error: '请先激活一个项目。' });
       return;
     }
 
     if (!episodeCode.trim() || !hasValidRoots(episodeLensRoots) || !hasValidRoots(episodeLayoutRoots)) {
       setEpisodeResult({ success: false, error: '请先填写集编号，并至少配置一个启用的该集镜头根目录和 layout 根目录。' });
       return;
     }
 
     if (episodeRootConflictMessage) {
       setEpisodeResult({ success: false, error: `${episodeRootConflictMessage}。请调整后再创建集。` });
       return;
     }
 
     setIsSubmitting(true);
     try {
       const response = await projectService.createEpisode({
         projectId: activeProjectId,
         episodeCode: episodeCode.trim(),
         episodeName: episodeName.trim() || undefined,
         initExcelPath: episodeInitExcelPath.trim() || undefined,
         lensRoots: episodeLensRoots,
         layoutRoots: episodeLayoutRoots,
       });
       setEpisodeResult(response);
       if (response.workspace) {
         setWorkspace(response.workspace);
       }
       if (response.success) {
         setEpisodeCode('');
         setEpisodeName('');
         setEpisodeInitExcelPath('');
         setEpisodeLensRoots([createRootItem('ma')]);
         setEpisodeLayoutRoots([createRootItem('layout')]);
         await loadEpisodes(activeProjectId);
       }
     } finally {
       setIsSubmitting(false);
     }
   }

   /**
    * 处理删除项目按钮点击事件
    * 弹出确认对话框后，调用后端服务删除指定的项目记录
    * 注意：此操作仅移除应用内项目记录，不删除磁盘上的实际文件
    * 删除成功后会更新工作区状态
    * @param projectId - 要删除的项目ID
    * @returns 无返回值（Promise）
    */
   async function handleDelete(projectId: string): Promise<void> {
     const confirmed = window.confirm('仅移除应用内项目记录，不删除磁盘文件。是否继续？');
     if (!confirmed) {
       return;
     }

     const response = await projectService.deleteProject(projectId);
     setResult(response);
     if (response.workspace) {
       setWorkspace(response.workspace);
     }
   }

  return (
    <section className="page-layout">
      <header className="page-header">
        <div>
          <p className="eyebrow">项目</p>
          <h2>剧项目与集管理</h2>
          <div className="page-header-tags">
            <span className="page-header-tag">项目底座</span>
            <span className="page-header-tag">集上下文</span>
            <span className="page-header-tag">离线本地</span>
          </div>
        </div>
        <div className="page-header-actions">
          <p className="muted">项目代表整个剧，集代表一张镜头表。后续镜头管理、文件夹同步、导入导出都会按当前集进行。</p>
          <div className="actions-row compact-actions">
            <button className="secondary-button" disabled={isSubmitting} onClick={() => void handleOpenExistingProject()} type="button">
              打开已有项目
            </button>
            <button className="secondary-button" disabled={isSubmitting} onClick={() => setDataSource(dataSource === 'local' ? 'remote' : 'local')} type="button">
              {dataSource === 'local' ? '切换协同' : '切换本地'}
            </button>
            <span className="muted">{dataSource === 'local' ? '本地模式' : '协同模式'}</span>
          </div>
        </div>
      </header>

      <div className="panel-grid two-column project-grid project-page-grid">
        <div className="panel stack-gap project-page-panel">
          <div className="section-heading">
            <div>
              <h3>新建剧项目 + 首集</h3>
              <p className="muted">创建项目时同时创建首集；如有多个镜头根目录，请分别给每个根目录配置对应初始化 Excel。</p>
            </div>
          </div>

          <label className="field">
            <span>剧项目名称</span>
            <input onChange={(event) => setProjectName(event.target.value)} placeholder="例如：萌粒项目" value={projectName} />
          </label>

          <label className="field">
            <span>项目根目录</span>
            <div className="inline-field-actions">
              <input onChange={(event) => setProjectRootPath(event.target.value)} placeholder="请选择本地项目目录" value={projectRootPath} />
              <button className="secondary-button" disabled={isSubmitting} onClick={() => void handlePickProjectDirectory()} type="button">
                浏览
              </button>
            </div>
          </label>

          <label className="field">
            <span>项目默认 fps</span>
            <input
              inputMode="numeric"
              min={1}
              onChange={(event) => setProjectDefaultFps(event.target.value)}
              placeholder="默认 30"
              type="number"
              value={projectDefaultFps}
            />
          </label>

          <div className="form-grid compact-grid">
            <label className="field">
              <span>首集编号</span>
              <input onChange={(event) => setInitialEpisodeCode(event.target.value)} placeholder="例如：EP01" value={initialEpisodeCode} />
            </label>

            <label className="field">
              <span>首集名称</span>
              <input onChange={(event) => setInitialEpisodeName(event.target.value)} placeholder="例如：第01集（可选）" value={initialEpisodeName} />
            </label>
          </div>

          <label className="field">
            <span>首集初始化 Excel（兼容旧流程，可选）</span>
            <div className="inline-field-actions">
              <input onChange={(event) => setInitExcelPath(event.target.value)} placeholder="未按根目录单独配置时，默认绑定到主镜头根目录" value={initExcelPath} />
              <button className="secondary-button" disabled={isSubmitting} onClick={() => void handlePickInitExcel(setInitExcelPath)} type="button">
                选择文件
              </button>
            </div>
          </label>

          {renderRootEditor('首集镜头文件根目录', lensRoots, setLensRoots, 'ma', '会按主根目录为镜头创建空文件夹')}

          {renderRootEditor('首集 Layout 文件根目录', layoutRoots, setLayoutRoots, 'layout', '程序会按当前集在这些目录扫描 Layout Maya 文件')}

          {/* 项目成员选择 - 协同模式下显示 */}
          {dataSource === 'remote' && (
              <div className="form-section">
                <div className="section-heading">
                  <div>
                    <h4>项目成员（创建时预置）</h4>
                    <p className="muted">这里是制片创建项目时的成员勾选入口，创建后也可以在项目页继续调整。</p>
                  </div>
                </div>
              {usersLoading ? (
                <p className="muted">成员列表加载中...</p>
              ) : availableUsers.length === 0 ? (
                <p className="muted">当前没有可选用户，请先到用户管理中创建用户。</p>
              ) : (
                <div className="project-member-picker">
                  <div className="selected-member-panel">
                    <div className="project-highlight-heading">
                      <div>
                        <strong>已选择 {selectedMembers.length} 位成员</strong>
                        <p className="muted">创建项目时会把这些人员加入项目，请在提交前核对姓名和职务。</p>
                      </div>
                      {selectedMembers.length > 0 ? (
                        <button className="secondary-button" onClick={() => setSelectedMembers([])} type="button">清空选择</button>
                      ) : null}
                    </div>
                    {selectedMemberSummaries.length > 0 ? (
                      <div className="selected-member-list">
                        {selectedMemberSummaries.map((member) => (
                          <div className="selected-member-chip" key={member.userId}>
                            <span className="member-role-badge">{member.roleLabel}</span>
                            <strong>{member.displayName}</strong>
                            <button className="ghost-link-button" onClick={() => toggleProjectMember(member.userId)} type="button">移除</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">还没有选择成员。请从下方按职务选择需要加入项目的人员。</p>
                    )}
                  </div>

                  <div className="member-role-groups">
                    {availableUsersByRole.map((group) => (
                      <div className="member-role-group" key={group.code}>
                        <div className="member-role-group-heading">
                          <strong>{group.label}</strong>
                          <span className="muted">{group.users.length} 人</span>
                        </div>
                        <div className="member-card-grid">
                          {group.users.map((user) => {
                            const selectedMember = selectedMembers.find((member) => member.userId === user.userId);
                            return (
                              <article className={selectedMember ? 'member-select-card is-selected' : 'member-select-card'} key={user.userId}>
                                <div>
                                  <div className="member-card-title">
                                    <strong>{getAvailableUserDisplayName(user)}</strong>
                                    <span className="member-role-badge">{group.label}</span>
                                  </div>
                                  <p className="muted">账号：{user.userName}</p>
                                </div>
                                {selectedMember ? (
                                  <div className="member-card-actions">
                                    <span className="success-copy">已选择为{getProjectMemberRoleLabel(selectedMember.projectRoleCode)}</span>
                                    <button className="secondary-button" onClick={() => toggleProjectMember(user.userId)} type="button">取消选择</button>
                                  </div>
                                ) : (
                                  <button className="secondary-button" onClick={() => toggleProjectMember(user.userId)} type="button">选择此人</button>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {createRootConflictMessage ? <p className="danger-copy">{createRootConflictMessage}。请调整后再创建项目，否则镜头版本文件与 Layout 文件会交叉扫描。</p> : null}

          <div className="actions-row wrap-actions project-page-submit-row">
            <button className="primary-button" disabled={isSubmitting} onClick={() => void handleCreateProject()} type="button">
              创建剧项目并初始化首集
            </button>
            <span className={result.initResult ? getInitializationStatusTone(result.initResult.status) : (result.success ? 'success-copy' : 'danger-copy')}>
              {result.initResult ? summarizeMutationResult(result) : (result.success ? '项目创建成功。' : result.error ?? '项目创建后会自动建立首集。')}
            </span>
          </div>

          <div className="project-highlight">
            <div className="project-highlight-heading">
              <strong>当前激活上下文</strong>
              <span className="environment-pill info">工作区</span>
            </div>
            {activeProject ? (
              <div className="stack-gap compact-gap">
                <div><span className="muted">剧项目：</span>{activeProject.projectName}</div>
                <div><span className="muted">当前集：</span>{activeEpisode ? `${activeEpisode.episodeCode} / ${activeEpisode.episodeName}` : '未选择'}</div>
                <div><span className="muted">项目目录：</span>{activeProject.projectRootPath}</div>
                <div><span className="muted">项目镜头主根目录：</span>{activeProject.lensFolderRootPath || '未配置'}</div>
                <div><span className="muted">项目 Layout 主根目录：</span>{activeProject.layoutCheckPath || '未配置'}</div>
                <div><span className="muted">数据库：</span>{activeProject.databasePath}</div>
                <div><span className="muted">备份目录：</span>{activeProject.backupDir}</div>
                {renderRootSummary('项目镜头根目录明细', activeProject.lensRoots, '未配置')}
                {renderRootSummary('项目 Layout 根目录明细', activeProject.layoutRoots, '未配置')}
                {activeEpisode ? renderRootSummary('当前集镜头根目录', activeEpisode.lensRoots, '未配置') : null}
                {activeEpisode ? renderRootSummary('当前集 Layout 根目录', activeEpisode.layoutRoots, '未配置') : null}
                {dataSource === 'remote' ? (
                  <div className="form-section" style={{ marginTop: '1rem' }}>
                    <div className="section-heading">
                      <div>
                        <h4>项目成员管理（制片）</h4>
                        <p className="muted">可查看、添加和移除当前项目成员，管理员不在这里维护成员。</p>
                      </div>
                    </div>

                    {projectMembersLoading ? (
                      <p className="muted">成员加载中...</p>
                    ) : currentProjectMembers.length === 0 ? (
                      <p className="muted">当前项目暂无成员。</p>
                    ) : (
                      <div className="stack-gap compact-gap">
                        {currentProjectMembers.map((member) => (
                          <div key={member.projectMemberId} className="project-highlight" style={{ padding: '0.75rem 1rem' }}>
                            <div className="project-highlight-heading">
                              <strong>{member.displayName}</strong>
                              <span className="environment-pill info">{getProjectMemberRoleLabel(member.projectRoleCode)}</span>
                            </div>
                            <div><span className="muted">用户名：</span>{member.userName}</div>
                            <div className="actions-row compact-actions">
                              <button className="secondary-button" onClick={() => void handleRemoveProjectMember(member.projectMemberId)} type="button">
                                移除成员
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="form-grid compact-grid" style={{ marginTop: '0.75rem' }}>
                      <label className="field">
                        <span>添加用户</span>
                        <select value={selectedProjectMemberUserId} onChange={(event) => setSelectedProjectMemberUserId(event.target.value)}>
                          <option value="">请选择用户...</option>
                          {availableUsers.map((user) => (
                            <option key={user.userId} value={user.userId}>
                              {user.displayName || user.userName} ({user.userName})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>项目角色</span>
                        <select value={selectedProjectMemberRole} onChange={(event) => setSelectedProjectMemberRole(event.target.value)}>
                          {PROJECT_MEMBER_ROLE_OPTIONS.map((option) => (
                            <option key={option.code} value={option.code}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="actions-row compact-actions">
                      <button className="primary-button" disabled={!selectedProjectMemberUserId || !selectedProjectMemberRole} onClick={() => void handleAddProjectMember()} type="button">
                        添加成员
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="muted">尚未激活任何项目。</p>
            )}
          </div>
        </div>

        <div className="panel stack-gap project-page-panel">
          <div className="section-heading">
            <div>
              <h3>项目记录</h3>
              <p className="muted">先选中一个剧项目，再在下方管理它的集。</p>
            </div>
            <span className="muted">共 {projects.length} 个</span>
          </div>

          {projects.length > 0 ? (
            <div className="project-list">
              {projects.map((project) => {
                const isActive = project.projectId === activeProjectId;
                const isExpanded = expandedProjectIds.includes(project.projectId);
                return (
                  <article className={isActive ? 'project-card active' : 'project-card'} key={project.projectId}>
                    <div className="section-heading">
                      <div>
                        <h3>{project.projectName}</h3>
                        <p className="muted">{project.projectRootPath}</p>
                      </div>
                      <div className="project-card-badges">
                        <span className="environment-pill info">剧项目</span>
                        <span className={isActive ? 'environment-pill ready' : 'environment-pill blocked'}>
                          {isActive ? '当前项目' : '未激活'}
                        </span>
                      </div>
                    </div>

                    <div className="stack-gap compact-gap">
                      <small className="muted">数据库：{project.databasePath}</small>
                      <small className="muted">镜头主根目录：{project.lensFolderRootPath || '未配置'}</small>
                      <small className="muted">Layout主根目录：{project.layoutCheckPath || '未配置'}</small>
                      <small className="muted">创建时间：{project.createdAt}</small>
                      <small className="muted">最近打开：{project.lastOpenedAt ?? '尚未记录'}</small>
                      {isActive && activeEpisode ? (
                        <>
                          <small className="muted">项目主字段：镜头 {project.lensFolderRootPath || '未配置'} · Layout {project.layoutCheckPath || '未配置'}</small>
                          <small className="muted">当前激活集根目录：镜头 {activeEpisode.lensRoots?.length ?? 0} 个 · Layout {activeEpisode.layoutRoots?.length ?? 0} 个</small>
                          {isExpanded ? renderRootSummary('当前激活集镜头根目录', activeEpisode.lensRoots, '未配置') : null}
                          {isExpanded ? renderRootSummary('当前激活集 Layout 根目录', activeEpisode.layoutRoots, '未配置') : null}
                        </>
                      ) : null}
                    </div>

                    <div className="actions-row compact-actions wrap-actions">
                      {isActive && activeEpisode ? (
                        <button className="secondary-button" onClick={() => toggleExpandedProject(project.projectId)} type="button">
                          {isExpanded ? '收起根目录明细' : '展开根目录明细'}
                        </button>
                      ) : null}
                      <button className="secondary-button" disabled={isActive} onClick={() => void handleSetActive(project.projectId)} type="button">
                        设为当前项目
                      </button>
                      <button className="secondary-button" onClick={() => void handleDelete(project.projectId)} type="button">
                        移除记录
                      </button>
                    </div>
                    {activationRetryProjectId === project.projectId ? (
                      <div className="stack-gap compact-gap" style={{ marginTop: '0.75rem' }}>
                        <small className="muted">激活失败时只需重选项目根目录；镜头根目录和 Layout 根目录会自动按新盘符重映射。</small>
                        <label className="field">
                          <span>项目根目录</span>
                          <div className="inline-field-actions">
                            <input
                              onChange={(event) => setActivationRetryProjectRootPath(event.target.value)}
                              placeholder={project.projectRootPath || '请选择本机项目根目录'}
                              value={activationRetryProjectRootPath}
                            />
                            <button className="secondary-button" onClick={() => void handlePickActivationRetryProjectRoot()} type="button">选择</button>
                          </div>
                        </label>
                        <div className="actions-row compact-actions wrap-actions">
                          <button
                            className="primary-button"
                            onClick={() => void handleRetryActivationWithProjectRoot(project.projectId)}
                            type="button"
                          >
                            应用并重试
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted">还没有项目记录。先创建一个剧项目，或通过“打开已有项目”导入已有目录。</p>
          )}

          <div className="section-heading">
            <div>
              <h3>当前项目的集</h3>
              <p className="muted">每个集是一张独立镜头表，后续镜头管理都按当前集进行。</p>
            </div>
            <span className="muted">共 {episodes.length} 个</span>
          </div>

          <div className="form-grid compact-grid">
            <label className="field">
              <span>新增集编号</span>
              <input onChange={(event) => setEpisodeCode(event.target.value)} placeholder="例如：EP02" value={episodeCode} />
            </label>

            <label className="field">
              <span>新增集名称</span>
              <input onChange={(event) => setEpisodeName(event.target.value)} placeholder="例如：第02集（可选）" value={episodeName} />
            </label>
          </div>

          <label className="field">
            <span>新增集初始化 Excel（兼容旧流程，可选）</span>
            <div className="inline-field-actions">
              <input onChange={(event) => setEpisodeInitExcelPath(event.target.value)} placeholder="未按根目录单独配置时，默认绑定到主镜头根目录" value={episodeInitExcelPath} />
              <button className="secondary-button" disabled={!activeProjectId || isSubmitting} onClick={() => void handlePickInitExcel(setEpisodeInitExcelPath)} type="button">
                选择文件
              </button>
            </div>
          </label>

          {renderRootEditor('新增集镜头文件根目录', episodeLensRoots, setEpisodeLensRoots, 'ma', '该集镜头文件夹会建在主根目录中')}

          {renderRootEditor('新增集 Layout 文件根目录', episodeLayoutRoots, setEpisodeLayoutRoots, 'layout', '该集 Layout Maya 会在这些目录中自动扫描')}

          {episodeRootConflictMessage ? <p className="danger-copy">{episodeRootConflictMessage}。请调整后再创建集，否则镜头版本文件与 Layout 文件会交叉扫描。</p> : null}

          <div className="actions-row wrap-actions project-page-submit-row">
            <button className="primary-button" disabled={!activeProjectId || isSubmitting} onClick={() => void handleCreateEpisode()} type="button">
              在当前项目下新增集
            </button>
            <span className={episodeResult.initResult ? getInitializationStatusTone(episodeResult.initResult.status) : (episodeResult.success ? 'success-copy' : 'danger-copy')}>
              {episodeResult.initResult ? summarizeMutationResult(episodeResult) : (episodeResult.success ? '新增集成功。' : episodeResult.error ?? '新集会成为新的镜头表。')}
            </span>
          </div>

          {episodes.length > 0 ? (
            <div className="project-list">
              {episodes.map((episode) => {
                const isActive = episode.episodeId === activeEpisodeId;
                const isExpanded = expandedEpisodeIds.includes(episode.episodeId);
                return (
                  <article className={isActive ? 'project-card active' : 'project-card'} key={episode.episodeId}>
                    <div className="section-heading">
                      <div>
                        <h3>{episode.episodeCode}</h3>
                        <p className="muted">{episode.episodeName}</p>
                      </div>
                      <div className="project-card-badges">
                        <span className="environment-pill info">集</span>
                        <span className={isActive ? 'environment-pill ready' : 'environment-pill blocked'}>
                          {isActive ? '当前集' : '未激活'}
                        </span>
                      </div>
                    </div>

                    <div className="stack-gap compact-gap">
                      <small className="muted">镜头文件主根目录：{episode.lensFolderRootPath || '未配置'}</small>
                      <small className="muted">镜头文件根目录：共 {episode.lensRoots?.length ?? 0} 个</small>
                      {isExpanded ? renderRootSummary('镜头文件根目录明细', episode.lensRoots, '未配置') : null}
                      <small className="muted">Layout主根目录：{episode.layoutCheckPath || '未配置'}</small>
                      <small className="muted">Layout根目录：共 {episode.layoutRoots?.length ?? 0} 个</small>
                      {isExpanded ? renderRootSummary('Layout 根目录明细', episode.layoutRoots, '未配置') : null}
                      <small className="muted">初始化 Excel：{episode.initExcelPath || '未设置'}</small>
                    </div>

                    <div className="actions-row compact-actions">
                      <button className="secondary-button" onClick={() => toggleExpandedEpisode(episode.episodeId)} type="button">
                        {isExpanded ? '收起根目录明细' : '展开根目录明细'}
                      </button>
                      <button className="secondary-button" disabled={isActive} onClick={() => void handleSetActiveEpisode(episode.episodeId)} type="button">
                        切换为当前集
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted">当前项目还没有集。请先创建首集或新增一个集。</p>
          )}
        </div>
      </div>
    </section>
  );
}
