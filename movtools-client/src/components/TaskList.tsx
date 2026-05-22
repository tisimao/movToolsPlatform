import type { MediaTask } from '../types/task';
import { TaskItem } from './TaskItem';

/**
 * 任务列表组件属性
 */
interface TaskListProps {
  /** 取消任务的回调函数 */
  onCancelTask: (taskId: string) => Promise<void>;
  /** 清除已完成任务的回调函数 */
  onClearCompleted: () => Promise<void>;
  /** 移除任务的回调函数 */
  onRemoveTask: (taskId: string) => Promise<void>;
  /** 重试任务的回调函数 */
  onRetryTask: (taskId: string) => Promise<void>;
  /** 任务数组 */
  tasks: MediaTask[];
}

/**
 * 任务列表组件
 * 用于显示媒体处理任务的列表，并提供任务操作功能（取消、重试、移除、清除已完成）
 * @param props 组件属性
 * @returns JSX元素
 */
export function TaskList({ onCancelTask, onClearCompleted, onRemoveTask, onRetryTask, tasks }: TaskListProps) {
  /** 计算已完成任务的数量（成功、失败或取消状态） */
  const completedCount = tasks.filter((task) => task.status === 'success' || task.status === 'failed' || task.status === 'cancelled').length;

  return (
    <section className="panel stack-gap workbench-task-panel">
      <div className="section-heading workbench-task-header">
        <div>
          <h3>任务队列</h3>
          <span className="muted">共 {tasks.length} 项</span>
        </div>
        {/* 清除已完成按钮：当没有已完成任务时禁用 */}
        <button 
          className="secondary-button" 
          disabled={completedCount === 0} 
          onClick={() => void onClearCompleted()} 
          type="button"
        >
          清空已完成
        </button>
      </div>

      <div className="task-list workbench-task-list">
        {/* 渲染任务列表或空状态提示 */}
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <TaskItem 
              key={task.id} 
              onCancelTask={onCancelTask} 
              onRemoveTask={onRemoveTask} 
              onRetryTask={onRetryTask} 
              task={task} 
            />
          ))
        ) : (
          <p className="muted">当前队列为空。</p>
        )}
      </div>
    </section>
  );
}
