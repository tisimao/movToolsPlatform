import type { EnvironmentStatus } from '../types/ipc';

/**
 * 环境状态卡片组件属性
 */
interface EnvironmentStatusCardProps {
  /** 是否正在加载 */
  isLoading: boolean;
  /** 关闭引导的回调函数（可选） */
  onDismissGuide?: () => void;
  /** 打开使用手册的回调函数（可选） */
  onOpenUsageManual?: () => Promise<void>;
  /** 打开设置的回调函数（可选） */
  onOpenSettings?: () => void;
  /** 刷新状态的回调函数 */
  onRefresh: () => Promise<void>;
  /** 是否显示首次启动引导（可选，默认false） */
  showFirstLaunchGuide?: boolean;
  /** 环境状态数据（可为null） */
  status: EnvironmentStatus | null;
}

/**
 * 环境状态卡片组件
 * 用于显示FFmpeg、FFprobe和输出目录的环境检查状态
 * @param props 组件属性
 * @returns JSX元素
 */
export function EnvironmentStatusCard({ isLoading, onDismissGuide, onOpenSettings, onOpenUsageManual, onRefresh, showFirstLaunchGuide = false, status }: EnvironmentStatusCardProps) {
  /** 检查环境是否就绪 */
  const isReady = status?.isReady ?? false;

  return (
    <section className={isReady ? 'environment-card is-ready' : 'environment-card is-blocked'}>
      <div className="environment-card__header">
        <div>
          <p className="eyebrow">环境检查</p>
          <h3>{isReady ? '运行环境已基本就绪' : '首次启动还需要完成环境自检'}</h3>
          <p className="muted environment-card__copy">
            {isReady
              ? '当前已经具备在工作台内继续使用制片功能与文件提取流程的基础条件。'
              : '请先修复下面缺失的运行环境项，确保 FFmpeg、FFprobe 与输出目录可在这台机器上正常使用。'}
          </p>
        </div>

        <span className={isReady ? 'environment-pill ready' : 'environment-pill blocked'}>{isReady ? '已就绪' : '待设置'}</span>
      </div>

      <div className="environment-grid">
        {/* FFmpeg状态检查 */}
        <article className={status?.ffmpeg.available ? 'environment-check ready' : 'environment-check blocked'}>
          <span className="environment-check__label">FFmpeg</span>
          <strong>{status?.ffmpeg.available ? '已检测到' : '缺失或无效'}</strong>
          <p className="muted file-name">路径：{status?.ffmpeg.path ?? '检查中...'}</p>
          {status?.ffmpeg.error ? <p className="error-copy">{status.ffmpeg.error}</p> : null}
        </article>

        {/* FFprobe状态检查 */}
        <article className={status?.ffprobe.available ? 'environment-check ready' : 'environment-check blocked'}>
          <span className="environment-check__label">FFprobe</span>
          <strong>{status?.ffprobe.available ? '已检测到' : '缺失或无效'}</strong>
          <p className="muted file-name">路径：{status?.ffprobe.path ?? '检查中...'}</p>
          {status?.ffprobe.error ? <p className="error-copy">{status.ffprobe.error}</p> : null}
        </article>

        {/* 默认输出目录状态检查 */}
        <article className={status?.hasDefaultOutputDir ? (status.defaultOutputDirWritable ? 'environment-check ready' : 'environment-check blocked') : 'environment-check warning'}>
          <span className="environment-check__label">默认输出目录</span>
          <strong>{status?.hasDefaultOutputDir ? (status.defaultOutputDirWritable ? '已配置且可写' : '已配置但当前不可写') : '可选，但建议配置'}</strong>
          <p className="muted file-name">{status?.defaultOutputDir || '暂未设置。'}</p>
          {status?.defaultOutputDirError ? <p className="error-copy">{status.defaultOutputDirError}</p> : null}
        </article>
      </div>

      {/* 首次启动引导 */}
      {showFirstLaunchGuide ? (
        <div className="environment-callout warning">
          <strong>首次安装建议</strong>
          <p className="muted environment-card__copy">建议先完成一次环境刷新，并打开《安装使用说明》确认项目目录与默认输出目录的推荐配置。</p>
          <div className="actions-row wrap-actions">
            {onOpenUsageManual ? <button className="secondary-button" onClick={() => void onOpenUsageManual()} type="button">打开安装说明</button> : null}
            {onDismissGuide ? <button className="secondary-button" onClick={onDismissGuide} type="button">知道了，不再提示</button> : null}
          </div>
        </div>
      ) : null}

      {/* 下一步建议 */}
      {status?.recommendations?.length ? (
        <div className="environment-callout">
          <strong>下一步建议</strong>
          {status.setupMessage ? <p className="muted environment-card__copy">{status.setupMessage}</p> : null}
          <ul className="environment-list">
            {status.recommendations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="environment-callout success">
          <strong>接下来你可以这样使用</strong>
          <p className="muted environment-card__copy">{status?.setupMessage ?? '在下方从已完成镜头池加入镜头，调整拼接顺序，然后点击"开始拼接"。进度和日志会直接在界面里更新。'}</p>
        </div>
      )}

      <div className="actions-row">
        <div className="environment-hint muted">{isLoading ? '正在刷新环境状态...' : '修改设置或安装 FFmpeg / FFprobe 后，可以点击刷新。'}</div>
        <div className="actions-row compact-actions">
          <button className="secondary-button" onClick={() => void onRefresh()} type="button">
            刷新状态
          </button>
          {onOpenSettings ? (
            <button className="primary-button" onClick={onOpenSettings} type="button">
              打开设置
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
