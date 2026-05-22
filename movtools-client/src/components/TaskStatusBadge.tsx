import type { TaskStatus } from '../types/task';
import { taskStatusLabels } from '../lib/displayText';

/**
 * 任务状态标签组件属性
 */
interface TaskStatusBadgeProps {
  /** 任务状态 */
  status: TaskStatus;
}

/**
 * 任务状态标签组件
 * 根据任务状态显示对应的状态标签（如：排队中、运行中、已完成等）
 * @param props 组件属性
 * @returns JSX元素
 */
export function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  return <span className={`status-badge status-${status}`}>{taskStatusLabels[status]}</span>;
}
