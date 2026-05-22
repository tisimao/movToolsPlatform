import type { MediaTask } from '../types/task';
import { taskTypeLabels } from '../lib/displayText';
import { TaskProgressBar } from './TaskProgressBar';
import { TaskStatusBadge } from './TaskStatusBadge';

/**
 * 任务项组件属性
 */
interface TaskItemProps {
  /** 取消任务的回调函数 */
  onCancelTask: (taskId: string) => Promise<void>;
  /** 移除任务的回调函数 */
  onRemoveTask: (taskId: string) => Promise<void>;
  /** 重试任务的回调函数 */
  onRetryTask: (taskId: string) => Promise<void>;
  /** 任务数据 */
  task: MediaTask;
}

/**
 * 任务项组件
 * 用于在工作台中显示单个媒体处理任务的信息和操作按钮
 * @param props 组件属性
 * @returns JSX元素
 */
export function TaskItem({ onCancelTask, onRemoveTask, onRetryTask, task }: TaskItemProps) {
  /** 判断任务是否可以取消（排队中或运行中） */
  const canCancel = task.status === 'queued' || task.status === 'running';
  /** 判断任务是否可以重试（失败、取消或成功状态） */
  const canRetry = task.status === 'failed' || task.status === 'cancelled' || task.status === 'success';
  /** 判断任务是否可以移除（非运行中状态） */
  const canRemove = task.status !== 'running';
  /** 合并视频任务的镜头顺序摘要（如果有） */
  const mergeLensSummary = task.type === 'merge-video' && task.mergeLensCodes && task.mergeLensCodes.length > 0
    ? task.mergeLensCodes.join(' / ')
    : null;

  return (
    <article className="task-card workbench-task-card">
      <div className="section-heading workbench-task-card__header">
        <div>
          <strong>{taskTypeLabels[task.type]}</strong>
          <p className="muted file-name">{task.sourcePaths && task.sourcePaths.length > 1 ? `共 ${task.sourcePaths.length} 段视频，首段：${task.inputPath}` : task.inputPath}</p>
        </div>
        <TaskStatusBadge status={task.status} />
      </div>

      {/* 任务进度条 */}
      <TaskProgressBar progress={task.progress} />
      {/* 输出文件路径 */}
      <p className="muted file-name">输出：{task.outputPath}</p>
      {/* 合并视频任务的镜头顺序 */}
      {mergeLensSummary ? <p className="muted file-name">镜头顺序：{mergeLensSummary}</p> : null}
      {/* 错误信息（如果有） */}
      {task.errorMessage ? <p className="error-copy">错误：{task.errorMessage}</p> : null}
      {/* 日志文件路径（如果有） */}
      {task.logPath ? <p className="muted file-name">日志：{task.logPath}</p> : null}
      {/* 操作按钮组：重试、取消、移除 */}
      {canCancel || canRetry || canRemove ? (
        <div className="actions-row compact-actions wrap-actions workbench-task-card__actions">
          {/* 重试按钮 */}
          {canRetry ? (
            <button 
              className="secondary-button" 
              onClick={() => void onRetryTask(task.id)} 
              type="button"
            >
              重试
            </button>
          ) : null}
          {/* 取消按钮 */}
          {canCancel ? (
            <button 
              className="secondary-button" 
              onClick={() => void onCancelTask(task.id)} 
              type="button"
            >
              取消
            </button>
          ) : null}
          {/* 移除按钮 */}
          {canRemove ? (
            <button 
              className="secondary-button" 
              onClick={() => void onRemoveTask(task.id)} 
              type="button"
            >
              移除
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
