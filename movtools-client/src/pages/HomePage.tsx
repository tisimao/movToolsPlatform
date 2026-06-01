import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { EnvironmentStatusCard } from '../components/EnvironmentStatusCard';
import { OutputDirectoryPicker } from '../components/OutputDirectoryPicker';
import { TaskList } from '../components/TaskList';
import { validateMergeInput } from '../lib/validators';
import { compareLensCode } from '../lib/lensCodeSort';
import { useProjectStore } from '../stores/projectStore';
import { emptyCreateTaskResponse, useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { EnvironmentStatus, CreateTaskItem } from '../types/ipc';
import type { LensRecord, LensVersionBinding } from '../types/lens';
import type { MergeOverlayStyle } from '../types/task';

/**
 * HomePage 组件的属性接口
 */
interface HomePageProps {
  /** 是否正在加载环境状态 */
  environmentLoading: boolean;
  /** 当前环境状态，null 表示未加载 */
  environmentStatus: EnvironmentStatus | null;
  /** 关闭首次启动引导的回调函数 */
  onDismissFirstLaunchGuide: () => void;
  /** 打开日志页面的回调函数 */
  onOpenLogs: () => void;
  /** 打开设置页面的回调函数 */
  onOpenSettings: () => void;
  /** 打开使用手册的回调函数 */
  onOpenUsageManual: () => Promise<void>;
  /** 刷新环境状态的回调函数 */
  onRefreshEnvironmentStatus: () => Promise<void>;
  /** 是否显示首次启动引导 */
  showFirstLaunchGuide: boolean;
}

/**
 * 已选择的镜头片段接口
 */
interface SelectedLensClip {
  /** 镜头唯一标识 */
  lensId: string;
  /** 镜头编号 */
  lensCode: string;
  /** 镜头名称 */
  lensName: string;
  /** 制作人员 */
  maker: string;
  /** 场次编号 */
  sceneNo: number;
  /** 素材来源类型：当前版本/历史版本/Layout视频 */
  sourceKind: 'current-mov' | 'history-mov' | 'layout-video';
  /** 素材来源标签 */
  sourceLabel: string;
  /** 版本号 */
  versionNum: string;
  /** 视频文件完整路径 */
  movPath: string;
  /** 视频宽度（可选） */
  width?: number;
  /** 视频高度（可选） */
  height?: number;
  /** 镜头备注（可选） */
  note?: string;
}

/**
 * 默认的合并视频叠加样式配置
 */
const DEFAULT_MERGE_OVERLAY_STYLE: MergeOverlayStyle = {
  /** 叠加位置：top-left, top-right, bottom-left, bottom-right */
  position: 'top-left',
  /** 字号大小 */
  fontSize: 36,
  /** 文字颜色（十六进制） */
  fontColor: '#FFFFFF',
  /** 文字透明度（0-100） */
  fontOpacity: 100,
  /** 背景颜色（十六进制） */
  backgroundColor: '#000000',
  /** 背景透明度（0-100） */
  backgroundOpacity: 55,
  /** 背景内边距（像素） */
  boxPadding: 16,
  /** X轴偏移量（像素） */
  offsetX: 24,
  /** Y轴偏移量（像素） */
  offsetY: 24,
};

/**
 * 镜头素材来源选项接口
 */
interface LensSourceOption {
  /** 唯一标识键 */
  key: string;
  /** 素材类型：当前版本/历史版本/Layout视频 */
  kind: 'current-mov' | 'history-mov' | 'layout-video';
  /** 显示标签 */
  label: string;
  /** 视频文件路径 */
  path: string;
  /** 版本号 */
  versionNum: string;
  /** 视频宽度（可选） */
  width?: number;
  /** 视频高度（可选） */
  height?: number;
}

/**
 * 镜头素材来源可用性接口
 */
interface LensSourceAvailability {
  /** 是否有layout候选素材 */
  hasLayoutCandidate: boolean;
  /** 说明备注 */
  note: string;
  /** 可用素材选项列表 */
  options: LensSourceOption[];
}

/**
 * 工作台草稿接口（用于本地存储）
 */
interface WorkbenchDraft {
  /** 工作区键（项目ID:集ID） */
  workspaceKey: string;
  /** 镜头ID到素材源键的映射 */
  selectedSourceKeyByLensId: Record<string, string>;
  /** 已选择的镜头片段列表 */
  selectedClips: SelectedLensClip[];
  /** 输出目录路径 */
  outputDir: string;
  /** 输出文件名 */
  outputName: string;
  /** 合并模式：fast（快速）或 compatible（兼容） */
  mergeMode: 'fast' | 'compatible';
  /** 分辨率升级模式：pad（等比放大并补边）或 stretch（直接拉伸铺满） */
  mergeUpscaleMode: 'pad' | 'stretch';
  /** 合并叠加样式配置 */
  mergeOverlayStyle: MergeOverlayStyle;
  /** 搜索关键字 */
  searchKeyword: string;
  /** 制作人员过滤器 */
  makerFilter: string;
  /** 已勾选的镜头ID列表 */
  checkedLensIds: string[];
  /** 是否隐藏已加入的镜头 */
  hideAddedLenses: boolean;
}

/**
 * 工作台草稿存储键（用于localStorage）
 */
const WORKBENCH_DRAFT_STORAGE_KEY = 'movtools.workbench.draft.v1';
/**
 * 默认输出文件名
 */
const DEFAULT_OUTPUT_NAME = '成片拼接';

/**
 * 主页组件：镜头表演连续拼接工作台
 * @param props - HomePage 属性对象
 */
export function HomePage({
  environmentLoading,
  environmentStatus,
  onDismissFirstLaunchGuide,
  onOpenLogs,
  onOpenSettings,
  onOpenUsageManual,
  onRefreshEnvironmentStatus,
  showFirstLaunchGuide,
}: HomePageProps) {
  /**
 * 初始化工作台草稿数据
 */
  const initialDraft = readWorkbenchDraft();
  /**
   * 是否显示环境面板
   */
  const [showEnvironmentPanel, setShowEnvironmentPanel] = useState(false);
  /**
   * 可用镜头列表
   */
  const [availableLenses, setAvailableLenses] = useState<LensRecord[]>([]);
  /**
   * 镜头ID到素材来源可用性的映射
   */
  const [sourceAvailabilityMap, setSourceAvailabilityMap] = useState<Record<string, LensSourceAvailability>>({});
  /**
   * 镜头ID到已选择素材源键的映射
   */
  const [selectedSourceKeyByLensId, setSelectedSourceKeyByLensId] = useState<Record<string, string>>(initialDraft?.selectedSourceKeyByLensId ?? {});
  /**
   * 已选择的镜头片段列表
   */
  const [selectedClips, setSelectedClips] = useState<SelectedLensClip[]>(initialDraft?.selectedClips ?? []);
  /**
   * 输出目录路径
   */
  const [outputDir, setOutputDir] = useState(initialDraft?.outputDir ?? '');
  /**
   * 输出文件名
   */
  const [outputName, setOutputName] = useState(initialDraft?.outputName ?? DEFAULT_OUTPUT_NAME);
  /**
   * 合并模式：fast（快速）或 compatible（兼容）
   */
  const [mergeMode, setMergeMode] = useState<'fast' | 'compatible'>(initialDraft?.mergeMode ?? 'compatible');
  /**
   * 分辨率升级模式：pad（等比放大并补边）或 stretch（直接拉伸铺满）
   */
  const [mergeUpscaleMode, setMergeUpscaleMode] = useState<'pad' | 'stretch'>(initialDraft?.mergeUpscaleMode ?? 'pad');
  /**
   * 合并模式提示信息
   */
  const [mergeModeHint, setMergeModeHint] = useState('');
  /**
   * 合并叠加样式配置
   */
  const [mergeOverlayStyle, setMergeOverlayStyle] = useState<MergeOverlayStyle>(initialDraft?.mergeOverlayStyle ?? DEFAULT_MERGE_OVERLAY_STYLE);
  /**
   * 搜索关键字
   */
  const [searchKeyword, setSearchKeyword] = useState(initialDraft?.searchKeyword ?? '');
  /**
   * 制作人员过滤器
   */
  const [makerFilter, setMakerFilter] = useState(initialDraft?.makerFilter ?? 'all');
  /**
   * 是否正在加载镜头列表
   */
  const [loadingLenses, setLoadingLenses] = useState(false);
  /**
   * 当前正在解析的镜头ID
   */
  const [resolvingLensId, setResolvingLensId] = useState<string | null>(null);
  /**
   * 已勾选的镜头ID列表
   */
  const [checkedLensIds, setCheckedLensIds] = useState<string[]>(initialDraft?.checkedLensIds ?? []);
  /**
   * 创建任务的结果
   */
  const [createResult, setCreateResult] = useState(emptyCreateTaskResponse);
  /**
   * 是否正在创建任务
   */
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  /**
   * 叠加警告信息
   */
  const [overlayWarning, setOverlayWarning] = useState<string | null>(null);
  /**
   * 当前拖拽的镜头ID
   */
  const [draggingLensId, setDraggingLensId] = useState<string | null>(null);
  /**
   * 当前悬停的镜头ID（用于拖拽放置）
   */
  const [dragOverLensId, setDragOverLensId] = useState<string | null>(null);
  /**
   * 是否隐藏已加入的镜头
   */
  const [hideAddedLenses, setHideAddedLenses] = useState(initialDraft?.hideAddedLenses ?? false);
  /**
   * 最新成功任务ID
   */
  const [latestSuccessTaskId, setLatestSuccessTaskId] = useState<string | null>(null);
  /**
   * 设置存储对象
   */
  const { settings } = useSettingsStore();
  /**
   * 项目存储对象
   */
  const { activeProjectId, activeEpisodeId } = useProjectStore();
  /**
   * 任务存储对象
   */
  const { tasks, setTasks } = useTaskStore();
  /**
   * 已见任务状态的引用（用于追踪状态变化）
   */
  const seenTaskStatesRef = useRef<Record<string, string>>({});
  /**
   * 已水合的工作区键引用
   */
  const hydratedWorkspaceKeyRef = useRef<string | null>(null);
  /**
   * 工作区键（项目ID:集ID）
   */
  const workspaceKey = activeProjectId && activeEpisodeId ? `${activeProjectId}:${activeEpisodeId}` : '';

  /**
   * 当输出目录为空且设置中有默认输出目录时，自动填充输出目录
   */
  useEffect(() => {
    if (!outputDir && settings.defaultOutputDir) {
      setOutputDir(settings.defaultOutputDir);
    }
  }, [outputDir, settings.defaultOutputDir]);

  /**
   * 当工作区键或默认输出目录发生变化时，从本地存储恢复工作台草稿
   * 如果不存在草稿或草稿所属工作区不匹配，则创建默认草稿
   */
  useEffect(() => {
    if (hydratedWorkspaceKeyRef.current === workspaceKey) {
      return;
    }

    hydratedWorkspaceKeyRef.current = workspaceKey;
    const draft = readWorkbenchDraft();
    const nextDraft = draft?.workspaceKey === workspaceKey
      ? draft
      : createDefaultWorkbenchDraft(workspaceKey, settings.defaultOutputDir);

    setSelectedSourceKeyByLensId(nextDraft.selectedSourceKeyByLensId);
    setSelectedClips(nextDraft.selectedClips);
    setOutputDir(nextDraft.outputDir);
    setOutputName(nextDraft.outputName);
    setMergeMode(nextDraft.mergeMode);
    setMergeUpscaleMode(nextDraft.mergeUpscaleMode);
    setMergeOverlayStyle(nextDraft.mergeOverlayStyle);
    setSearchKeyword(nextDraft.searchKeyword);
    setMakerFilter(nextDraft.makerFilter);
    setCheckedLensIds(nextDraft.checkedLensIds);
    setHideAddedLenses(nextDraft.hideAddedLenses);
    setCreateResult(emptyCreateTaskResponse);
  }, [settings.defaultOutputDir, workspaceKey]);

  /**
   * 当工作台状态发生变化时，持久化工作台草稿到本地存储
   * 依赖所有可能影响工作台状态的变量
   */
  useEffect(() => {
    if (hydratedWorkspaceKeyRef.current !== workspaceKey) {
      return;
    }

    persistWorkbenchDraft({
      workspaceKey,
      selectedSourceKeyByLensId,
      selectedClips,
      outputDir,
      outputName,
      mergeMode,
      mergeUpscaleMode,
      mergeOverlayStyle,
      searchKeyword,
      makerFilter,
      checkedLensIds,
      hideAddedLenses,
    });
  }, [
    checkedLensIds,
    hideAddedLenses,
    makerFilter,
    mergeMode,
    mergeOverlayStyle,
    mergeUpscaleMode,
    outputDir,
    outputName,
    searchKeyword,
    selectedClips,
    selectedSourceKeyByLensId,
    workspaceKey,
  ]);

  /**
   * 自动清除叠加警告信息的效果
   * 当有警告信息时，2.5秒后自动清除
   */
  useEffect(() => {
    if (!overlayWarning) {
      return;
    }

    const timer = window.setTimeout(() => {
      setOverlayWarning(null);
    }, 2500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [overlayWarning]);

  /**
   * 刷新已完成的镜头列表
   * 从后端获取镜头信息并更新可用镜头、素材来源等状态
   */
  async function refreshCompletedLenses(): Promise<void> {
    // 如果没有活动项目或集数，清空镜头列表并返回
    if (!activeProjectId || !activeEpisodeId) {
      setAvailableLenses([]);
      setSelectedClips([]);
      return;
    }

    // 设置加载状态
    setLoadingLenses(true);
    try {
      // 获取镜头列表
      const response = await window.movtools.lens.list();
      if (!response.success) {
        // 如果获取失败，清空相关状态并设置错误信息
        setAvailableLenses([]);
        setSourceAvailabilityMap({});
        setCreateResult({ success: false, taskIds: [], error: response.error ?? '读取镜头列表失败。' });
        return;
      }

      // 更新可用镜头列表
      setAvailableLenses(response.lenses);
      // 为每个镜头并行获取详细信息以构建素材来源映射
      const sourceEntries = await Promise.all(response.lenses.map(async (lens) => {
        const detail = await window.movtools.lens.detail({ lensId: lens.lensId });
        return [lens.lensId, buildLensSourceAvailability(lens, detail.success ? detail.detail : undefined)] as const;
      }));
      const nextSourceAvailabilityMap = Object.fromEntries(sourceEntries);
      setSourceAvailabilityMap(nextSourceAvailabilityMap);
      
      // 更新镜头ID到素材源键的映射，优先保留用户之前的选择
      setSelectedSourceKeyByLensId((current) => {
        const next: Record<string, string> = {};
        for (const lens of response.lenses) {
          const currentKey = current[lens.lensId];
          const firstOptionKey = nextSourceAvailabilityMap[lens.lensId]?.options[0]?.key;
          // 如果当前选择仍然有效，则保留；否则使用第一个可用选项
          if (currentKey && nextSourceAvailabilityMap[lens.lensId]?.options.some((option) => option.key === currentKey)) {
            next[lens.lensId] = currentKey;
          } else if (firstOptionKey) {
            next[lens.lensId] = firstOptionKey;
          }
        }
        return next;
      });
      
      // 过滤掉不再存在的镜头片段
      setSelectedClips((current) => current.filter((clip) => response.lenses.some((lens) => lens.lensId === clip.lensId)));
      // 过滤掉不再存在的已勾选镜头
      setCheckedLensIds((current) => current.filter((lensId) => response.lenses.some((lens) => lens.lensId === lensId)));
    } finally {
      // 无论成功或失败，都结束加载状态
      setLoadingLenses(false);
    }
  }

  /**
   * 当活动项目或集数发生变化时，自动刷新已完成镜头列表
   */
  useEffect(() => {
    void refreshCompletedLenses();
  }, [activeEpisodeId, activeProjectId]);

  /**
   * 可用于审阅的镜头列表（已排除关闭状态的镜头，且具有可用素材来源或layout候选）
   * 按镜头号自然排序
   */
  const reviewPoolLenses = useMemo(
    () => availableLenses
      .filter((lens) => lens.lensStatus !== '关闭')
      .filter((lens) => {
        const availability = sourceAvailabilityMap[lens.lensId];
        return (availability?.options.length ?? 0) > 0 || lens.layoutCandidateCount > 0;
      })
      .sort((left, right) => compareLensCode(left.lensCode, right.lensCode)),
    [availableLenses, sourceAvailabilityMap],
  );

  /**
   * 经过搜索、制作人员过滤和隐藏已加入项过滤后的镜头列表
   */
  const filteredReviewPoolLenses = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    const selectedIdSet = new Set(selectedClips.map((clip) => clip.lensId));
    const visibleLenses = hideAddedLenses
      ? reviewPoolLenses.filter((lens) => !selectedIdSet.has(lens.lensId))
      : reviewPoolLenses;
    const makerMatchedLenses = makerFilter === 'all'
      ? visibleLenses
      : visibleLenses.filter((lens) => (lens.maker || '未填写制作人员') === makerFilter);

    if (!keyword) {
      return makerMatchedLenses;
    }

    return makerMatchedLenses.filter((lens) => [lens.lensCode, lens.lensName, lens.maker, lens.versionNum].some((value) => value.toLowerCase().includes(keyword)));
  }, [hideAddedLenses, makerFilter, reviewPoolLenses, searchKeyword, selectedClips]);

  /**
   * 可用制作人员选项列表（去重并按汉字排序）
   * 用于制作人员过滤下拉菜单
   */
  const makerOptions = useMemo(() => {
    const values = Array.from(new Set(reviewPoolLenses.map((lens) => lens.maker || '未填写制作人员')));
    return values.sort((left, right) => left.localeCompare(right, 'zh-CN'));
  }, [reviewPoolLenses]);

  /**
   * 可直接用于拼接的镜头列表（具有可用素材来源的镜头）
   */
  const usableReviewPoolLenses = useMemo(
    () => filteredReviewPoolLenses.filter((lens) => Boolean(getPreferredSourceOption(lens))),
    [filteredReviewPoolLenses, selectedSourceKeyByLensId, sourceAvailabilityMap],
  );

  /**
   * 仅有layout线索但无法直接拼接的镜头列表
   * 这些镜头只有layout版本但没有对应的可用视频源
   */
  const layoutOnlyReviewPoolLenses = useMemo(
    () => filteredReviewPoolLenses.filter((lens) => !getPreferredSourceOption(lens) && sourceAvailabilityMap[lens.lensId]?.hasLayoutCandidate),
    [filteredReviewPoolLenses, selectedSourceKeyByLensId, sourceAvailabilityMap],
  );

  const latestSuccessTask = useMemo(() => tasks.find((task) => task.id === latestSuccessTaskId) ?? null, [latestSuccessTaskId, tasks]);

  useEffect(() => {
    for (const task of tasks) {
      const previousStatus = seenTaskStatesRef.current[task.id];
      seenTaskStatesRef.current[task.id] = task.status;
      if (task.type === 'merge-video' && task.status === 'success' && previousStatus !== 'success') {
        setLatestSuccessTaskId(task.id);
      }
    }
  }, [tasks]);

  const selectedLensIds = useMemo(() => new Set(selectedClips.map((clip) => clip.lensId)), [selectedClips]);
  const checkedLensIdSet = useMemo(() => new Set(checkedLensIds), [checkedLensIds]);
  const isWorkbenchEnvironmentReady = Boolean(
    environmentStatus?.ffmpeg.available
    && environmentStatus?.ffprobe.available,
  );

  const validationMessage = useMemo(() => {
    if (!activeProjectId || !activeEpisodeId) {
      return '请先在“项目”页选择当前项目和当前集。';
    }

    if (selectedClips.length === 0) {
      return '请先从镜头池加入要拼接的镜头。';
    }

    if (selectedClips.length === 1) {
      return '至少需要 2 条镜头才能开始拼接。';
    }

    if (!isWorkbenchEnvironmentReady) {
      return '请先完成 FFmpeg / FFprobe 设置。';
    }

    if (selectedClips.some((clip) => clip.movPath.trim().length === 0)) {
      return '拼接列表中存在未解析到 mov 路径的镜头，请移除后重试。';
    }

    if (!validateMergeInput(selectedClips.map((clip) => clip.movPath), outputName)) {
      return '请填写合法的输出文件名，并保证拼接列表至少有 2 条镜头。';
    }

    if (outputDir.trim().length === 0) {
      return '请选择输出目录。';
    }

    return null;
  }, [activeEpisodeId, activeProjectId, isWorkbenchEnvironmentReady, outputDir, outputName, selectedClips]);

  const mergeResolutionSummary = useMemo(() => {
    const sizedClips = selectedClips.filter((clip) => clip.width && clip.height);
    const resolutionKeys = new Set(sizedClips.map((clip) => `${clip.width}x${clip.height}`));
    const hasLayoutFallback = selectedClips.some((clip) => clip.sourceKind === 'layout-video');
    const hasOverlayNotes = selectedClips.some((clip) => Boolean(clip.note?.trim()));
    const hasFileNameOverlay = selectedClips.length > 0;
    const hasMixedResolution = resolutionKeys.size > 1;
    const targetWidth = sizedClips.length > 0 ? Math.max(...sizedClips.map((clip) => clip.width ?? 0)) : undefined;
    const targetHeight = sizedClips.length > 0 ? Math.max(...sizedClips.map((clip) => clip.height ?? 0)) : undefined;
    return {
      hasLayoutFallback,
      hasOverlayNotes,
      hasFileNameOverlay,
      hasMixedResolution,
      shouldUseCompatible: hasLayoutFallback || hasMixedResolution || hasOverlayNotes || hasFileNameOverlay,
      targetWidth,
      targetHeight,
    };
  }, [selectedClips]);

  useEffect(() => {
    if (!mergeResolutionSummary.shouldUseCompatible) {
      setMergeModeHint('');
      return;
    }

    if (mergeMode === 'fast') {
      setMergeMode('compatible');
    }

    const targetLabel = mergeResolutionSummary.targetWidth && mergeResolutionSummary.targetHeight
      ? `${mergeResolutionSummary.targetWidth}×${mergeResolutionSummary.targetHeight}`
      : '统一画幅';
    if (mergeResolutionSummary.hasMixedResolution) {
      setMergeModeHint(`检测到混合分辨率素材，已自动切换为兼容拼接；小分辨率片段会${mergeUpscaleMode === 'stretch' ? '拉伸铺满' : '放大并补边到'} ${targetLabel}。`);
      return;
    }

    if (mergeResolutionSummary.hasFileNameOverlay && !mergeResolutionSummary.hasOverlayNotes) {
      setMergeModeHint('成片会在每个镜头底部中间附加当前视频文件名，因此已使用兼容拼接。');
      return;
    }

    if (mergeResolutionSummary.hasLayoutFallback) {
      setMergeModeHint(`检测到 Layout 回退素材，已自动切换为兼容拼接；当前将按“${mergeUpscaleMode === 'stretch' ? '直接拉伸铺满' : '等比放大并补边'}”处理较小画幅。`);
      return;
    }

    setMergeModeHint('检测到镜头备注叠字需求，已自动切换为兼容拼接；成片会在对应镜头显示备注，并在底部中间附加视频文件名。');
  }, [mergeMode, mergeResolutionSummary, mergeUpscaleMode]);

   /**
    * 获取指定镜头的首选素材来源选项
    * @param lens - 镜头记录对象
    * @returns 返回首选的素材来源选项，如果没有可用选项则返回null
    * 
    * 优先级：用户之前选择的来源 > 第一个可用来源
    */
   function getPreferredSourceOption(lens: LensRecord): LensSourceOption | null {
     const availability = sourceAvailabilityMap[lens.lensId];
     if (!availability || availability.options.length === 0) {
       return null;
     }

     const selectedKey = selectedSourceKeyByLensId[lens.lensId];
     return availability.options.find((option) => option.key === selectedKey) ?? availability.options[0] ?? null;
   }

   /**
    * 处理镜头素材来源变更事件
    * 当用户在镜头卡片中切换素材来源时调用
    * @param lensId - 镜头唯一标识
    * @param sourceKey - 新选择的素材来源键
    */
   function handleSourceChange(lensId: string, sourceKey: string): void {
     setSelectedSourceKeyByLensId((current) => ({ ...current, [lensId]: sourceKey }));
     setSelectedClips((current) => current.map((clip) => {
       if (clip.lensId !== lensId) {
         return clip;
       }

       const option = sourceAvailabilityMap[lensId]?.options.find((item) => item.key === sourceKey);
       if (!option) {
         return clip;
       }

       return {
         ...clip,
         sourceKind: option.kind,
         sourceLabel: option.label,
         versionNum: option.versionNum,
         movPath: option.path,
         width: option.width,
         height: option.height,
         note: clip.note ?? '',
       };
     }));
   }

   /**
    * 处理镜头备注变更事件
    * 当用户在镜头卡片中编辑备注时调用
    * @param lensId - 镜头唯一标识
    * @param note - 新的备注内容
    */
   function handleClipNoteChange(lensId: string, note: string): void {
     setSelectedClips((current) => current.map((clip) => clip.lensId === lensId ? { ...clip, note } : clip));
   }

   /**
    * 处理添加镜头到拼接列表的事件
    * 当用户点击镜头卡片的"加入拼接"按钮时调用
    * @param lens - 要添加的镜头记录对象
    */
   async function handleAddLens(lens: LensRecord): Promise<void> {
     // 防止重复添加同一镜头
     if (selectedLensIds.has(lens.lensId)) {
       setCreateResult({ success: false, taskIds: [], error: `镜头 ${lens.lensCode} 已在拼接列表中。` });
       return;
     }

     // 设置正在解析的镜头ID，用于UI反馈
     setResolvingLensId(lens.lensId);
     try {
       // 获取首选素材来源选项
       const sourceOption = getPreferredSourceOption(lens);
       if (!sourceOption) {
         // 如果没有可用素材来源，根据是否有layout线索给出不同错误信息
         const availability = sourceAvailabilityMap[lens.lensId];
         setCreateResult({ 
           success: false, 
           taskIds: [], 
           error: availability?.hasLayoutCandidate 
             ? `镜头 ${lens.lensCode} 当前只有 layout 线索，尚无可直接拼接的视频源。` 
             : `镜头 ${lens.lensCode} 当前没有可用视频源。` 
         });
         return;
       }

       // 将新镜头添加到选中的片段列表中
       setSelectedClips((current) => [
         ...current,
         {
           lensId: lens.lensId,
           lensCode: lens.lensCode,
           lensName: lens.lensName,
           maker: lens.maker,
           sceneNo: lens.sceneNo,
           sourceKind: sourceOption.kind,
           sourceLabel: sourceOption.label,
           versionNum: sourceOption.versionNum,
           movPath: sourceOption.path,
           width: sourceOption.width,
           height: sourceOption.height,
           note: '',
         },
       ]);
       // 清空创建任务结果
       setCreateResult(emptyCreateTaskResponse);
     } catch (error) {
       // 捕获并处理异常
       setCreateResult({ 
         success: false, 
         taskIds: [], 
         error: error instanceof Error ? error.message : '加入拼接列表失败。' 
       });
     } finally {
       // 无论成功或失败，都重置解析状态
       setResolvingLensId(null);
     }
   }

   /**
    * 移动选中的镜头片段在列表中的位置
    * 用于拖拽排序或通过按钮调整顺序
    * @param index - 要移动的片段在列表中的索引位置
    * @param direction - 移动方向：-1表示向上移动，1表示向下移动
    */
   function moveSelectedClip(index: number, direction: -1 | 1): void {
     setSelectedClips((current) => {
       const nextIndex = index + direction;
       if (nextIndex < 0 || nextIndex >= current.length) {
         return current;
       }

       const next = [...current];
       const [item] = next.splice(index, 1);
       next.splice(nextIndex, 0, item);
       return next;
     });
   }

   /**
    * 从选中的片段列表中移除指定索引的镜头
    * @param index - 要移除的片段在列表中的索引位置
    */
   function removeSelectedClip(index: number): void {
     setSelectedClips((current) => current.filter((_, currentIndex) => currentIndex !== index));
   }

   /**
    * 切换镜头的勾选状态
    * 如果镜头已经被勾选则取消勾选，否则勾选它
    * @param lensId - 镜头唯一标识
    */
   function toggleLensChecked(lensId: string): void {
     setCheckedLensIds((current) => current.includes(lensId) ? current.filter((item) => item !== lensId) : [...current, lensId]);
   }

   /**
    * 勾选当前可见的所有镜头（已过滤的镜头列表中未被选中的镜头）
    * 用于"勾选当前可见项"按钮的点击处理
    */
   function handleCheckAllFiltered(): void {
     const availableIds = usableReviewPoolLenses.filter((lens) => !selectedLensIds.has(lens.lensId)).map((lens) => lens.lensId);
     setCheckedLensIds(availableIds);
   }

   /**
    * 清除所有已勾选的镜头
    * 用于"清空勾选"按钮的点击处理
    */
   function handleClearChecked(): void {
     setCheckedLensIds([]);
   }

   /**
    * 反选当前可见的所有镜头
    * 将未勾选的镜头设为勾选状态，将已勾选的镜头设为未勾选状态
    * 仅作用于当前可见的镜头列表（已应用搜索、制作人员过滤和隐藏已加入项过滤后的结果）
    */
   function handleInvertFiltered(): void {
     const toggleIds = usableReviewPoolLenses.filter((lens) => !selectedLensIds.has(lens.lensId)).map((lens) => lens.lensId);
     setCheckedLensIds((current) => {
       const currentSet = new Set(current);
       // 返回：应该被勾选的镜头（当前可见但未勾选的）+ 应该保持勾选的镜头（当前不可见但已勾选的）
       return toggleIds.filter((lensId) => !currentSet.has(lensId)).concat(current.filter((lensId) => !toggleIds.includes(lensId)));
     });
   }

   /**
    * 根据镜头ID移动片段在列表中的位置
    * 将源镜头片段移动到目标镜头片段的位置
    * @param sourceLensId - 源镜头唯一标识
    * @param targetLensId - 目标镜头唯一标识
    */
   function moveClipByLensId(sourceLensId: string, targetLensId: string): void {
     if (sourceLensId === targetLensId) {
       return;
     }

     setSelectedClips((current) => {
       const sourceIndex = current.findIndex((clip) => clip.lensId === sourceLensId);
       const targetIndex = current.findIndex((clip) => clip.lensId === targetLensId);
       if (sourceIndex < 0 || targetIndex < 0) {
         return current;
       }

       const next = [...current];
       const [sourceItem] = next.splice(sourceIndex, 1);
       next.splice(targetIndex, 0, sourceItem);
       return next;
     });
   }

   /**
    * 处理镜头卡片拖拽开始事件
    * 当用户开始拖拽镜头卡片时设置拖拽状态
    * @param lensId - 被拖拽的镜头唯一标识
    */
   function handleClipDragStart(lensId: string): void {
     setDraggingLensId(lensId);
     setDragOverLensId(lensId);
   }

   /**
    * 处理镜头卡片拖拽悬停事件
    * 当拖拽中的镜头卡片悬停在另一个镜头卡片上时更新悬停目标
    * @param event - DragEvent对象
    * @param lensId - 被悬停的镜头唯一标识
    */
   function handleClipDragOver(event: DragEvent<HTMLDivElement>, lensId: string): void {
     event.preventDefault();
     if (dragOverLensId !== lensId) {
       setDragOverLensId(lensId);
     }
   }

  function handleClipDrop(targetLensId: string): void {
    if (draggingLensId) {
      moveClipByLensId(draggingLensId, targetLensId);
    }
    setDraggingLensId(null);
    setDragOverLensId(null);
  }

  function handleClipDragEnd(): void {
    setDraggingLensId(null);
    setDragOverLensId(null);
  }

  function handleOverlayNumberChange(
    key: 'fontSize' | 'fontOpacity' | 'backgroundOpacity' | 'boxPadding' | 'offsetX' | 'offsetY',
    rawValue: number,
    min: number,
    max: number,
    warningMessage: string,
  ): void {
    const nextValue = clampInteger(rawValue, min, max);
    if (nextValue !== Math.trunc(rawValue)) {
      setOverlayWarning(warningMessage);
    }

    setMergeOverlayStyle((current) => ({
      ...current,
      [key]: nextValue,
    }));
  }

   /**
    * 处理创建拼接任务的事件
    * 当用户点击"开始拼接"按钮时调用
    * 进行验证、准备任务数据并调用后端API创建任务
    */
   async function handleCreateTasks(): Promise<void> {
     // 防止重复点击
     if (isCreatingTask) {
       return;
     }

     // 如果有验证错误，直接返回错误结果
     if (validationMessage) {
       setCreateResult({ success: false, taskIds: [], error: validationMessage });
       return;
     }

     // 设置创建任务状态
     setIsCreatingTask(true);
     // 初始化创建结果
     setCreateResult({ success: true, taskIds: [] });

     try {
       // 准备任务创建所需的数据
       const items: CreateTaskItem[] = [{
         inputPath: selectedClips[0].movPath,
         outputDir: outputDir.trim(),
         mergeLensCodes: selectedClips.map((clip) => clip.lensCode),
         payload: {
           type: 'merge-video',
           config: {
             inputPaths: selectedClips.map((clip) => clip.movPath),
             mode: mergeMode,
             upscaleMode: mergeUpscaleMode,
             overlayTexts: selectedClips.map((clip) => clip.note?.trim() ?? ''),
             overlayStyle: normalizeMergeOverlayStyle(mergeOverlayStyle),
             outputName: outputName.trim(),
             outputFormat: 'mp4',
           },
         },
       }];

       // 调用后端API创建任务
       const response = await window.movtools.task.create({ items });
       if (!response.success || response.taskIds.length === 0) {
         // 如果创建失败，设置错误结果并返回
         setCreateResult({ success: false, taskIds: [], error: response.error ?? '拼接任务创建失败，未返回任务编号。' });
         return;
       }

       // 更新创建结果和任务列表
       setCreateResult(response);
       const latestTasks = await window.movtools.task.list();
       setTasks(latestTasks);
     } catch (error) {
       // 捕获并处理异常
       setCreateResult({
         success: false,
         taskIds: [],
         error: error instanceof Error ? error.message : '开始拼接失败。',
       });
     } finally {
       // 无论成功或失败，都重置创建任务状态
       setIsCreatingTask(false);
     }
   }

   /**
    * 处理批量添加所有可见镜头到拼接列表的事件
    * 当用户点击"按镜头顺序全部加入"按钮时调用
    * 将当前可见的镜头列表中未被选中的镜头全部添加到拼接顺序中
    */
   async function handleAddAllLenses(): Promise<void> {
     // 获取当前可见且未被选中的镜头列表
     const remainingLenses = reviewPoolLenses.filter((lens) => !selectedLensIds.has(lens.lensId));
     // 如果没有可添加的镜头，直接返回错误
     if (remainingLenses.length === 0) {
       setCreateResult({ success: false, taskIds: [], error: '当前没有可新增到拼接列表的镜头。' });
       return;
     }

     // 设置正在批量处理的标识，用于UI反馈
     setResolvingLensId('__bulk__');
     try {
       // 准备要添加的镜头片段列表
       const clips: SelectedLensClip[] = [];

       // 遍历所有可见且未被选中的镜头
       for (const lens of remainingLenses) {
         // 获取首选素材来源选项
         const sourceOption = getPreferredSourceOption(lens);
         // 如果没有可用素材来源
         if (!sourceOption) {
           // 如果只有layout线索，给出特定错误信息然后跳过当前镜头
           if (sourceAvailabilityMap[lens.lensId]?.hasLayoutCandidate) {
             setCreateResult({ success: false, taskIds: [], error: `镜头 ${lens.lensCode} 仅有 layout 线索，已跳过。` });
           }
           continue;
         }

         // 将符合条件的镜头添加到待添加列表中
         clips.push({
           lensId: lens.lensId,
           lensCode: lens.lensCode,
           lensName: lens.lensName,
           maker: lens.maker,
           sceneNo: lens.sceneNo,
           sourceKind: sourceOption.kind,
           sourceLabel: sourceOption.label,
           versionNum: sourceOption.versionNum,
           movPath: sourceOption.path,
           width: sourceOption.width,
           height: sourceOption.height,
           note: '',
         });
       }

       // 如果没有有效的镜头可以添加，直接返回
       if (clips.length === 0) {
         return;
       }

       // 将新镜头添加到选中的片段列表中
       setSelectedClips((current) => [...current, ...clips]);
       // 清空已勾选的镜头列表
       setCheckedLensIds([]);
       // 清空创建任务结果
       setCreateResult(emptyCreateTaskResponse);
     } catch (error) {
       // 捕获并处理异常
       setCreateResult({ success: false, taskIds: [], error: error instanceof Error ? error.message : '批量加入拼接列表失败。' });
     } finally {
       // 无论成功或失败，都重置批量处理标识
       setResolvingLensId(null);
     }
   }

   /**
    * 处理批量添加已勾选镜头到拼接列表的事件
    * 当用户点击"加入勾选项"按钮时调用
    * 将当前可见的镜头列表中已被勾选但未加入拼接列表的镜头全部添加到拼接顺序中
    */
   async function handleAddCheckedLenses(): Promise<void> {
     // 获取当前可见且已勾选但未被选中的镜头列表
     const checkedLenses = reviewPoolLenses.filter((lens) => checkedLensIdSet.has(lens.lensId) && !selectedLensIds.has(lens.lensId));
     // 如果没有可添加的镜头，直接返回错误
     if (checkedLenses.length === 0) {
       setCreateResult({ success: false, taskIds: [], error: '请先勾选要加入拼接列表的镜头。' });
       return;
     }

     // 设置正在处理勾选项的标识，用于UI反馈
     setResolvingLensId('__checked__');
     try {
       // 准备要添加的镜头片段列表
       const clips: SelectedLensClip[] = [];

       // 遍历所有可见且已勾选但未被选中的镜头
       for (const lens of checkedLenses) {
         // 获取首选素材来源选项
         const sourceOption = getPreferredSourceOption(lens);
         // 如果没有可用素材来源
         if (!sourceOption) {
           // 如果只有layout线索，给出特定错误信息然后跳过当前镜头
           if (sourceAvailabilityMap[lens.lensId]?.hasLayoutCandidate) {
             setCreateResult({ success: false, taskIds: [], error: `镜头 ${lens.lensCode} 仅有 layout 线索，已跳过。` });
           }
           continue;
         }

         // 将符合条件的镜头添加到待添加列表中
         clips.push({
           lensId: lens.lensId,
           lensCode: lens.lensCode,
           lensName: lens.lensName,
           maker: lens.maker,
           sceneNo: lens.sceneNo,
           sourceKind: sourceOption.kind,
           sourceLabel: sourceOption.label,
           versionNum: sourceOption.versionNum,
           movPath: sourceOption.path,
           width: sourceOption.width,
           height: sourceOption.height,
           note: '',
         });
       }

       // 如果没有有效的镜头可以添加，直接返回
       if (clips.length === 0) {
         return;
       }

       // 将新镜头添加到选中的片段列表中
       setSelectedClips((current) => [...current, ...clips]);
       // 清空已勾选的镜头列表
       setCheckedLensIds([]);
       // 清空创建任务结果
       setCreateResult(emptyCreateTaskResponse);
     } catch (error) {
       // 捕获并处理异常
       setCreateResult({ success: false, taskIds: [], error: error instanceof Error ? error.message : '批量加入拼接列表失败。' });
     } finally {
       // 无论成功或失败，都重置处理勾选项的标识
       setResolvingLensId(null);
     }
   }

  function handleSortSelectedClips(): void {
    setSelectedClips((current) => [...current].sort((left, right) => compareLensCode(left.lensCode, right.lensCode)));
    setCreateResult(emptyCreateTaskResponse);
  }

  function handleClearSelectedClips(): void {
    setSelectedClips([]);
    setCreateResult(emptyCreateTaskResponse);
  }

  async function handleCancelTask(taskId: string): Promise<void> {
    const response = await window.movtools.task.cancel({ taskId });
    if (!response.success) {
      setCreateResult({ success: false, taskIds: [], error: '当前任务状态下无法取消。' });
      return;
    }

    setCreateResult({ success: true, taskIds: [taskId] });
  }

  async function handleRetryTask(taskId: string): Promise<void> {
    const response = await window.movtools.task.retry({ taskId });
    if (!response.success) {
      setCreateResult({ success: false, taskIds: [], error: response.error ?? '当前任务无法重试。' });
      return;
    }

    setCreateResult({ success: true, taskIds: [taskId] });
    const latestTasks = await window.movtools.task.list();
    setTasks(latestTasks);
  }

  async function handleRemoveTask(taskId: string): Promise<void> {
    const response = await window.movtools.task.remove({ taskId });
    if (!response.success) {
      setCreateResult({ success: false, taskIds: [], error: response.error ?? '当前任务无法移除。' });
      return;
    }

    const latestTasks = await window.movtools.task.list();
    setTasks(latestTasks);
  }

  async function handleClearCompleted(): Promise<void> {
    const response = await window.movtools.task.clearCompleted();
    if (!response.success) {
      setCreateResult({ success: false, taskIds: [], error: response.error ?? '无法清空已完成任务。' });
      return;
    }

    const latestTasks = await window.movtools.task.list();
    setTasks(latestTasks);
  }

  return (
    <section className="page-layout">
      <header className="page-header lens-page-header">
        <div>
          <p className="eyebrow">工作台</p>
          <h2>镜头表演连续拼接</h2>
          <div className="page-header-tags">
            <span className="page-header-tag">连续拼接</span>
            <span className="page-header-tag">多源回退</span>
            <span className="page-header-tag">任务队列</span>
          </div>
          <p className="muted">以连续检查表演为目标：优先使用当前版本视频，不足时回退历史版本视频；若历史版本也没有，则继续回退到 layout 版本视频。</p>
        </div>
        <div className="page-header-actions home-page-actions">
          <p className="muted">先选已完成镜头，再调整顺序并提交拼接任务。</p>
          <div className="actions-row compact-actions wrap-actions">
            <button className="secondary-button" onClick={() => void refreshCompletedLenses()} type="button">刷新镜头池</button>
            <button className="secondary-button" onClick={onOpenLogs} type="button">查看日志</button>
            <button className="secondary-button" onClick={onOpenSettings} type="button">打开设置</button>
          </div>
        </div>
      </header>

      <section className="panel stack-gap home-environment-shell">
        <div className="section-heading home-panel-header">
          <div>
            <h3>环境检查</h3>
            <p className="muted">工作台仅关心 FFmpeg、FFprobe 与输出目录；默认收起，避免长期占据主视区。</p>
          </div>
          <div className="actions-row compact-actions wrap-actions home-environment-actions">
            <span className={environmentStatus?.isReady ? 'success-copy' : 'danger-copy'}>{environmentStatus?.isReady ? '当前已就绪' : '当前待处理'}</span>
            <button className="secondary-button" onClick={() => setShowEnvironmentPanel((current) => !current)} type="button">
              {showEnvironmentPanel ? '收起环境检查' : '展开环境检查'}
            </button>
          </div>
        </div>

        {showEnvironmentPanel ? (
            <EnvironmentStatusCard
              isLoading={environmentLoading}
            onDismissGuide={onDismissFirstLaunchGuide}
            onOpenSettings={onOpenSettings}
            onOpenUsageManual={onOpenUsageManual}
            onRefresh={onRefreshEnvironmentStatus}
            showFirstLaunchGuide={showFirstLaunchGuide}
            status={environmentStatus}
          />
        ) : (
          <div className="workbench-tip-card home-environment-collapsed-card">
            <strong>{environmentStatus?.isReady ? '环境已配置完成' : '环境检查未通过'}</strong>
            <p className="muted">
              {getWorkbenchEnvironmentSummary(environmentStatus)}
            </p>
          </div>
        )}
      </section>

      <div className="home-workbench-stack">
        <section className="panel stack-gap home-pool-panel">
          <div className="section-heading home-panel-header">
            <div>
              <h3>镜头池</h3>
              <div className="section-heading-tags">
                <span className="section-heading-tag">素材入口</span>
                <span className="section-heading-tag">镜头筛选</span>
              </div>
              <p className="muted">展示当前集可用于连续看表演的镜头：当前版本视频优先，其次历史版本视频；如果历史版本也没有，则使用 layout 版本视频。</p>
            </div>
            <div className="actions-row compact-actions wrap-actions home-pool-actions">
              <span className="muted">可拼接 {usableReviewPoolLenses.length} 条 · 待补视频 {layoutOnlyReviewPoolLenses.length} 条</span>
              <button className="secondary-button" disabled={usableReviewPoolLenses.length === 0} onClick={handleInvertFiltered} type="button">反选当前可拼接结果</button>
              <button className="secondary-button" disabled={usableReviewPoolLenses.length === 0} onClick={handleCheckAllFiltered} type="button">勾选当前可拼接结果</button>
              <button className="secondary-button" disabled={checkedLensIds.length === 0} onClick={handleClearChecked} type="button">清空勾选</button>
              <button className="secondary-button" disabled={checkedLensIds.length === 0 || resolvingLensId === '__checked__'} onClick={() => void handleAddCheckedLenses()} type="button">
                {resolvingLensId === '__checked__' ? '批量加入中…' : `加入勾选项${checkedLensIds.length > 0 ? `（${checkedLensIds.length}）` : ''}`}
              </button>
              <button className="secondary-button" disabled={usableReviewPoolLenses.length === 0 || resolvingLensId === '__bulk__'} onClick={() => void handleAddAllLenses()} type="button">
                {resolvingLensId === '__bulk__' ? '加入中…' : '按镜头顺序全部加入'}
              </button>
            </div>
          </div>

          <label className="field">
            <span>搜索镜头</span>
            <input onChange={(event) => setSearchKeyword(event.target.value)} placeholder="镜头编号 / 名称 / 制作人员 / 版本号" value={searchKeyword} />
          </label>

          <label className="field">
            <span>制作人员</span>
            <select value={makerFilter} onChange={(event) => setMakerFilter(event.target.value)}>
              <option value="all">全部制作人员</option>
              {makerOptions.map((maker) => <option key={maker} value={maker}>{maker}</option>)}
            </select>
          </label>

          <label className="checkbox-field">
            <input checked={hideAddedLenses} onChange={(event) => setHideAddedLenses(event.target.checked)} type="checkbox" />
            <span>去除已加入项</span>
          </label>

          <div className="shot-pool-list shot-pool-list--grid">
            {!activeProjectId || !activeEpisodeId ? <p className="muted">请先在“项目”页选择当前项目和当前集。</p> : null}
            {activeProjectId && activeEpisodeId && loadingLenses ? <p className="muted">正在读取当前集镜头…</p> : null}
            {activeProjectId && activeEpisodeId && !loadingLenses && filteredReviewPoolLenses.length === 0 ? <p className="muted">当前没有可用于连续拼接的镜头，或搜索结果为空。</p> : null}
            {usableReviewPoolLenses.length > 0 ? (
              <div className="shot-pool-section">
                <div className="section-heading shot-pool-section__header">
                  <div>
                    <h4>可直接拼接</h4>
                    <p className="muted">这些镜头已找到可用视频源，可直接加入拼接顺序。</p>
                  </div>
                  <span className="environment-pill ready">{usableReviewPoolLenses.length} 条</span>
                </div>
                <div className="shot-pool-list shot-pool-list--grid shot-pool-section__grid">
            {usableReviewPoolLenses.map((lens) => {
              const availability = sourceAvailabilityMap[lens.lensId];
              const selectedSource = getPreferredSourceOption(lens);
              const canAdd = Boolean(selectedSource);
              return (
              <article className={selectedLensIds.has(lens.lensId) ? 'shot-pool-card active' : 'shot-pool-card'} key={lens.lensId}>
                <label className="shot-pool-checkbox">
                  <input checked={checkedLensIdSet.has(lens.lensId)} disabled={selectedLensIds.has(lens.lensId) || !canAdd} onChange={() => toggleLensChecked(lens.lensId)} type="checkbox" />
                </label>
                <div className="shot-pool-card__meta">
                  <strong>{lens.lensCode}</strong>
                  <p className="muted">{lens.lensName || lens.lensCode}</p>
                  <small className="muted">场次 {lens.sceneNo || 0} · {lens.maker || '未填写制作人员'} · 状态 {lens.lensStatus}</small>
                  {canAdd ? <span className={selectedSource?.kind === 'current-mov' ? 'environment-pill ready home-source-pill' : 'environment-pill warning home-source-pill'}>{selectedSource?.kind === 'history-mov' ? '历史素材' : selectedSource?.kind === 'layout-video' ? 'Layout素材' : '当前素材'}</span> : null}
                  <small className={canAdd ? selectedSource?.kind === 'current-mov' ? 'success-copy' : 'warning-copy' : availability?.hasLayoutCandidate ? 'warning-copy' : 'danger-copy'}>
                    {availability?.note ?? '正在分析可用素材源...'}
                  </small>
                  {availability && availability.options.length > 1 ? (
                    <label className="field shot-pool-source-field">
                      <span>拼接源</span>
                      <select value={selectedSourceKeyByLensId[lens.lensId] ?? availability.options[0]?.key ?? ''} onChange={(event) => handleSourceChange(lens.lensId, event.target.value)}>
                        {availability.options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {!canAdd && availability?.hasLayoutCandidate ? <small className="muted">已有 layout 线索，但尚未匹配到可直接拼接的 layout 视频。</small> : null}
                </div>
                <button
                  className="secondary-button"
                  disabled={selectedLensIds.has(lens.lensId) || resolvingLensId === lens.lensId || !canAdd}
                  onClick={() => void handleAddLens(lens)}
                  type="button"
                >
                  {selectedLensIds.has(lens.lensId) ? '已加入' : !canAdd ? '暂无视频源' : resolvingLensId === lens.lensId ? '读取中…' : '加入拼接'}
                </button>
              </article>
            );})}
                </div>
              </div>
            ) : null}

            {layoutOnlyReviewPoolLenses.length > 0 ? (
              <div className="shot-pool-section shot-pool-section--pending">
                <div className="section-heading shot-pool-section__header">
                  <div>
                    <h4>待补视频</h4>
                    <p className="muted">这些镜头目前只有 layout 线索，但没有匹配到当前/历史/layout 可用视频。</p>
                  </div>
                  <span className="environment-pill warning">{layoutOnlyReviewPoolLenses.length} 条</span>
                </div>
                <div className="shot-pool-list shot-pool-list--grid shot-pool-section__grid">
                  {layoutOnlyReviewPoolLenses.map((lens) => {
                    const availability = sourceAvailabilityMap[lens.lensId];
                    return (
                      <article className="shot-pool-card shot-pool-card--pending" key={lens.lensId}>
                        <label className="shot-pool-checkbox">
                          <input disabled type="checkbox" />
                        </label>
                        <div className="shot-pool-card__meta">
                          <strong>{lens.lensCode}</strong>
                          <p className="muted">{lens.lensName || lens.lensCode}</p>
                          <small className="muted">场次 {lens.sceneNo || 0} · {lens.maker || '未填写制作人员'} · 状态 {lens.lensStatus}</small>
                          <span className="environment-pill warning home-source-pill">待补视频</span>
                          <small className="warning-copy">{availability?.note ?? '仅有 layout 线索，暂无可直接拼接视频。'}</small>
                          <small className="muted">可先补充当前/历史版本视频；如果已存在 layout 版本视频，系统会自动把它加入上方可拼接分组。</small>
                        </div>
                        <button className="secondary-button" disabled type="button">
                          暂无视频源
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel stack-gap home-selected-panel">
          <div className="section-heading home-panel-header">
            <div>
              <h3>拼接顺序</h3>
              <div className="section-heading-tags">
                <span className="section-heading-tag">可拖拽排序</span>
                <span className="section-heading-tag">兼容拼接</span>
              </div>
              <p className="muted">按最终出片顺序整理镜头卡牌。至少需要 2 条，可拖拽或通过按钮调整顺序。</p>
            </div>
            <div className="actions-row compact-actions wrap-actions home-selected-actions">
              <span className="muted">已选 {selectedClips.length} 条</span>
              <button className="secondary-button" disabled={selectedClips.length < 2} onClick={handleSortSelectedClips} type="button">按镜头号重排</button>
              <button className="secondary-button" disabled={selectedClips.length === 0} onClick={handleClearSelectedClips} type="button">清空拼接列表</button>
            </div>
          </div>

          <div className="workbench-tip-card home-tip-card">
            <strong>拼接前检查</strong>
            <p className="muted">{validationMessage ?? '已满足拼接条件。你可以继续微调顺序，或直接开始拼接。'}</p>
            {mergeModeHint ? <p className="warning-copy">{mergeModeHint}</p> : null}
          </div>

          {latestSuccessTask ? (
              <div className="workbench-result-card home-result-card">
              <div>
                <strong>最近一次拼接已完成</strong>
                <p className="muted">输出文件：{latestSuccessTask.outputPath}</p>
                {typeof latestSuccessTask.outputFrameCount === 'number' ? <p className="muted">总帧数：{latestSuccessTask.outputFrameCount}</p> : null}
                {latestSuccessTask.mergeLensCodes?.length ? <p className="muted">镜头顺序：{latestSuccessTask.mergeLensCodes.join(' / ')}</p> : null}
              </div>
              <button className="secondary-button" onClick={() => setLatestSuccessTaskId(null)} type="button">关闭摘要</button>
            </div>
          ) : null}

          <div className="form-grid home-merge-settings-grid home-merge-settings-panel">
            <label className="field">
              <span>输出文件名</span>
              <input onChange={(event) => setOutputName(event.target.value)} value={outputName} />
            </label>

            <label className="field">
              <span>拼接模式</span>
              <select value={mergeMode} onChange={(event) => setMergeMode(event.target.value as 'fast' | 'compatible')}>
                <option disabled value="fast">快速拼接（当前因文件名叠字不可用）</option>
                <option value="compatible">兼容拼接（自动统一编码与分辨率，更稳）</option>
              </select>
            </label>

            <label className="field">
              <span>小分辨率处理</span>
              <select disabled={mergeMode !== 'compatible'} value={mergeUpscaleMode} onChange={(event) => setMergeUpscaleMode(event.target.value as 'pad' | 'stretch')}>
                <option value="pad">等比放大并补边</option>
                <option value="stretch">直接拉伸铺满</option>
              </select>
            </label>

            <label className="field">
              <span>备注位置</span>
              <select disabled={mergeMode !== 'compatible'} value={mergeOverlayStyle.position} onChange={(event) => setMergeOverlayStyle((current) => ({ ...current, position: event.target.value as MergeOverlayStyle['position'] }))}>
                <option value="top-left">左上角</option>
                <option value="top-right">右上角</option>
                <option value="bottom-left">左下角</option>
                <option value="bottom-right">右下角</option>
              </select>
            </label>

            <label className="field">
              <span>备注字号</span>
                  <input disabled={mergeMode !== 'compatible'} min={16} max={96} onChange={(event) => handleOverlayNumberChange('fontSize', Number(event.target.value) || 36, 16, 96, '备注字号已自动限制到 16 - 96。')} type="number" value={mergeOverlayStyle.fontSize} />
            </label>

            <label className="field">
              <span>文字颜色</span>
              <input disabled={mergeMode !== 'compatible'} onChange={(event) => setMergeOverlayStyle((current) => ({ ...current, fontColor: event.target.value }))} type="color" value={mergeOverlayStyle.fontColor} />
            </label>

            <label className="field">
              <span>文字透明度</span>
                  <input disabled={mergeMode !== 'compatible'} max={100} min={0} onChange={(event) => handleOverlayNumberChange('fontOpacity', Number(event.target.value) || 0, 0, 100, '文字透明度已自动限制到 0 - 100。')} type="number" value={mergeOverlayStyle.fontOpacity} />
            </label>

            <label className="field">
              <span>背景颜色</span>
              <input disabled={mergeMode !== 'compatible'} onChange={(event) => setMergeOverlayStyle((current) => ({ ...current, backgroundColor: event.target.value }))} type="color" value={mergeOverlayStyle.backgroundColor} />
            </label>

            <label className="field">
              <span>背景透明度</span>
                  <input disabled={mergeMode !== 'compatible'} max={100} min={0} onChange={(event) => handleOverlayNumberChange('backgroundOpacity', Number(event.target.value) || 0, 0, 100, '背景透明度已自动限制到 0 - 100。')} type="number" value={mergeOverlayStyle.backgroundOpacity} />
            </label>

            <label className="field">
              <span>背景留白</span>
                  <input disabled={mergeMode !== 'compatible'} max={64} min={0} onChange={(event) => handleOverlayNumberChange('boxPadding', Number(event.target.value) || 0, 0, 64, '背景留白已自动限制到 0 - 64。')} type="number" value={mergeOverlayStyle.boxPadding} />
            </label>

            <label className="field">
              <span>左边距</span>
                  <input disabled={mergeMode !== 'compatible'} max={200} min={0} onChange={(event) => handleOverlayNumberChange('offsetX', Number(event.target.value) || 0, 0, 200, '左边距已自动限制到 0 - 200。')} type="number" value={mergeOverlayStyle.offsetX} />
            </label>

            <label className="field">
              <span>上边距</span>
                  <input disabled={mergeMode !== 'compatible'} max={200} min={0} onChange={(event) => handleOverlayNumberChange('offsetY', Number(event.target.value) || 0, 0, 200, '上边距已自动限制到 0 - 200。')} type="number" value={mergeOverlayStyle.offsetY} />
            </label>
          </div>

          {overlayWarning ? (
            <div aria-live="polite" className="home-overlay-toast warning-copy" role="status">
              {overlayWarning}
            </div>
          ) : null}

          <p className="muted">成片会固定在每个镜头底部中间显示对应视频文件名，且字号会比备注更小；若备注也放在底部区域，系统会自动上移备注避免重叠。</p>

          <OutputDirectoryPicker outputDir={outputDir} onOutputDirChange={setOutputDir} />

          <div className="merge-list home-merge-list home-merge-list--cards">
            {selectedClips.length > 0 ? selectedClips.map((clip, index) => (
              <div
                className={dragOverLensId === clip.lensId ? 'merge-item merge-item--drag-over home-merge-card' : draggingLensId === clip.lensId ? 'merge-item merge-item--dragging home-merge-card' : 'merge-item home-merge-card'}
                draggable
                key={`${clip.lensId}-${clip.versionNum}`}
                onDragEnd={handleClipDragEnd}
                onDragOver={(event) => handleClipDragOver(event, clip.lensId)}
                onDragStart={() => handleClipDragStart(clip.lensId)}
                onDrop={() => handleClipDrop(clip.lensId)}
              >
                <div className="home-merge-card__meta">
                  <span className="environment-pill info">#{index + 1}</span>
                  <strong>{clip.lensCode}</strong>
                  <p className="muted">{clip.lensName || clip.lensCode}</p>
                  <small className="muted">场次 {clip.sceneNo || 0} · {clip.maker || '未填写制作人员'} · {clip.versionNum}</small>
                  <span className={clip.sourceKind === 'current-mov' ? 'environment-pill ready home-source-pill' : 'environment-pill warning home-source-pill'}>{clip.sourceKind === 'history-mov' ? '历史素材' : clip.sourceKind === 'layout-video' ? 'Layout素材' : '当前素材'}</span>
                  <small className={clip.sourceKind === 'current-mov' ? 'success-copy' : 'warning-copy'}>{clip.sourceLabel}</small>
                  {clip.width && clip.height ? <small className="muted">源分辨率 {clip.width}×{clip.height}</small> : null}
                  <label className="field home-merge-source-field">
                    <span>镜头备注</span>
                    <textarea onChange={(event) => handleClipNoteChange(clip.lensId, event.target.value)} placeholder="可选；成片播放到该镜头时会显示在左上角" rows={2} value={clip.note ?? ''} />
                  </label>
                  <small className="muted">底部中间文件名：{getClipFileName(clip.movPath)}</small>
                  {mergeMode === 'compatible' && mergeResolutionSummary.targetWidth && mergeResolutionSummary.targetHeight && clip.width && clip.height && (clip.width < mergeResolutionSummary.targetWidth || clip.height < mergeResolutionSummary.targetHeight) ? <small className="warning-copy">{mergeUpscaleMode === 'stretch' ? `将拉伸铺满到 ${mergeResolutionSummary.targetWidth}×${mergeResolutionSummary.targetHeight} 后拼接` : `将放大并补边到 ${mergeResolutionSummary.targetWidth}×${mergeResolutionSummary.targetHeight} 后拼接`}</small> : null}
                  {sourceAvailabilityMap[clip.lensId]?.options.length ? (
                    <label className="field shot-pool-source-field home-merge-source-field">
                      <span>切换拼接源</span>
                      <select value={selectedSourceKeyByLensId[clip.lensId] ?? sourceAvailabilityMap[clip.lensId]?.options[0]?.key ?? ''} onChange={(event) => handleSourceChange(clip.lensId, event.target.value)}>
                        {sourceAvailabilityMap[clip.lensId]?.options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <small className="muted file-name">{clip.movPath}</small>
                  <small className="muted">可直接拖拽调整顺序</small>
                </div>
                <div className="actions-row compact-actions wrap-actions home-merge-item-actions">
                  <button className="secondary-button" disabled={index === 0} onClick={() => moveSelectedClip(index, -1)} type="button">上移</button>
                  <button className="secondary-button" disabled={index === selectedClips.length - 1} onClick={() => moveSelectedClip(index, 1)} type="button">下移</button>
                  <button className="secondary-button" onClick={() => removeSelectedClip(index)} type="button">移除</button>
                </div>
              </div>
             )) : <p className="muted">从上方镜头池加入已完成镜头后，这里会生成拼接顺序卡牌。</p>}
          </div>

          <div className="actions-row wrap-actions home-submit-row">
            <button className="primary-button" disabled={Boolean(validationMessage) || isCreatingTask} onClick={() => void handleCreateTasks()} type="button">{isCreatingTask ? '正在加入任务…' : '开始拼接'}</button>
            <span className={createResult.success ? 'success-copy' : 'danger-copy'}>
              {createResult.success ? (isCreatingTask ? '正在提交拼接任务…' : createResult.taskIds.length > 0 ? `已加入 ${createResult.taskIds.length} 个拼接任务。` : '准备就绪。') : createResult.error ?? validationMessage ?? '准备就绪。'}
            </span>
          </div>
        </section>
      </div>

      <TaskList onCancelTask={handleCancelTask} onClearCompleted={handleClearCompleted} onRemoveTask={handleRemoveTask} onRetryTask={handleRetryTask} tasks={tasks} />
    </section>
  );
}

  function getClipFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments[segments.length - 1] || filePath;
}


function createDefaultWorkbenchDraft(workspaceKey: string, fallbackOutputDir = ''): WorkbenchDraft {
  return {
    workspaceKey,
    selectedSourceKeyByLensId: {},
    selectedClips: [],
    outputDir: fallbackOutputDir,
    outputName: DEFAULT_OUTPUT_NAME,
    mergeMode: 'compatible',
    mergeUpscaleMode: 'pad',
    mergeOverlayStyle: DEFAULT_MERGE_OVERLAY_STYLE,
    searchKeyword: '',
    makerFilter: 'all',
    checkedLensIds: [],
    hideAddedLenses: false,
  };
}

function readWorkbenchDraft(): WorkbenchDraft | null {
  try {
    const raw = window.localStorage.getItem(WORKBENCH_DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<WorkbenchDraft> | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      workspaceKey: typeof parsed.workspaceKey === 'string' ? parsed.workspaceKey : '',
      selectedSourceKeyByLensId: isStringRecord(parsed.selectedSourceKeyByLensId) ? parsed.selectedSourceKeyByLensId : {},
      selectedClips: Array.isArray(parsed.selectedClips) ? parsed.selectedClips as SelectedLensClip[] : [],
      outputDir: typeof parsed.outputDir === 'string' ? parsed.outputDir : '',
      outputName: typeof parsed.outputName === 'string' && parsed.outputName.trim() ? parsed.outputName : DEFAULT_OUTPUT_NAME,
      mergeMode: parsed.mergeMode === 'fast' ? 'fast' : 'compatible',
      mergeUpscaleMode: parsed.mergeUpscaleMode === 'stretch' ? 'stretch' : 'pad',
      mergeOverlayStyle: normalizeMergeOverlayStyle(parsed.mergeOverlayStyle),
      searchKeyword: typeof parsed.searchKeyword === 'string' ? parsed.searchKeyword : '',
      makerFilter: typeof parsed.makerFilter === 'string' ? parsed.makerFilter : 'all',
      checkedLensIds: Array.isArray(parsed.checkedLensIds) ? parsed.checkedLensIds.filter((value): value is string => typeof value === 'string') : [],
      hideAddedLenses: Boolean(parsed.hideAddedLenses),
    };
  } catch {
    return null;
  }
}

function persistWorkbenchDraft(draft: WorkbenchDraft): void {
  window.localStorage.setItem(WORKBENCH_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).every((item) => typeof item === 'string');
}

function normalizeMergeOverlayStyle(value: unknown): MergeOverlayStyle {
  if (!value || typeof value !== 'object') {
    return DEFAULT_MERGE_OVERLAY_STYLE;
  }

  const candidate = value as Partial<MergeOverlayStyle>;
  return {
    position: candidate.position === 'top-right' || candidate.position === 'bottom-left' || candidate.position === 'bottom-right' ? candidate.position : 'top-left',
    fontSize: clampInteger(typeof candidate.fontSize === 'number' ? candidate.fontSize : DEFAULT_MERGE_OVERLAY_STYLE.fontSize, 16, 96),
    fontColor: typeof candidate.fontColor === 'string' ? candidate.fontColor : DEFAULT_MERGE_OVERLAY_STYLE.fontColor,
    fontOpacity: clampInteger(typeof candidate.fontOpacity === 'number' ? candidate.fontOpacity : DEFAULT_MERGE_OVERLAY_STYLE.fontOpacity, 0, 100),
    backgroundColor: typeof candidate.backgroundColor === 'string' ? candidate.backgroundColor : DEFAULT_MERGE_OVERLAY_STYLE.backgroundColor,
    backgroundOpacity: clampInteger(typeof candidate.backgroundOpacity === 'number' ? candidate.backgroundOpacity : DEFAULT_MERGE_OVERLAY_STYLE.backgroundOpacity, 0, 100),
    boxPadding: clampInteger(typeof candidate.boxPadding === 'number' ? candidate.boxPadding : DEFAULT_MERGE_OVERLAY_STYLE.boxPadding, 0, 64),
    offsetX: clampInteger(typeof candidate.offsetX === 'number' ? candidate.offsetX : DEFAULT_MERGE_OVERLAY_STYLE.offsetX, 0, 200),
    offsetY: clampInteger(typeof candidate.offsetY === 'number' ? candidate.offsetY : DEFAULT_MERGE_OVERLAY_STYLE.offsetY, 0, 200),
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  const normalized = Math.trunc(value);
  return Math.min(max, Math.max(min, normalized));
}

function buildLensSourceAvailability(lens: LensRecord, detail?: { versions: Array<{ versionNum: string; bindings: LensVersionBinding[] }> }): LensSourceAvailability {
  const options: LensSourceOption[] = [];

  const orderedVersions = [...(detail?.versions ?? [])].sort((left, right) => compareVersionDesc(left.versionNum, right.versionNum));
  for (const version of orderedVersions) {
    const movBinding = version.bindings.find((binding) => binding.fileType === 'mov' && binding.exists && binding.absolutePath);
    if (!movBinding) {
      continue;
    }

    options.push({
      key: `${lens.lensId}:${version.versionNum}`,
      kind: version.versionNum === lens.versionNum ? 'current-mov' : 'history-mov',
      label: version.versionNum === lens.versionNum ? `当前版本 ${version.versionNum}` : `历史版本 ${version.versionNum}`,
      path: movBinding.absolutePath,
      versionNum: version.versionNum,
      width: movBinding.mediaWidth,
      height: movBinding.mediaHeight,
    });
  }

  if (lens.layoutVideoReady && lens.layoutVideoAbsolutePath) {
    options.push({
      key: `${lens.lensId}:layout:${lens.layoutVideoVersionNum || lens.layoutVideoFileName}`,
      kind: 'layout-video',
      label: lens.layoutVideoVersionNum ? `Layout 版本 ${lens.layoutVideoVersionNum}` : 'Layout 视频',
      path: lens.layoutVideoAbsolutePath,
      versionNum: lens.layoutVideoVersionNum || 'LAY',
      width: lens.layoutVideoWidth,
      height: lens.layoutVideoHeight,
    });
  }

  const currentOption = options.find((option) => option.kind === 'current-mov');
  const fallbackOption = options.find((option) => option.kind === 'history-mov');
  const layoutOption = options.find((option) => option.kind === 'layout-video');
  const hasLayoutCandidate = lens.layoutCandidateCount > 0;
  const note = currentOption
    ? `优先使用当前版本 ${currentOption.versionNum}`
    : fallbackOption
      ? `当前版本不可用，回退到 ${fallbackOption.versionNum}`
      : layoutOption
        ? `当前/历史版本不可用，回退到 ${layoutOption.label}`
        : hasLayoutCandidate
          ? '仅发现 layout 线索，暂无可直接拼接视频'
          : '暂无可直接拼接视频';

  return {
    hasLayoutCandidate,
    note,
    options: sortSourceOptions(options, lens.versionNum),
  };
}

function sortSourceOptions(options: LensSourceOption[], currentVersionNum: string): LensSourceOption[] {
  return [...options].sort((left, right) => {
    if (left.kind === 'layout-video' && right.kind !== 'layout-video') {
      return 1;
    }

    if (right.kind === 'layout-video' && left.kind !== 'layout-video') {
      return -1;
    }

    if (left.versionNum === currentVersionNum && right.versionNum !== currentVersionNum) {
      return -1;
    }

    if (right.versionNum === currentVersionNum && left.versionNum !== currentVersionNum) {
      return 1;
    }

    return compareVersionDesc(left.versionNum, right.versionNum);
  });
}

function compareVersionDesc(left: string, right: string): number {
  return parseVersionNumber(right) - parseVersionNumber(left);
}

function parseVersionNumber(value: string): number {
  const matched = value.match(/(\d+)/);
  return matched ? Number(matched[1]) : 0;
}

function getWorkbenchEnvironmentSummary(status: EnvironmentStatus | null): string {
  if (!status) {
    return '需要时可展开环境检查，确认 FFmpeg、FFprobe 与默认输出目录是否可用。';
  }

  const pieces = [
    `FFmpeg：${status.ffmpeg.available ? '就绪' : '待处理'}`,
    `FFprobe：${status.ffprobe.available ? '就绪' : '待处理'}`,
    `输出目录：${status.hasDefaultOutputDir ? (status.defaultOutputDirWritable ? '可写' : '不可写') : '未配置'}`,
  ];
  return `${pieces.join(' · ')}。需要时可展开检查详情。`;
}
