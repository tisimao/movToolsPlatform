import { useEffect, useMemo, useState } from 'react';
import { projectService, reviewService } from '../services/repositoryService';
import { useDirectorNavigationStore } from '../stores/directorNavigationStore';
import { useProjectStore } from '../stores/projectStore';
import { filterDirectorVisibleReviewTasks } from '../lib/reviewTaskVisibility';
import type { ProjectSummary } from '../types/project';
import type { ReviewFeedback, ReviewTask, ReviewTaskStatus } from '../types/review';

interface DirectorDashboardPageProps {
  onOpenLens: (lensId?: string) => void;
  onOpenReviewTask: (taskId: string) => void;
}

type TaskFilter = 'all' | 'pending' | 'in-review';

const taskStatusLabel: Record<ReviewTaskStatus, string> = {
  pending: '待审',
  'in-review': '审阅中',
  approved: '通过',
  rejected: '返修',
  closed: '已关闭',
  completed: '已完成',
};

function formatTime(value?: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN');
}

export function DirectorDashboardPage({ onOpenLens, onOpenReviewTask }: DirectorDashboardPageProps) {
  const { projects, activeProjectId, setWorkspace } = useProjectStore();
  const { setPendingReviewTaskId, setPendingLensId } = useDirectorNavigationStore();
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [feedbacks, setFeedbacks] = useState<ReviewFeedback[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingFeedbacks, setLoadingFeedbacks] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('all');

  const activeProject = useMemo(() => projects.find((project) => project.projectId === activeProjectId) ?? null, [projects, activeProjectId]);
  const activeProjectTasks = useMemo(() => {
    if (!activeProjectId) return [];
    return tasks.filter((task) => task.projectId === activeProjectId);
  }, [activeProjectId, tasks]);
  const directorVisibleTasks = useMemo(() => filterDirectorVisibleReviewTasks(activeProjectTasks), [activeProjectTasks]);
  const activeTasks = useMemo(() => directorVisibleTasks.filter((task) => !['approved', 'completed', 'rejected', 'closed'].includes(task.status)), [directorVisibleTasks]);
  const archivedTasks = useMemo(() => directorVisibleTasks.filter((task) => ['approved', 'completed'].includes(task.status)), [directorVisibleTasks]);
  const hiddenClosedCount = useMemo(() => directorVisibleTasks.filter((task) => ['rejected', 'closed'].includes(task.status)).length, [directorVisibleTasks]);
  const visibleTasks = useMemo(() => {
    if (filter === 'all') return activeTasks;
    return activeTasks.filter((task) => task.status === filter);
  }, [activeTasks, filter]);

  const taskSummary = useMemo(() => ({
    total: activeTasks.length,
    pending: activeTasks.filter((task) => task.status === 'pending').length,
    inReview: activeTasks.filter((task) => task.status === 'in-review').length,
    completed: archivedTasks.length,
  }), [activeTasks, archivedTasks]);

  const projectTaskSummary = useMemo(() => {
    const summary = new Map<string, { pending: number; total: number; latestSubmitTime: string | null }>();
    for (const task of tasks) {
      const current = summary.get(task.projectId) ?? { pending: 0, total: 0, latestSubmitTime: null };
      current.total += 1;
      if (task.status === 'pending') current.pending += 1;
      if (!current.latestSubmitTime || current.latestSubmitTime < task.submitTime) current.latestSubmitTime = task.submitTime;
      summary.set(task.projectId, current);
    }
    return summary;
  }, [tasks]);

  const recentFeedbacks = useMemo(
    () => feedbacks.slice().sort((left, right) => right.createdAtUtc.localeCompare(left.createdAtUtc)).slice(0, 8),
    [feedbacks],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingProjects(true);
      try {
        const workspace = await projectService.getWorkspace();
        if (!cancelled) setWorkspace(workspace);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : '刷新项目失败。');
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => { cancelled = true; };
  }, [setWorkspace]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingTasks(true);
      try {
        const response = await reviewService.listReviewTasks();
        if (cancelled) return;
        if (response.success) {
          setTasks(filterDirectorVisibleReviewTasks(response.tasks));
        } else {
          setTasks([]);
          setMessage(response.error ?? '加载审片任务失败。');
        }
      } finally {
        if (!cancelled) setLoadingTasks(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProjectId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingFeedbacks(true);
      try {
        const targets = activeProjectTasks.slice(0, 8);
        const nested = await Promise.all(targets.map(async (task) => {
          const response = await reviewService.listReviewFeedbacks(task.lensId);
          if (!response.success) return [] as ReviewFeedback[];
          return response.feedbacks;
        }));
        if (!cancelled) setFeedbacks(nested.flat());
      } finally {
        if (!cancelled) setLoadingFeedbacks(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProjectTasks]);

  async function handleActivateProject(projectId: string): Promise<void> {
    setMessage(null);
    setLoadingProjects(true);
    try {
      const response = await projectService.setActiveProject(projectId);
      if (response.success && response.workspace) {
        setWorkspace(response.workspace);
      } else {
        setMessage(response.error ?? '激活项目失败。');
      }
    } finally {
      setLoadingProjects(false);
    }
  }

  function openTask(task: ReviewTask): void {
    if (task.status === 'closed') {
      setMessage('已关闭任务不进入导演审片工作台。');
      return;
    }
    setPendingReviewTaskId(task.taskId);
    setPendingLensId(task.lensId);
    onOpenReviewTask(task.taskId);
  }

  return (
    <section className="page-layout stack-gap director-dashboard-page">
      <header className="page-header dashboard-header director-dashboard-header">
        <div>
          <p className="eyebrow">仪表盘</p>
          <h2>导演仪表盘</h2>
          <p className="muted">仅显示已正式提交的审片任务，项目和镜头仅作为辅助入口。</p>
        </div>
        <div className="director-dashboard-meta-grid">
          <article className="dashboard-metric-card dashboard-metric-card--compact"><span className="lens-summary-label">当前激活项目</span><strong>{activeProject?.projectName ?? '未激活'}</strong></article>
          <article className="dashboard-metric-card dashboard-metric-card--compact"><span className="lens-summary-label">待审任务数量</span><strong>{taskSummary.pending}</strong></article>
          <article className="dashboard-metric-card dashboard-metric-card--compact"><span className="lens-summary-label">最近更新时间</span><strong>{formatTime(recentFeedbacks[0]?.createdAtUtc ?? null)}</strong></article>
        </div>
      </header>

      {message ? <div className="workbench-result-card"><span>{message}</span></div> : null}

      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>我参与的项目</h3>
            <p className="muted">沿用现有项目激活链路。</p>
          </div>
        </div>
        <div className="dashboard-project-grid">
          {projects.length === 0 ? <p className="muted">暂无可访问项目。</p> : projects.map((project: ProjectSummary) => {
            const isActive = project.projectId === activeProjectId;
            const summary = projectTaskSummary.get(project.projectId);
            return (
              <article className={isActive ? 'project-card dashboard-project-card is-active' : 'project-card dashboard-project-card'} key={project.projectId}>
                <div className="section-heading">
                  <div>
                    <h4>{project.projectName}</h4>
                    <p className="muted">项目代号：{project.projectId}</p>
                  </div>
                  <span className={isActive ? 'environment-pill ready' : 'environment-pill info'}>{isActive ? '当前激活' : '可激活'}</span>
                </div>
                <small className="muted">阶段：{project.versionTag ?? project.layoutTag ?? '—'} · 待审任务数：{summary?.pending ?? 0}</small>
                <small className="muted">最近提审时间：{formatTime(summary?.latestSubmitTime ?? project.updatedAt ?? null)}</small>
                <div className="actions-row compact-actions wrap-actions">
                  <button className="secondary-button" disabled={isActive || loadingProjects} onClick={() => void handleActivateProject(project.projectId)} type="button">{isActive ? '已激活' : '激活项目'}</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>当前激活项目的审片任务</h3>
            <p className="muted">开始审片 / 继续审片会直接进入审片工作台并自动选中任务。</p>
          </div>
          <div className="filter-bar review-filter-bar">
            <button className={filter === 'all' ? 'tab-button active' : 'tab-button'} onClick={() => setFilter('all')} type="button">全部 ({activeTasks.length})</button>
            <button className={filter === 'pending' ? 'tab-button active' : 'tab-button'} onClick={() => setFilter('pending')} type="button">待审 ({taskSummary.pending})</button>
            <button className={filter === 'in-review' ? 'tab-button active' : 'tab-button'} onClick={() => setFilter('in-review')} type="button">审阅中 ({taskSummary.inReview})</button>
          </div>
        </div>
        {loadingTasks ? <p className="muted">加载中...</p> : visibleTasks.length === 0 ? <p className="muted">当前激活项目暂无审片任务。</p> : <div className="review-task-list review-task-list--strip">{visibleTasks.map((task) => (
          <article className="review-task-card" key={task.taskId}>
            <div className="section-heading">
              <div>
                <h4>{task.lensCode} <small className="muted">({task.shotCount || 1} 镜头)</small></h4>
                <p className="muted">{task.projectName} · 提交人：{task.submitterName} · 导演：{task.reviewerName || task.assignedToUserName || '—'}</p>
              </div>
              <span className={`status-pill status-${task.status}`}>{taskStatusLabel[task.status]}</span>
            </div>
            <small className="muted">镜头数：{task.shotCount || 1} · 反馈：{task.commentCount} · 提交时间：{formatTime(task.submitTime)} · 更新：{formatTime(task.updatedAtUtc || task.reviewTime || task.submitTime)}</small>
            <div className="actions-row compact-actions">
              <button className="primary-button" onClick={() => openTask(task)} type="button">{task.status === 'pending' ? '开始审片' : '继续审片'}</button>
              <button className="secondary-button" onClick={() => onOpenLens(task.lensId)} type="button">回到镜头</button>
              <small className="muted">导演入口只进入审片工作台；context 镜头在工作台内保持只读。</small>
            </div>
          </article>
          ))}</div>}
        <details className="lens-detail-collapsible director-dashboard-archive" open={false}>
          <summary className="lens-detail-collapsible-summary">已完成任务归档（{taskSummary.completed}）</summary>
          {archivedTasks.length === 0 ? (
            <p className="muted" style={{ marginTop: '0.75rem' }}>暂无已完成任务。</p>
          ) : (
            <div className="review-task-list review-task-list--strip" style={{ marginTop: '0.75rem' }}>
              {archivedTasks.map((task) => (
                <article className="review-task-card" key={task.taskId}>
                  <div className="section-heading">
                    <div>
                      <h4>{task.lensCode} <small className="muted">({task.shotCount || 1} 镜头)</small></h4>
                      <p className="muted">{task.projectName} · 提交人：{task.submitterName} · 导演：{task.reviewerName || task.assignedToUserName || '—'}</p>
                    </div>
                    <span className={`status-pill status-${task.status}`}>{taskStatusLabel[task.status]}</span>
                  </div>
                  <small className="muted">镜头数：{task.shotCount || 1} · 反馈：{task.commentCount} · 提交时间：{formatTime(task.submitTime)} · 更新：{formatTime(task.updatedAtUtc || task.reviewTime || task.submitTime)}</small>
                  <div className="actions-row compact-actions">
                    <button className="primary-button" onClick={() => openTask(task)} type="button">查看任务</button>
                    <button className="secondary-button" onClick={() => onOpenLens(task.lensId)} type="button">回到镜头</button>
                    <small className="muted">导演入口只进入审片工作台；context 镜头在工作台内保持只读。</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </details>
        {hiddenClosedCount > 0 ? <p className="muted">已关闭任务已从导演可见区移除。</p> : null}
      </section>

      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>最近反馈记录</h3>
            <p className="muted">当前先按激活项目反馈近似聚合，后续可直接替换为精确个人维度接口。</p>
          </div>
        </div>
        {loadingFeedbacks ? <p className="muted">加载中...</p> : recentFeedbacks.length === 0 ? <p className="muted">当前激活项目暂无反馈记录。</p> : <div className="stack-gap">{recentFeedbacks.map((feedback) => (
          <article className="comment-card" key={feedback.feedbackId}>
            <div className="section-heading">
              <div>
                <strong>{feedback.lensCode}</strong>
                <span className="timestamp-badge">任务 {feedback.reviewTaskId}</span>
              </div>
              <small className="muted">{formatTime(feedback.createdAtUtc)}</small>
            </div>
            <p>{feedback.commentText || '—'}</p>
            <small className="muted">帧 {feedback.frameNumber ?? '—'} · {feedback.timecode ?? '—'}</small>
            <div className="actions-row compact-actions">
              <button className="secondary-button" onClick={() => onOpenReviewTask(feedback.reviewTaskId)} type="button">回到任务</button>
              <button className="secondary-button" onClick={() => onOpenLens(feedback.lensId)} type="button">回到镜头</button>
            </div>
          </article>
        ))}</div>}
      </section>
    </section>
  );
}
