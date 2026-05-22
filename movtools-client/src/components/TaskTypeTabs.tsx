import type { TaskType } from '../types/ipc';
import { taskTypeLabels as labels } from '../lib/displayText';

const orderedTaskTypes: TaskType[] = ['merge-video', 'transcode', 'extract-audio', 'trim', 'compress', 'export-frame'];

interface TaskTypeTabsProps {
  taskType: TaskType;
  onTaskTypeChange: (taskType: TaskType) => void;
}

export function TaskTypeTabs({ taskType, onTaskTypeChange }: TaskTypeTabsProps) {
  return (
    <div className="tabs-row" role="tablist" aria-label="任务类型">
      {orderedTaskTypes.map((type) => (
        <button
          key={type}
          className={taskType === type ? 'tab-button active' : 'tab-button'}
          onClick={() => onTaskTypeChange(type)}
          type="button"
        >
          {labels[type]}
        </button>
      ))}
    </div>
  );
}
