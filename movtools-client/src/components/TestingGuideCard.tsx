import type { TaskType } from '../types/ipc';

/**
 * 测试向导卡片组件属性
 */
interface TestingGuideCardProps {
  /** 当前选中的任务类型 */
  currentTaskType: TaskType;
  /** 环境是否就绪 */
  isEnvironmentReady: boolean;
  /** 打开日志的回调函数 */
  onOpenLogs: () => void;
  /** 打开设置的回调函数 */
  onOpenSettings: () => void;
  /** 选择任务类型的回调函数 */
  onSelectTaskType: (taskType: TaskType) => void;
  /** 队列中的任务数量 */
  queueCount: number;
  /** 已选中的文件数量 */
  selectedFilesCount: number;
}

/**
 * 推荐的测试任务列表
 */
const recommendedTests: Array<{ type: TaskType; label: string; description: string }> = [
  { type: 'merge-video', label: '视频拼接', description: '把多段视频按顺序拼成一个视频，适合你的核心使用场景。' },
  { type: 'transcode', label: '视频转码', description: '最适合作为第一项测试，可确认 FFmpeg 和输出流程是否正常。' },
  { type: 'extract-audio', label: '提取音频', description: '适合作为第二项快速检查，可从视频中导出 MP3。' },
  { type: 'trim', label: '视频裁剪', description: '用于验证时间输入与短片段输出是否正常。' },
  { type: 'export-frame', label: '导出画面', description: '最直观的视觉检查，可导出 JPG 或 PNG 图片。' },
];

/**
 * 测试向导卡片组件
 * 用于引导用户完成首次功能测试，提供分步骤的操作指南
 * @param props 组件属性
 * @returns JSX元素
 */
export function TestingGuideCard({
  currentTaskType,
  isEnvironmentReady,
  onOpenLogs,
  onOpenSettings,
  onSelectTaskType,
  queueCount,
  selectedFilesCount,
}: TestingGuideCardProps) {
  return (
    <section className="guide-card">
      {/* 卡片头部：标题和说明 */}
      <div className="guide-card__hero">
        <div>
          <p className="eyebrow">测试向导</p>
          <h3>如果你想更直观地测试功能，就从这里开始</h3>
          <p className="muted guide-card__copy">
            按照下面步骤从左到右操作，你可以从环境设置一路走到可见的任务结果，不需要再猜下一步该点哪里。
          </p>
        </div>

        {/* 卡片摘要：显示已选文件数和队列任务数 */}
        <div className="guide-card__summary">
          <div>
            <span className="guide-card__metric">已选文件</span>
            <strong>{selectedFilesCount}</strong>
          </div>
          <div>
            <span className="guide-card__metric">队列任务</span>
            <strong>{queueCount}</strong>
          </div>
        </div>
      </div>

      {/* 测试步骤容器 */}
      <div className="guide-steps">
        {/* 步骤1：检查环境设置 */}
        <article className={isEnvironmentReady ? 'guide-step ready' : 'guide-step blocked'}>
          <span className="guide-step__number">1</span>
          <div>
            <strong>先打开设置，确认工具路径</strong>
            <p className="muted">先确保 FFmpeg 和 FFprobe 可用。如果上方环境卡是红色，就先修复它。</p>
          </div>
          <button className="secondary-button" onClick={onOpenSettings} type="button">
            打开设置
          </button>
        </article>

        {/* 步骤2：选择测试视频 */}
        <article className={selectedFilesCount > 0 ? 'guide-step ready' : 'guide-step warning'}>
          <span className="guide-step__number">2</span>
          <div>
            <strong>选择一个较短的测试视频</strong>
            <p className="muted">建议先用 5 到 30 秒的 MP4。拖入文件或点选文件后，这一步就会变成已就绪。</p>
          </div>
          <span className="guide-step__status">{selectedFilesCount > 0 ? '测试视频已加载' : '等待选择文件'}</span>
        </article>

        {/* 步骤3：选择推荐的测试项 */}
        <article className="guide-step neutral">
          <span className="guide-step__number">3</span>
          <div>
            <strong>选择推荐的首个测试项</strong>
            <p className="muted">点击这些快捷按钮，可以直接切换到适合首次测试的表单。</p>
          </div>
          <div className="guide-shortcuts">
            {/* 渲染推荐测试项的快捷按钮 */}
            {recommendedTests.map((test) => (
              <button
                key={test.type}
                className={test.type === currentTaskType ? 'guide-shortcut active' : 'guide-shortcut'}
                onClick={() => onSelectTaskType(test.type)}
                type="button"
              >
                <strong>{test.label}</strong>
                <small>{test.description}</small>
              </button>
            ))}
          </div>
        </article>

        {/* 步骤4：运行任务并观察结果 */}
        <article className={queueCount > 0 ? 'guide-step ready' : 'guide-step neutral'}>
          <span className="guide-step__number">4</span>
          <div>
            <strong>运行任务并观察结果</strong>
            <p className="muted">在下方点击“加入队列”，然后观察状态从“排队中”变为“进行中”再到“成功”。如果想看细节，可以打开日志。</p>
          </div>
          <button className="secondary-button" onClick={onOpenLogs} type="button">
            打开日志
          </button>
        </article>
      </div>
    </section>
  );
}
