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
import type { ReviewTaskSummary, ReviewTaskDetail, ReviewTaskShot, ReviewParticipationMode } from '../types/review';
import type { LensRecord } from '../types/lens';

interface ProducerTaskPageProps {
  onOpenReviewTask: (taskId: string) => void;
  initialTaskId?: string | null;
}

interface ApiUserItem {
  userId: string;
  userName: string;
  displayName: string;
  roles: string[];
  isActive: boolean;
}

type TaskTabFilter = 'all' | 'draft' | 'pending' | 'in-review' | 'completed' | 'closed';
type ShotPoolFilter = 'all' | 'ready-for-review' | 'fix-updated' | 'no-media';

const PRODUCER_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  'pending-submit': '待提交',
  pending: '待审',
  'in-review': '审阅中',
  completed: '已完成',
  closed: '已关闭',
};

function getProducerStatus(task: ReviewTaskSummary): string {
  return task.producerStatus ?? task.status;
}

function getProducerStatusLabel(task: ReviewTaskSummary): string {
  return PRODUCER_STATUS_LABELS[getProducerStatus(task)] ?? task.status;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN');
}

export function ProducerTaskPage({ onOpenReviewTask, initialTaskId }: ProducerTaskPageProps) {
  const { user } = useAuthStore();
  const currentRole = getPrimaryRole(user);
  const { lenses, activeEpisodeId, activeEpisodeCode } = useLensStore();
  const { projects, activeProjectId } = useProjectStore();
  const { clearPendingReviewTaskId } = useDirectorNavigationStore();
  const activeProjectName = useMemo(() => projects.find((p) => p.projectId === activeProjectId)?.projectName ?? null, [projects, activeProjectId]);
  const isProducer = currentRole === 'producer';
  const lensById = useMemo(() => new Map(lenses.map((lens) => [lens.lensId, lens] as const)), [lenses]);

  const [tasks, setTasks] = useState<ReviewTaskSummary[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ReviewTaskSummary | null>(null);
  const [taskDetail, setTaskDetail] = useState<ReviewTaskDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [result, setResult] = useState<{ success: boolean; error?: string }>({ success: true });
  const [taskTabFilter, setTaskTabFilter] = useState<TaskTabFilter>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [shotPoolFilter, setShotPoolFilter] = useState<ShotPoolFilter>('all');

  // Create/Edit form state
  const [formTaskName, setFormTaskName] = useState('');
  const [formDirectorId, setFormDirectorId] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSelectedShotIds, setFormSelectedShotIds] = useState<string[]>([]);
  const [formShotModes, setFormShotModes] = useState<Record<string, ReviewParticipationMode>>({});
  const [directorUsers, setDirectorUsers] = useState<Array<{ userId: string; displayName: string; userName: string }>>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Task shot selection for pool
  const [poolSelectedLensIds, setPoolSelectedLensIds] = useState<string[]>([]);

  // Edit form state for existing task
  const [editTaskShotIds, setEditTaskShotIds] = useState<string[]>([]);
  const [editTaskDetail, setEditTaskDetail] = useState<ReviewTaskDetail | null>(null);
  const [editTaskShotModes, setEditTaskShotModes] = useState<Record<string, ReviewParticipationMode>>({});

  const filteredTasks = useMemo(() => {
    if (taskTabFilter === 'all') return tasks;
    return tasks.filter((task) => getProducerStatus(task) === taskTabFilter || task.status === taskTabFilter);
  }, [tasks, taskTabFilter]);

  const taskSummary = useMemo(() => ({
    total: tasks.length,
    draft: tasks.filter((t) => getProducerStatus(t) === 'draft').length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    inReview: tasks.filter((t) => t.status === 'in-review').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    closed: tasks.filter((t) => getProducerStatus(t) === 'closed').length,
  }), [tasks]);

  const shotPool = useMemo(() => {
    const taskShotIds = new Set<string>();
    for (const t of tasks) {
      if (t.shotCount > 0 && (getProducerStatus(t) === 'draft')) {
        // We don't have shot IDs from summary, so can't filter accurately without detail
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

  function getDirectorOptionLabel(director: { displayName: string; userName: string }): string {
    return director.displayName.trim() ? `${director.displayName} (${director.userName})` : director.userName;
  }

  function getShotModeLabel(mode?: ReviewParticipationMode): string {
    return mode === 'context' ? '上下文陪审' : '正式审片';
  }

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
          reviewParticipationMode: formShotModes[lensId] ?? getDefaultParticipationMode(lensId),
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

  async function handleSaveEditTask(): Promise<void> {
    if (!selectedTask) return;
    setIsSaving(true);
    try {
      const nextShots = editTaskDetail?.shots.map((shot, index) => ({
        lensId: shot.shotId,
        sequence: index,
        reviewParticipationMode: editTaskShotModes[shot.shotId] ?? shot.reviewParticipationMode ?? getDefaultParticipationMode(shot.shotId),
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

  async function handleAddShotsToTask(taskId: string, shotIds: string[]): Promise<void> {
    if (shotIds.length === 0) return;
    try {
      const response = await reviewService.addTaskShots({
        taskId,
        shotIds,
        shots: shotIds.map((lensId, index) => ({
          lensId,
          sequence: index,
          reviewParticipationMode: editTaskShotModes[lensId] ?? getDefaultParticipationMode(lensId),
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

  function resetCreateForm(): void {
    setFormTaskName('');
    setFormDirectorId('');
    setFormDescription('');
    setFormSelectedShotIds([]);
    setFormShotModes({});
  }

  function openCreateForm(): void {
    resetCreateForm();
    setShowCreateForm(true);
    setShowEditForm(false);
    setSelectedTask(null);
    setTaskDetail(null);
  }

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
      setEditTaskShotModes(Object.fromEntries(detail.shots.map((s) => [s.shotId, s.reviewParticipationMode ?? getDefaultParticipationMode(s.shotId)])));
    }
  }

  function togglePoolLensSelection(lensId: string): void {
    setPoolSelectedLensIds((current) =>
      current.includes(lensId) ? current.filter((id) => id !== lensId) : [...current, lensId],
    );
  }

  function toggleFormShotSelection(lensId: string): void {
    setFormSelectedShotIds((current) =>
      current.includes(lensId) ? current.filter((id) => id !== lensId) : [...current, lensId],
    );
    setFormShotModes((current) => ({ ...current, [lensId]: current[lensId] ?? getDefaultParticipationMode(lensId) }));
  }

  function toggleFormShotMode(lensId: string): void {
    setFormShotModes((current) => ({
      ...current,
      [lensId]: current[lensId] === 'context' ? 'review' : 'context',
    }));
  }

  function toggleEditShotMode(lensId: string): void {
    setEditTaskShotModes((current) => ({
      ...current,
      [lensId]: current[lensId] === 'context' ? 'review' : 'context',
    }));
  }

  function updateFormShotMode(lensId: string, mode: ReviewParticipationMode): void {
    setFormShotModes((current) => ({ ...current, [lensId]: mode }));
  }

  function updateEditShotMode(lensId: string, mode: ReviewParticipationMode): void {
    setEditTaskShotModes((current) => ({ ...current, [lensId]: mode }));
  }

  const handleSelectTask = (task: ReviewTaskSummary) => {
    setSelectedTask(task);
    setShowCreateForm(false);
    setShowEditForm(false);
    void loadTaskDetail(task);
  };

  useEffect(() => {
    void (async () => {
      await loadTasks();
      if (initialTaskId && tasks.length === 0) {
        // Tasks will be loaded after loadTasks completes; retry after a tick
        setTimeout(() => {
          const found = tasks.find((t) => t.taskId === initialTaskId);
          if (found) handleSelectTask(found);
        }, 100);
      }
    })();
  }, [activeProjectId]);

  // Auto-select task after tasks are loaded
  useEffect(() => {
    if (initialTaskId && tasks.length > 0) {
      const found = tasks.find((t) => t.taskId === initialTaskId);
      if (found) {
        handleSelectTask(found);
      }
      clearPendingReviewTaskId();
    }
  }, [tasks, initialTaskId]);

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
    <section className="page-layout stack-gap producer-task-page">
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

      {result.error ? (
        <div className="workbench-result-card">
          <span className="danger-copy">{result.error}</span>
          <button className="ghost-button" onClick={() => setResult({ success: true })} type="button">关闭</button>
        </div>
      ) : null}

      <div className="producer-task-layout">
        {/* Left panel: task list */}
        <section className="panel stack-gap producer-task-list-panel">
          <div className="section-heading">
            <div>
              <h3>审片任务列表</h3>
              <p className="muted">全部 {taskSummary.total} 个任务</p>
            </div>
            <button className="primary-button" onClick={openCreateForm} type="button">新建任务</button>
          </div>

          <div className="filter-bar review-filter-bar">
            <button className={taskTabFilter === 'all' ? 'tab-button active' : 'tab-button'} onClick={() => setTaskTabFilter('all')} type="button">全部 ({taskSummary.total})</button>
            <button className={taskTabFilter === 'draft' ? 'tab-button active' : 'tab-button'} onClick={() => setTaskTabFilter('draft')} type="button">草稿 ({taskSummary.draft})</button>
            <button className={taskTabFilter === 'pending' ? 'tab-button active' : 'tab-button'} onClick={() => setTaskTabFilter('pending')} type="button">待审 ({taskSummary.pending})</button>
            <button className={taskTabFilter === 'in-review' ? 'tab-button active' : 'tab-button'} onClick={() => setTaskTabFilter('in-review')} type="button">审阅中 ({taskSummary.inReview})</button>
            <button className={taskTabFilter === 'completed' ? 'tab-button active' : 'tab-button'} onClick={() => setTaskTabFilter('completed')} type="button">已完成 ({taskSummary.completed})</button>
          </div>

          {loadingTasks ? (
            <p className="muted">加载中...</p>
          ) : filteredTasks.length === 0 ? (
            <p className="muted">暂无任务，点击"新建任务"创建。</p>
          ) : (
            <div className="review-task-list review-task-list--strip">
              {filteredTasks.map((task) => (
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
        </section>

        {/* Right panel: task detail / create form / edit form */}
        <section className="panel stack-gap producer-task-detail-panel">
          {showCreateForm ? (
            <>
              <div className="section-heading">
                <div>
                  <h3>新建审片任务</h3>
                  <p className="muted">创建草稿后可继续添加镜头、调整顺序并提交。</p>
                </div>
                <button className="secondary-button" onClick={() => setShowCreateForm(false)} type="button">取消</button>
              </div>

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

              <div className="section-heading">
                <h4>选择镜头加入任务</h4>
                <p className="muted">从下方镜头池勾选要加入的镜头。</p>
              </div>
              <div className="lens-bulk-actions lens-bulk-actions-grid" style={{ border: '1px solid var(--border)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', maxHeight: 300, overflowY: 'auto' }}>
                {shotPool.length === 0 ? (
                  <p className="muted">暂无可用镜头。</p>
                ) : (
                  shotPool.map((lens) => (
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
              <small className="muted">已选 {formSelectedShotIds.length} 个镜头</small>

              <div className="actions-row wrap-actions">
                <button className="primary-button" disabled={isSaving} onClick={() => void handleCreateTask()} type="button">
                  {isSaving ? '创建中...' : '创建草稿任务'}
                </button>
                <button className="secondary-button" onClick={() => setShowCreateForm(false)} type="button">取消</button>
              </div>
            </>
          ) : showEditForm && selectedTask ? (
            <>
              <div className="section-heading">
                <div>
                  <h3>编辑任务：{selectedTask.taskName || selectedTask.taskId.slice(0, 8)}</h3>
                  <p className="muted">修改任务信息或管理镜头列表。</p>
                </div>
                <button className="secondary-button" onClick={() => setShowEditForm(false)} type="button">完成编辑</button>
              </div>

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

              <div className="section-heading">
                <h4>任务镜头列表</h4>
                <p className="muted">任务内当前镜头顺序。</p>
              </div>
              {taskDetail?.shots.map((shot, index) => (
                <div key={shot.taskShotId} className="lens-bulk-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                  <strong>{index + 1}.</strong>
                  <span>{shot.lensCode}</span>
                  <small className="muted">V{shot.submitVersionNum || shot.actualVersionNum || '—'}</small>
                  <span className="status-pill">{getShotModeLabel(shot.reviewParticipationMode)}</span>
                  <span className={`status-pill status-${shot.status}`}>{shot.feedbackCount > 0 ? `${shot.feedbackCount} 反馈` : '无反馈'}</span>
                  <button className="ghost-button" onClick={() => toggleEditShotMode(shot.shotId)} type="button">切换参与类型</button>
                  <button className="ghost-button danger-copy" onClick={() => void handleRemoveShot(selectedTask.taskId, shot.taskShotId)} type="button">移除</button>
                </div>
              )) || <p className="muted">暂无镜头</p>}

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
              <div className="section-heading">
                <div>
                  <h3>{taskDetail.taskName || `任务 ${taskDetail.taskId.slice(0, 8)}`}</h3>
                  <p className="muted">{taskDetail.projectName || '—'} · 导演：{taskDetail.directorName || '未指定'}</p>
                </div>
                <span className={`status-pill status-${taskDetail.status}`}>
                  {PRODUCER_STATUS_LABELS[taskDetail.producerStatus ?? taskDetail.status] ?? taskDetail.status}
                </span>
              </div>

              {taskDetail.description ? <p>{taskDetail.description}</p> : null}

              <div className="review-stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <article className="review-stat-card"><span className="review-stat-label">镜头总数</span><strong>{taskDetail.totalShots}</strong></article>
                <article className="review-stat-card"><span className="review-stat-label">已反馈</span><strong>{taskDetail.feedbackShotCount}</strong></article>
                <article className="review-stat-card approved"><span className="review-stat-label">已通过</span><strong>{taskDetail.approvedShotCount}</strong></article>
              </div>

              <div className="section-heading">
                <h4>镜头队列</h4>
                <p className="muted">共 {taskDetail.shots.length} 个镜头</p>
              </div>

              <div className="review-task-list review-task-list--strip">
                {taskDetail.shots.map((shot, index) => (
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

              <div className="actions-row wrap-actions">
                {(taskDetail.producerStatus === 'draft' || taskDetail.producerStatus === 'pending-submit' || taskDetail.status === 'pending') ? (
                  <>
                    <button className="primary-button" disabled={isSubmitting || taskDetail.shots.length === 0} onClick={() => void handleSubmitTask(taskDetail.taskId)} type="button">
                      {isSubmitting ? '提交中...' : '提交任务给导演'}
                    </button>
                    <button className="secondary-button" onClick={() => openEditForm(selectedTask!, taskDetail)} type="button">编辑任务</button>
                  </>
                ) : null}
                {(getProducerStatus(selectedTask!) === 'draft' || getProducerStatus(selectedTask!) === 'pending-submit') ? (
                  <button className="secondary-button" onClick={() => openEditForm(selectedTask!, taskDetail)} type="button">编辑草稿</button>
                ) : null}
                {taskDetail.status === 'in-review' ? (
                  <button className="secondary-button" onClick={() => onOpenReviewTask(taskDetail.taskId)} type="button">查看审片进度</button>
                ) : null}
                {taskDetail.status !== 'closed' && taskDetail.status !== 'completed' ? (
                  <button className="secondary-button" onClick={() => void handleCloseTask(taskDetail.taskId)} type="button">关闭任务</button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="lens-empty-state">
              <p className="muted">选择一个任务查看详情，或点击"新建任务"创建审片任务。</p>
              <small className="muted">
                制片任务装配台支持创建草稿任务、添加镜头、调整顺序、提交给导演以及跟踪反馈状态。
              </small>
            </div>
          )}
        </section>
      </div>

      {/* Bottom pool: ready shots */}
      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>待提审镜头池</h3>
            <p className="muted">可勾选后加入当前编辑的任务。</p>
          </div>
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
