/**
 * 任务进度条组件属性
 */
interface TaskProgressBarProps {
  /** 任务进度百分比（0-100） */
  progress: number;
}

/**
 * 任务进度条组件
 * 用于显示任务的执行进度，包括进度条和百分比文字
 * @param props 组件属性
 * @returns JSX元素
 */
export function TaskProgressBar({ progress }: TaskProgressBarProps) {
  return (
    <div>
      {/* 进度条外壳 */}
      <div className="progress-shell" aria-label={`进度 ${progress}%`}>
        {/* 进度条填充部分：宽度随进度变化 */}
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      {/* 进度百分比文字 */}
      <p className="muted progress-copy">{progress}%</p>
    </div>
  );
}
