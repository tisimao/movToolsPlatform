import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../auth/store';
import { getPrimaryRole } from '../auth/permissions';
import { apiClient } from '../api/client';
import { lensService, reviewService } from '../services/repositoryService';
import { useLensStore } from '../stores/lensStore';
import { useProjectStore } from '../stores/projectStore';
import { getInternalReviewStatusLabel, type InternalReviewStatusCode } from '../lib/internalReview';
import { useDirectorNavigationStore } from '../stores/directorNavigationStore';
import { clearReviewLocalShotStateForTask } from '../lib/reviewLocalState';
import { getParticipationModeLabel, resolveReviewParticipationMode } from '../lib/reviewParticipationMode';
import type { ReviewTaskSummary, ReviewTaskDetail, ReviewTaskShot, ReviewParticipationMode } from '../types/review';
import type { LensRecord } from '../types/lens';

// 制片审片任务页面属性
interface ProducerTaskPageProps {
  onOpenReviewTask: (taskId: string) => void;  // 打开审片任务回调
  initialTaskId?: string | null;  // 初始选中的任务ID
}

// API用户条目
interface ApiUserItem {
  userId: string;
  userName: string;
  displayName: string;
  roles: string[];
  isActive: boolean;
}

// 任务列表筛选标签
type TaskTabFilter = 'all' | 'draft' | 'pending' | 'in-review' | 'completed' | 'closed';
// 镜头池筛选条件
type ShotPoolFilter = 'all' | 'ready-for-review' | 'fix-updated' | 'no-media';

// 制片端任务状态中文标签映射
const PRODUCER_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  'pending-submit': '待提交',
  pending: '待审',
  'in-review': '审阅中',
  completed: '已完成',
  closed: '已关闭',
};

// 获取制片端状态（优先使用producerStatus）
function getProducerStatus(task: ReviewTaskSummary): string {
  return task.producerStatus ?? task.status;
}

// 获取制片端状态中文标签
function getProducerStatusLabel(task: ReviewTaskSummary): string {
  return PRODUCER_STATUS_LABELS[getProducerStatus(task)] ?? task.status;
}

// 格式化日期时间为中文格式
function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN');
}

// 获取镜头的参与模式（上下文陪审/正常审片）
function getTaskShotParticipationMode(shot: { participationMode?: ReviewParticipationMode | null; reviewParticipationMode?: ReviewParticipationMode | null }): ReviewParticipationMode | null {
  return resolveReviewParticipationMode(shot);
}

export function ProducerTaskPage({ onOpenReviewTask, initialTaskId }: ProducerTaskPageProps) {
  const { user } = useAuthStore();
  const currentRole = getPrimaryRole(user);
  const { lenses, activeEpisodeId, activeEpisodeCode } = useLensStore();
  const { projects, activeProjectId } = useProjectStore();
  const { clearPendingReviewTaskId } = useDirectorNavigationStore();
  // 当前活跃项目名称
  const activeProjectName = useMemo(() => projects.find((p) => p.projectId === activeProjectId)?.projectName ?? null, [projects, activeProjectId]);
  const isProducer = currentRole === 'producer';
  // 镜头ID到镜头记录的映射
  const lensById = useMemo(() => new Map(lenses.map((lens) => [lens.lensId, lens] as const)), [lenses]);

  // 任务列表状态
  const [tasks, setTasks] = useState<ReviewTaskSummary[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ReviewTaskSummary | null>(null);
  const [taskDetail, setTaskDetail] = useState<ReviewTaskDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [result, setResult] = useState<{ success: boolean; error?: string }>({ success: true });
  // 任务列表筛选标签
  const [taskTabFilter, setTaskTabFilter] = useState<TaskTabFilter>('all');
  // 表单显隐控制
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  // 镜头池筛选条件
  const [shotPoolFilter, setShotPoolFilter] = useState<ShotPoolFilter>('all');

  // 创建/编辑表单状态
  const [formTaskName, setFormTaskName] = useState('');  // 任务名称
  const [formDirectorId, setFormDirectorId] = useState('');  // 目标导演ID
  const [formDescription, setFormDescription] = useState('');  // 提审说明
  const [formSelectedShotIds, setFormSelectedShotIds] = useState<string[]>([]);  // 选中的镜头ID列表
  const [formShotModes, setFormShotModes] = useState<Record<string, ReviewParticipationMode>>({});  // 镜头参与模式映射
  const [directorUsers, setDirectorUsers] = useState<Array<{ userId: string; displayName: string; userName: string }>>([]);  // 可选导演列表
  const [isSaving, setIsSaving] = useState(false);  // 保存中
  const [isSubmitting, setIsSubmitting] = useState(false);  // 提交中

  // 镜头池选中状态
  const [poolSelectedLensIds, setPoolSelectedLensIds] = useState<string[]>([]);

  // 编辑表单状态（已有任务）
  const [editTaskShotIds, setEditTaskShotIds] = useState<string[]>([]);
  const [editTaskDetail, setEditTaskDetail] = useState<ReviewTaskDetail | null>(null);
  const [editTaskShotModes, setEditTaskShotModes] = useState<Record<string, ReviewParticipationMode>>({});

  // 已归档（已关闭）的任务
  const archivedTasks = useMemo(() => tasks.filter((task) => getProducerStatus(task) === 'closed'), [tasks]);
  // 活跃（未关闭）的任务
  const activeTasks = useMemo(() => tasks.filter((task) => getProducerStatus(task) !== 'closed'), [tasks]);
  // 根据标签筛选后的任务列表
  const filteredTasks = useMemo(() => {
    if (taskTabFilter === 'all') return activeTasks;
    if (taskTabFilter === 'completed') return activeTasks.filter((task) => task.status === 'completed');
    return activeTasks.filter((task) => getProducerStatus(task) === taskTabFilter || task.status === taskTabFilter);
  }, [activeTasks, taskTabFilter]);

  // 任务统计摘要
  const taskSummary = useMemo(() => ({
    total: activeTasks.length,
    draft: activeTasks.filter((t) => getProducerStatus(t) === 'draft').length,
    pending: activeTasks.filter((t) => t.status === 'pending').length,
    inReview: activeTasks.filter((t) => t.status === 'in-review').length,
    completed: activeTasks.filter((t) => t.status === 'completed').length,
    closed: archivedTasks.length,
  }), [activeTasks, archivedTasks]);

  // 待提审镜头池（根据筛选条件过滤）
  const shotPool = useMemo(() => {
    const taskShotIds = new Set<string>();
    for (const t of tasks) {
      if (t.shotCount > 0 && (getProducerStatus(t) === 'draft')) {
        // 摘要信息中不含镜头ID，无法精确过滤
      }
    }
    return lenses.filter((lens) => {
      if (shotPoolFilter === 'all') return true;
      if (shotPoolFilter === 'ready-for-review') return lens.internalReviewStatusCode === 'READY_FOR_REVIEW';
      if (shotPoolFilter === 'fix-updated') return lens.internalReviewStatusCode === 'FIX_UPDATED';
      if (shotPoolFilter === 'no-media') return !lens.currentVersionReady;
      return true;
    });
  }, [lenses, shotPoolFilter]);

  function filterShotPoolByStatus(lens: LensRecord): boolean {
    if (shotPoolFilter === 'all') return true;
    if (shotPoolFilter === 'ready-for-review') return lens.internalReviewStatusCode === 'READY_FOR_REVIEW';
    if (shotPoolFilter === 'fix-updated') return lens.internalReviewStatusCode === 'FIX_UPDATED';
    if (shotPoolFilter === 'no-media') return !lens.currentVersionReady;
    return true;
  }

  const filteredShotPool = useMemo(
    () => shotPool.filter(filterShotPoolByStatus),
    [shotPool, shotPoolFilter],
  );

  // 获取导演选项的显示文本
  function getDirectorOptionLabel(director: { displayName: string; userName: string }): string {
    return director.displayName.trim() ? `${director.displayName} (${director.userName})` : director.userName;
  }

  // 获取镜头参与模式的中文标签
  function getShotModeLabel(mode?: ReviewParticipationMode): string {
    return getParticipationModeLabel(mode);
  }

  // 获取镜头的默认参与模式（有可用素材为正常审片，仅有Layout为上下文陪审）
  function getDefaultParticipationMode(lensId: string): ReviewParticipationMode {
    const lens = lensById.get(lensId);
    if (!lens) {
      return 'review';
    }

    if (lens.currentVersionReady) {
      return 'review';
    }

    if (lens.layoutVideoReady) {
      return 'context';
    }

    return 'review';
  }

  // 加载制片端任务列表
  async function loadTasks(): Promise<void> {
    if (!activeProjectId) return;
    setLoadingTasks(true);
    try {
      const response = await reviewService.listProducerTasks({ projectId: activeProjectId });
      if (response.success) {
        setTasks(response.tasks);
      } else {
        setResult({ success: false, error: response.error });
      }
    } finally {
      setLoadingTasks(false);
    }
  }

  // 加载任务详情
  async function loadTaskDetail(task: ReviewTaskSummary): Promise<void> {
    setSelectedTask(task);
    setLoadingDetail(true);
    try {
      const response = await reviewService.getTaskDetail(task.taskId);
      if (response.success && response.detail) {
        setTaskDetail(response.detail);
      } else {
        setResult({ success: false, error: response.error ?? '读取任务详情失败。' });
      }
    } finally {
      setLoadingDetail(false);
    }
  }

  // 创建草稿任务
  async function handleCreateTask(): Promise<void> {
    if (!activeProjectId) {
      setResult({ success: false, error: '请先选择项目。' });
      return;
    }
    setIsSaving(true);
    try {
      const response = await reviewService.createDraftTask({
        projectId: activeProjectId,
        episodeId: activeEpisodeId,
        taskName: formTaskName.trim() || null,
        directorId: formDirectorId.trim() || null,
        description: formDescription.trim() || null,
        shotIds: formSelectedShotIds,
        shots: formSelectedShotIds.map((lensId, index) => ({
          lensId,
          sequence: index,
          participationMode: formShotModes[lensId] ?? getDefaultParticipationMode(lensId),
        })),
      });
      if (response.success) {
        resetCreateForm();
        setShowCreateForm(false);
        setResult({ success: true });
        await loadTasks();
      } else {
        setResult({ success: false, error: response.error });
      }
    } finally {
      setIsSaving(false);
    }
  }

  // 保存编辑后的任务信息
  async function handleSaveEditTask(): Promise<void> {
    if (!selectedTask) return;
    setIsSaving(true);
    try {
      const nextShots = editTaskDetail?.shots.map((shot, index) => ({
        lensId: shot.shotId,
        sequence: index,
        participationMode: editTaskShotModes[shot.shotId] ?? getTaskShotParticipationMode(shot) ?? getDefaultParticipationMode(shot.shotId),
        submitVersionNum: shot.submitVersionNum ?? null,
      }));
      const response = await reviewService.updateTask(selectedTask.taskId, {
        taskName: formTaskName.trim() || null,
        directorId: formDirectorId.trim() || null,
        description: formDescription.trim() || null,
        shots: nextShots,
      });
      if (response.success) {
        setShowEditForm(false);
        setResult({ success: true });
        await loadTasks();
        if (selectedTask) await loadTaskDetail(selectedTask);
      } else {
        setResult({ success: false, error: response.error });
      }
    } finally {
      setIsSaving(false);
    }
  }

  // 向任务添加镜头
  async function handleAddShotsToTask(taskId: string, shotIds: string[]): Promise<void> {
    if (shotIds.length === 0) return;
    try {
      const response = await reviewService.addTaskShots({
        taskId,
        shotIds,
        shots: shotIds.map((lensId, index) => ({
          lensId,
          sequence: index,
          participationMode: editTaskShotModes[lensId] ?? getDefaultParticipationMode(lensId),
        })),
      });
      if (response.success) {
        setResult({ success: true });
        setPoolSelectedLensIds([]);
        await loadTasks();
        const task = tasks.find((t) => t.taskId === taskId);
        if (task) await loadTaskDetail(task);
      } else {
        setResult({ success: false, error: response.error });
      }
    } catch (error) {
      setResult({ success: false, error: error instanceof Error ? error.message : '添加镜头失败。' });
    }
  }

  // 从任务中移除镜头
  async function handleRemoveShot(taskId: string, taskShotId: string): Promise<void> {
    const confirmed = window.confirm('确认从该任务移除此镜头？');
    if (!confirmed) return;
    try {
      const response = await reviewService.removeTaskShot({ taskId, taskShotId });
      if (response.success) {
        setResult({ success: true });
        await loadTasks();
        const task = tasks.find((t) => t.taskId === taskId);
        if (task) await loadTaskDetail(task);
      } else {
        setResult({ success: false, error: response.error });
      }
    } catch (error) {
      setResult({ success: false, error: error instanceof Error ? error.message : '移除镜头失败。' });
    }
  }

  // 提交任务给导演进行审片
  async function handleSubmitTask(taskId: string): Promise<void> {
    const confirmed = window.confirm('确认提交该审片任务给导演？提交后，任务内处于"待提审"或"已按反馈修改"的镜头将进入"审片中"；已"内部通过"的镜头将继续保持通过态。');
    if (!confirmed) return;
    setIsSubmitting(true);
    try {
      const response = await reviewService.submitTask({ taskId });
      if (response.success) {
        setResult({ success: true });
        await loadTasks();
        setSelectedTask(null);
        setTaskDetail(null);
      } else {
        setResult({ success: false, error: response.error });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // 关闭审片任务
  async function handleCloseTask(taskId: string): Promise<void> {
    const confirmed = window.confirm('确认关闭该审片任务？');
    if (!confirmed) return;
    try {
      const response = await reviewService.closeTask(taskId);
      if (response.success) {
        clearReviewLocalShotStateForTask(taskId);
        setResult({ success: true });
        await loadTasks();
        setSelectedTask(null);
        setTaskDetail(null);
      } else {
        setResult({ success: false, error: response.error });
      }
    } catch (error) {
      setResult({ success: false, error: error instanceof Error ? error.message : '关闭任务失败。' });
    }
  }

  // 重置创建表单
  function resetCreateForm(): void {
    setFormTaskName('');
    setFormDirectorId('');
    setFormDescription('');
    setFormSelectedShotIds([]);
    setFormShotModes({});
  }

  // 打开创建任务表单
  function openCreateForm(): void {
    resetCreateForm();
    setShowCreateForm(true);
    setShowEditForm(false);
    setSelectedTask(null);
    setTaskDetail(null);
  }

  // 打开编辑任务表单（填充已有数据）
  function openEditForm(task: ReviewTaskSummary, detail: ReviewTaskDetail | null): void {
    setSelectedTask(task);
    setFormTaskName(task.taskName ?? '');
    setFormDirectorId(task.directorId ?? '');
    setFormDescription(task.description ?? '');
    setShowEditForm(true);
    setShowCreateForm(false);
    if (detail) {
      setEditTaskDetail(detail);
      setEditTaskShotIds(detail.shots.map((s) => s.shotId));
      setEditTaskShotModes(Object.fromEntries(detail.shots.map((s) => [s.shotId, getTaskShotParticipationMode(s) ?? 'review'])));
    }
  }

  // 切换镜头池中镜头的选中状态
  function togglePoolLensSelection(lensId: string): void {
    setPoolSelectedLensIds((current) =>
      current.includes(lensId) ? current.filter((id) => id !== lensId) : [...current, lensId],
    );
  }

  // 切换创建表单中镜头的选中状态
  function toggleFormShotSelection(lensId: string): void {
    setFormSelectedShotIds((current) =>
      current.includes(lensId) ? current.filter((id) => id !== lensId) : [...current, lensId],
    );
    setFormShotModes((current) => ({ ...current, [lensId]: current[lensId] ?? getDefaultParticipationMode(lensId) }));
  }

  // 切换创建表单中镜头的参与模式（上下文陪审 <-> 正常审片）
  function toggleFormShotMode(lensId: string): void {
    setFormShotModes((current) => ({
      ...current,
      [lensId]: current[lensId] === 'context' ? 'review' : 'context',
    }));
  }

  // 切换编辑表单中镜头的参与模式
  function toggleEditShotMode(lensId: string): void {
    setEditTaskShotModes((current) => ({
      ...current,
      [lensId]: current[lensId] === 'context' ? 'review' : 'context',
    }));
  }

  // 更新创建表单中镜头的参与模式
  function updateFormShotMode(lensId: string, mode: ReviewParticipationMode): void {
    setFormShotModes((current) => ({ ...current, [lensId]: mode }));
  }

  // 更新编辑表单中镜头的参与模式
  function updateEditShotMode(lensId: string, mode: ReviewParticipationMode): void {
    setEditTaskShotModes((current) => ({ ...current, [lensId]: mode }));
  }

  // 选择任务并加载详情
  const handleSelectTask = (task: ReviewTaskSummary) => {
    setSelectedTask(task);
    setShowCreateForm(false);
    setShowEditForm(false);
    void loadTaskDetail(task);
  };

  // 切换项目时重新加载任务列表
  useEffect(() => {
    void (async () => {
      await loadTasks();
      if (initialTaskId && tasks.length === 0) {
        // 任务加载完成后，延时重试自动选中初始任务
        setTimeout(() => {
          const found = tasks.find((t) => t.taskId === initialTaskId);
          if (found) handleSelectTask(found);
        }, 100);
      }
    })();
  }, [activeProjectId]);

  // 任务列表加载完成后自动选中初始任务
  useEffect(() => {
    if (initialTaskId && tasks.length > 0) {
      const found = tasks.find((t) => t.taskId === initialTaskId);
      if (found) {
        handleSelectTask(found);
      }
      clearPendingReviewTaskId();
    }
  }, [tasks, initialTaskId]);

  // 加载可选导演用户列表（角色包含director的用户）
  useEffect(() => {
    if (!activeProjectId) {
      setDirectorUsers([]);
      return;
    }

    void (async () => {
      try {
        const response = await apiClient.request<ApiUserItem[]>('/api/users', { method: 'GET' });
        setDirectorUsers(
          response
            .filter((user) => user.roles.some((role) => role.toLowerCase() === 'director'))
            .map((user) => ({ userId: user.userId, displayName: user.displayName, userName: user.userName })),
        );
      } catch {
        setDirectorUsers([]);
      }
    })();
  }, [activeProjectId]);

  // 非制片角色显示无权限提示
  if (!isProducer) {
    return (
      <section className="page-layout">
        <header className="page-header">
          <h2>制片审片任务管理</h2>
          <p className="muted">仅制片账号可访问。</p>
        </header>
      </section>
    );
  }

  return (
    // ===== 页面顶级容器：三栏布局（左侧任务列表 / 右侧详情面板 / 底部镜头池） =====
    <section className="page-layout stack-gap producer-task-page">
      {/* 页面标题栏：显示当前角色上下文（项目 + 集） */}
      <header className="page-header">
        <div>
          <p className="eyebrow">审片任务</p>
          <h2>制片任务装配台</h2>
          <p className="muted">创建审片任务、编辑草稿、提交给导演并跟踪任务进度。</p>
        </div>
        <div className="page-header-actions">
          <p className="muted">当前项目：{activeProjectName || '未选择'} · 集：{activeEpisodeCode || '未选择'}</p>
        </div>
      </header>

      {/* 操作结果提示条：错误信息展示（绿色成功 / 红色失败） */}
      {result.error ? (
        <div className="workbench-result-card">
          <span className="danger-copy">{result.error}</span>
          <button className="ghost-button" onClick={() => setResult({ success: true })} type="button">关闭</button>
        </div>
      ) : null}

      {/*
        ===== 左右双栏主布局 =====
        左栏：任务列表（筛选标签 + 任务卡片 + 已关闭折叠区）
        右栏：根据当前视图展示【创建表单】/【编辑表单】/【任务详情】/【空状态引导】
      */}
      <div className="producer-task-layout">
        {/* ===== 左侧面板：任务列表 ===== */}
        <section className="panel stack-gap producer-task-list-panel">
          {/* 列表头部：标题 + 新建按钮 */}
          <div className="section-heading">
            <div>
              <h3>审片任务列表</h3>
              <p className="muted">主工作区仅显示未关闭任务，归档任务默认折叠。</p>
            </div>
            <button className="primary-button" onClick={openCreateForm} type="button">新建任务</button>
          </div>

          {/* 状态筛选标签栏：全部 / 草稿 / 待审 / 审阅中 / 已完成 */}
          <div className="filter-bar review-filter-bar">
            <button className={taskTabFilter === 'all' ? 'tab-button active' : 'tab-button'} onClick={() => setTaskTabFilter('all')} type="button">全部 ({taskSummary.total})</button>
            <button className={taskTabFilter === 'draft' ? 'tab-button active' : 'tab-button'} onClick={() => setTaskTabFilter('draft')} type="button">草稿 ({taskSummary.draft})</button>
            <button className={taskTabFilter === 'pending' ? 'tab-button active' : 'tab-button'} onClick={() => setTaskTabFilter('pending')} type="button">待审 ({taskSummary.pending})</button>
            <button className={taskTabFilter === 'in-review' ? 'tab-button active' : 'tab-button'} onClick={() => setTaskTabFilter('in-review')} type="button">审阅中 ({taskSummary.inReview})</button>
            <button className={taskTabFilter === 'completed' ? 'tab-button active' : 'tab-button'} onClick={() => setTaskTabFilter('completed')} type="button">已完成 ({taskSummary.completed})</button>
          </div>

          {/* 加载中 / 空状态 / 任务卡片列表 */}
          {loadingTasks ? (
            <p className="muted">加载中...</p>
          ) : filteredTasks.length === 0 ? (
            <p className="muted">暂无任务，点击"新建任务"创建。</p>
          ) : (
            <div className="review-task-list review-task-list--strip">
              {filteredTasks.map((task) => (
                /* 单张任务卡片：点击后加载详情到右侧面板 */
                <article
                  key={task.taskId}
                  className={selectedTask?.taskId === task.taskId ? 'review-task-card active' : 'review-task-card'}
                  onClick={() => handleSelectTask(task)}
                >
                  {/* 卡片头部：任务名 + 项目/导演信息 + 状态标签 */}
                  <div className="section-heading">
                    <div>
                      <h4>{task.taskName || `任务 ${task.taskId.slice(0, 8)}`}</h4>
                      <p className="muted">{task.projectName || '—'} · {task.directorName || '未指定导演'}</p>
                    </div>
                    <span className={`status-pill status-${task.status}`}>
                      {getProducerStatusLabel(task)}
                    </span>
                  </div>
                  {/* 卡片元数据：镜头数/反馈数/通过数 + 提交人/时间 + 更新时间 */}
                  <div className="stack-gap compact-gap">
                    <small className="muted">镜头数：{task.shotCount} · 已反馈：{task.feedbackShotCount} · 通过：{task.approvedShotCount}</small>
                    <small className="muted">提交人：{task.submitterName || '—'} · 提交时间：{formatDateTime(task.submitTime)}</small>
                    <small className="muted">更新：{formatDateTime(task.updatedAtUtc)}</small>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* 已关闭任务折叠区：默认收起，展开后可查看和重新选中 */}
          <details className="lens-detail-collapsible producer-task-archive" open={false}>
            <summary className="lens-detail-collapsible-summary">已关闭审片任务（{taskSummary.closed}）</summary>
            {archivedTasks.length === 0 ? (
              <p className="muted" style={{ marginTop: '0.75rem' }}>暂无已关闭审片任务。</p>
            ) : (
              <div className="review-task-list review-task-list--strip" style={{ marginTop: '0.75rem' }}>
                {archivedTasks.map((task) => (
                  <article
                    key={task.taskId}
                    className={selectedTask?.taskId === task.taskId ? 'review-task-card active' : 'review-task-card'}
                    onClick={() => handleSelectTask(task)}
                  >
                    <div className="section-heading">
                      <div>
                        <h4>{task.taskName || `任务 ${task.taskId.slice(0, 8)}`}</h4>
                        <p className="muted">{task.projectName || '—'} · {task.directorName || '未指定导演'}</p>
                      </div>
                      <span className={`status-pill status-${task.status}`}>
                        {getProducerStatusLabel(task)}
                      </span>
                    </div>
                    <div className="stack-gap compact-gap">
                      <small className="muted">镜头数：{task.shotCount} · 已反馈：{task.feedbackShotCount} · 通过：{task.approvedShotCount}</small>
                      <small className="muted">提交人：{task.submitterName || '—'} · 提交时间：{formatDateTime(task.submitTime)}</small>
                      <small className="muted">更新：{formatDateTime(task.updatedAtUtc)}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </details>
        </section>

        {/* ===== 右侧面板：根据当前状态展示不同视图 ===== */}
        <section className="panel stack-gap producer-task-detail-panel">
          {/*
            视图1：创建任务表单
            — 填写任务名称/目标导演/提审说明
            — 从镜头池勾选要加入的镜头并设置参与模式
          */}
          {showCreateForm ? (
            <>
              {/* 表单头部：标题 + 取消按钮 */}
              <div className="section-heading">
                <div>
                  <h3>新建审片任务</h3>
                  <p className="muted">创建草稿后可继续添加镜头、调整顺序并提交。</p>
                </div>
                <button className="secondary-button" onClick={() => setShowCreateForm(false)} type="button">取消</button>
              </div>

              {/* 基本信息字段：任务名称 / 目标导演 / 提审说明 */}
              <div className="form-grid lens-form-grid">
                <label className="field">
                  <span>任务名称</span>
                  <input onChange={(e) => setFormTaskName(e.target.value)} placeholder="输入任务名称" value={formTaskName} />
                </label>
                <label className="field">
                  <span>目标导演</span>
                  <select onChange={(e) => setFormDirectorId(e.target.value)} value={formDirectorId}>
                    <option value="">不指定</option>
                    {directorUsers.map((director) => (
                      <option key={director.userId} value={director.userId}>{getDirectorOptionLabel(director)}</option>
                    ))}
                  </select>
                  {directorUsers.length === 0 ? <small className="muted">当前没有可选导演，请先检查用户角色。</small> : null}
                </label>
                <label className="field">
                  <span>提审说明</span>
                  <textarea onChange={(e) => setFormDescription(e.target.value)} placeholder="说明本轮审片的关注点..." rows={3} value={formDescription} />
                </label>
              </div>

              {/* 镜头选择区域：从镜头池中勾选待加入的镜头 */}
              <div className="section-heading">
                <h4>选择镜头加入任务</h4>
                <p className="muted">从下方镜头池勾选要加入的镜头。</p>
              </div>
              <div className="lens-bulk-actions lens-bulk-actions-grid" style={{ border: '1px solid var(--border)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', maxHeight: 300, overflowY: 'auto' }}>
                {shotPool.length === 0 ? (
                  <p className="muted">暂无可用镜头。</p>
                ) : (
                  shotPool.map((lens) => (
                    /* 每行：勾选框 + 镜头编码/版本/状态 + 参与模式切换按钮（仅选中后显示） */
                    <div className="checkbox-field" key={lens.lensId} style={{ padding: '4px 0', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                        <input
                          checked={formSelectedShotIds.includes(lens.lensId)}
                          onChange={() => toggleFormShotSelection(lens.lensId)}
                          type="checkbox"
                        />
                        <span>{lens.lensCode} · V{lens.versionNum} · {getInternalReviewStatusLabel(lens.internalReviewStatusCode, lens.internalReviewStatusName)}</span>
                      </label>
                      {formSelectedShotIds.includes(lens.lensId) ? (
                        <button className="ghost-button" onClick={() => toggleFormShotMode(lens.lensId)} type="button">
                          {getShotModeLabel(formShotModes[lens.lensId])}
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
              {/* 已选镜头计数 */}
              <small className="muted">已选 {formSelectedShotIds.length} 个镜头</small>

              {/* 操作按钮：创建草稿 / 取消 */}
              <div className="actions-row wrap-actions">
                <button className="primary-button" disabled={isSaving} onClick={() => void handleCreateTask()} type="button">
                  {isSaving ? '创建中...' : '创建草稿任务'}
                </button>
                <button className="secondary-button" onClick={() => setShowCreateForm(false)} type="button">取消</button>
              </div>
            </>
          ) : showEditForm && selectedTask ? (
            <>
              {/*
                视图2：编辑任务表单
                — 修改任务名称/目标导演/提审说明
                — 管理任务内镜头列表（调整参与模式 / 移除）
                — 从镜头池添加新镜头
              */}
              {/* 编辑头部：标题 + 完成编辑按钮 */}
              <div className="section-heading">
                <div>
                  <h3>编辑任务：{selectedTask.taskName || selectedTask.taskId.slice(0, 8)}</h3>
                  <p className="muted">修改任务信息或管理镜头列表。</p>
                </div>
                <button className="secondary-button" onClick={() => setShowEditForm(false)} type="button">完成编辑</button>
              </div>

              {/* 可编辑的基本信息字段 */}
              <div className="form-grid lens-form-grid">
                <label className="field">
                  <span>任务名称</span>
                  <input onChange={(e) => setFormTaskName(e.target.value)} value={formTaskName} />
                </label>
                <label className="field">
                  <span>目标导演</span>
                  <select onChange={(e) => setFormDirectorId(e.target.value)} value={formDirectorId}>
                    <option value="">不指定</option>
                    {directorUsers.map((director) => (
                      <option key={director.userId} value={director.userId}>{getDirectorOptionLabel(director)}</option>
                    ))}
                  </select>
                  {directorUsers.length === 0 ? <small className="muted">当前没有可选导演，请先检查用户角色。</small> : null}
                </label>
                <label className="field">
                  <span>提审说明</span>
                  <textarea onChange={(e) => setFormDescription(e.target.value)} rows={3} value={formDescription} />
                </label>
              </div>

              {/* 任务内镜头列表：序号 / 编码 / 版本 / 参与模式 / 反馈数 / 操作按钮 */}
              <div className="section-heading">
                <h4>任务镜头列表</h4>
                <p className="muted">任务内当前镜头顺序。</p>
              </div>
              {taskDetail?.shots.map((shot, index) => (
                <div key={shot.taskShotId} className="lens-bulk-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                  <strong>{index + 1}.</strong>
                  <span>{shot.lensCode}</span>
                  <small className="muted">V{shot.submitVersionNum || shot.actualVersionNum || '—'}</small>
                  <span className="status-pill">{getShotModeLabel(getTaskShotParticipationMode(shot) ?? 'review')}</span>
                  <span className={`status-pill status-${shot.status}`}>{shot.feedbackCount > 0 ? `${shot.feedbackCount} 反馈` : '无反馈'}</span>
                  {/* 切换参与类型（上下文陪审 <-> 正常审片），上下文陪审镜头不可切换 */}
                  <button className="ghost-button" disabled={getTaskShotParticipationMode(shot) === 'context'} title={getTaskShotParticipationMode(shot) === 'context' ? '上下文陪审镜头仅保留只读参与类型' : undefined} onClick={() => toggleEditShotMode(shot.shotId)} type="button">切换参与类型</button>
                  {/* 从任务中移除该镜头 */}
                  <button className="ghost-button danger-copy" onClick={() => void handleRemoveShot(selectedTask.taskId, shot.taskShotId)} type="button">移除</button>
                </div>
              )) || <p className="muted">暂无镜头</p>}

              {/* 从镜头池添加更多镜头（排除已在任务中的） */}
              <div className="section-heading" style={{ marginTop: '1rem' }}>
                <h4>从镜头池添加镜头</h4>
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.5rem' }}>
                {shotPool.filter((l) => !(taskDetail?.shots.some((s) => s.shotId === l.lensId))).map((lens) => (
                  <label className="checkbox-field" key={lens.lensId} style={{ padding: '4px 0' }}>
                    <input
                      checked={poolSelectedLensIds.includes(lens.lensId)}
                      onChange={() => togglePoolLensSelection(lens.lensId)}
                      type="checkbox"
                    />
                    <span>{lens.lensCode} · {getInternalReviewStatusLabel(lens.internalReviewStatusCode, lens.internalReviewStatusName)}</span>
                  </label>
                ))}
              </div>
              {/* 操作按钮：添加选中镜头 + 保存任务信息 */}
              <div className="actions-row wrap-actions">
                <button className="secondary-button" disabled={poolSelectedLensIds.length === 0} onClick={() => void handleAddShotsToTask(selectedTask.taskId, poolSelectedLensIds)} type="button">
                  添加选中镜头（{poolSelectedLensIds.length}）
                </button>
                <button className="primary-button" disabled={isSaving} onClick={() => void handleSaveEditTask()} type="button">
                  {isSaving ? '保存中...' : '保存任务信息'}
                </button>
              </div>
            </>
          ) : taskDetail ? (
            <>
              {/*
                视图3：任务详情展示（只读）
                — 任务概览（名称/状态/描述）
                — 统计卡片（镜头总数 / 已反馈 / 已通过）
                — 镜头队列（每个镜头的版本/状态/反馈数）
                — 任务元信息（时间线）
                — 操作按钮（提交 / 编辑 / 关闭等，根据状态显示）
              */}
              {/* 详情头部：任务名称 + 项目/导演信息 + 状态标签 */}
              <div className="section-heading">
                <div>
                  <h3>{taskDetail.taskName || `任务 ${taskDetail.taskId.slice(0, 8)}`}</h3>
                  <p className="muted">{taskDetail.projectName || '—'} · 导演：{taskDetail.directorName || '未指定'}</p>
                </div>
                <span className={`status-pill status-${taskDetail.status}`}>
                  {PRODUCER_STATUS_LABELS[taskDetail.producerStatus ?? taskDetail.status] ?? taskDetail.status}
                </span>
              </div>

              {/* 提审说明（如有） */}
              {taskDetail.description ? <p>{taskDetail.description}</p> : null}

              {/* 统计卡片：镜头总数 / 已反馈 / 已通过 */}
              <div className="review-stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <article className="review-stat-card"><span className="review-stat-label">镜头总数</span><strong>{taskDetail.totalShots}</strong></article>
                <article className="review-stat-card"><span className="review-stat-label">已反馈</span><strong>{taskDetail.feedbackShotCount}</strong></article>
                <article className="review-stat-card approved"><span className="review-stat-label">已通过</span><strong>{taskDetail.approvedShotCount}</strong></article>
              </div>

              {/* 镜头队列列表 */}
              <div className="section-heading">
                <h4>镜头队列</h4>
                <p className="muted">共 {taskDetail.shots.length} 个镜头</p>
              </div>

              <div className="review-task-list review-task-list--strip">
                {taskDetail.shots.map((shot, index) => (
                  /* 单个镜头卡片：序号 + 编码 + 提审版本/播放版本 + 内部状态 + 反馈数 + 素材状态 */
                  <article key={shot.taskShotId} className="review-task-card" style={{ cursor: 'default' }}>
                    <div className="section-heading">
                      <div>
                        <h4><span className="muted">#{index + 1}</span> {shot.lensCode}</h4>
                        <p className="muted">提审版本：V{shot.submitVersionNum || '—'} · 播放版本：V{shot.actualVersionNum || '—'}</p>
                      </div>
                      <span className={`status-pill status-${shot.status}`}>
                        {shot.internalReviewStatusName || getInternalReviewStatusLabel(shot.internalReviewStatusCode)}
                      </span>
                    </div>
                    <div className="stack-gap compact-gap">
                      <small className="muted">反馈 {shot.feedbackCount} 条</small>
                      {shot.lastFeedbackAtUtc ? <small className="muted">最近反馈 {formatDateTime(shot.lastFeedbackAtUtc)}</small> : null}
                      <small className="muted">素材：{shot.hasPlayableMedia ? '可播放' : '待检查'}</small>
                    </div>
                  </article>
                ))}
              </div>

              {/* 任务时间线信息 */}
              <div className="section-heading">
                <h4>任务信息</h4>
              </div>
              <div className="stack-gap compact-gap">
                <small className="muted">提交人：{taskDetail.submitterName || '—'}</small>
                <small className="muted">提交时间：{formatDateTime(taskDetail.submitTime)}</small>
                <small className="muted">开始时间：{formatDateTime(taskDetail.startTime)}</small>
                <small className="muted">完成时间：{formatDateTime(taskDetail.completeTime)}</small>
                <small className="muted">创建时间：{formatDateTime(taskDetail.createdAtUtc)}</small>
                <small className="muted">最近更新：{formatDateTime(taskDetail.updatedAtUtc)}</small>
              </div>

              {/* 根据任务状态显示不同的操作按钮组 */}
              <div className="actions-row wrap-actions">
                {/* 草稿/待提交/待审状态：可提交给导演 + 编辑 */}
                {(taskDetail.producerStatus === 'draft' || taskDetail.producerStatus === 'pending-submit' || taskDetail.status === 'pending') ? (
                  <>
                    <button className="primary-button" disabled={isSubmitting || taskDetail.shots.length === 0} onClick={() => void handleSubmitTask(taskDetail.taskId)} type="button">
                      {isSubmitting ? '提交中...' : '提交任务给导演'}
                    </button>
                    <button className="secondary-button" onClick={() => openEditForm(selectedTask!, taskDetail)} type="button">编辑任务</button>
                  </>
                ) : null}
                {/* 草稿/待提交状态：编辑草稿按钮 */}
                {(getProducerStatus(selectedTask!) === 'draft' || getProducerStatus(selectedTask!) === 'pending-submit') ? (
                  <button className="secondary-button" onClick={() => openEditForm(selectedTask!, taskDetail)} type="button">编辑草稿</button>
                ) : null}
                {/* 审阅中状态：引导用户去导演工作台查看 */}
                {taskDetail.status === 'in-review' ? (
                  <button className="secondary-button" onClick={() => setResult({ success: true, error: '审片进度请在导演工作台查看，制片端仅保留任务详情与关闭入口。' })} type="button">查看审片进度</button>
                ) : null}
                {/* 非关闭/完成状态：可手动关闭任务 */}
                {taskDetail.status !== 'closed' && taskDetail.status !== 'completed' ? (
                  <button className="secondary-button" onClick={() => void handleCloseTask(taskDetail.taskId)} type="button">关闭任务</button>
                ) : null}
              </div>
              {/* 审阅中状态的提示文字 */}
              {taskDetail.status === 'in-review' ? <p className="muted">当前任务已进入导演审片阶段，制片端仅可查看任务详情，不进入导演工作台。</p> : null}
            </>
          ) : (
            /*
              视图4：空状态引导
              — 未选中任何任务时的默认占位提示
            */
            <div className="lens-empty-state">
              <p className="muted">选择一个任务查看详情，或点击"新建任务"创建审片任务。</p>
              <small className="muted">
                制片任务装配台支持创建草稿任务、添加镜头、调整顺序、提交给导演以及跟踪反馈状态。
              </small>
            </div>
          )}
        </section>
      </div>

        {/* ===== 底部镜头池：待提审镜头一览（全宽横跨两栏） ===== */}
      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>待提审镜头池</h3>
            <p className="muted">可勾选后加入当前编辑的任务。</p>
          </div>
          {/* 镜头池筛选标签：全部 / 待提审 / 已按反馈修改 / 缺素材 */}
          <div className="filter-bar review-filter-bar">
            <button className={shotPoolFilter === 'all' ? 'tab-button active' : 'tab-button'} onClick={() => setShotPoolFilter('all')} type="button">全部</button>
            <button className={shotPoolFilter === 'ready-for-review' ? 'tab-button active' : 'tab-button'} onClick={() => setShotPoolFilter('ready-for-review')} type="button">待提审</button>
            <button className={shotPoolFilter === 'fix-updated' ? 'tab-button active' : 'tab-button'} onClick={() => setShotPoolFilter('fix-updated')} type="button">已按反馈修改</button>
            <button className={shotPoolFilter === 'no-media' ? 'tab-button active' : 'tab-button'} onClick={() => setShotPoolFilter('no-media')} type="button">缺素材</button>
          </div>
        </div>
        {filteredShotPool.length === 0 ? (
          <p className="muted">暂无符合条件的镜头。</p>
        ) : (
          /* 镜头表格：勾选列（仅在编辑模式下显示）+ 镜头编号 / 版本 / 二级状态 / 制作人员 */
          <div className="lens-table-shell" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="lens-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>{selectedTask && showEditForm ? '' : ''}</th>
                  <th>镜头编号</th>
                  <th>版本</th>
                  <th>二级状态</th>
                  <th>制作人员</th>
                </tr>
              </thead>
              <tbody>
                {filteredShotPool.map((lens) => (
                    <tr key={lens.lensId}>
                      <td>
                        {/* 仅在编辑模式下显示勾选框，用于批量添加到任务 */}
                        {showEditForm && selectedTask ? (
                          <input
                            checked={poolSelectedLensIds.includes(lens.lensId)}
                          onChange={() => togglePoolLensSelection(lens.lensId)}
                          type="checkbox"
                        />
                      ) : null}
                    </td>
                      <td>{lens.lensCode}</td>
                      <td>V{lens.versionNum}</td>
                      <td><span className={lens.internalReviewStatusCode === 'READY_FOR_REVIEW' ? 'success-copy' : 'muted'}>{getInternalReviewStatusLabel(lens.internalReviewStatusCode, lens.internalReviewStatusName)}</span></td>
                      <td>{lens.maker || '—'}</td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
