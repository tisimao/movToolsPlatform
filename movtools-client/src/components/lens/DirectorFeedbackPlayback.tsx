import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewFeedback } from '../../types/review';
import { pathsToDataUrl } from '../AnnotationCanvas';
import { collectDirectorFeedbackMaskPaths, selectCurrentDirectorFeedbacks } from '../../lib/directorFeedback';

interface DirectorFeedbackPlaybackProps {
  feedbacks: ReviewFeedback[];
  currentVersionNum?: string | null;
  videoSrc: string | null;
  sourceLabel: string;
  maskEnabled: boolean;
  onMaskEnabledChange: (nextValue: boolean) => void;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DirectorFeedbackPlayback({
  feedbacks,
  currentVersionNum,
  videoSrc,
  sourceLabel,
  maskEnabled,
  onMaskEnabledChange,
}: DirectorFeedbackPlaybackProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const currentRoundFeedbacks = useMemo(() => selectCurrentDirectorFeedbacks(feedbacks, currentVersionNum), [currentVersionNum, feedbacks]);
  const maskPaths = useMemo(() => collectDirectorFeedbackMaskPaths(currentRoundFeedbacks), [currentRoundFeedbacks]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      setStageSize({ width: element.clientWidth, height: element.clientHeight });
    };

    updateSize();

    const ObserverCtor = window.ResizeObserver;
    if (!ObserverCtor) {
      return;
    }

    const observer = new ObserverCtor(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [videoSrc]);

  const maskSrc = useMemo(() => {
    if (!maskEnabled || stageSize.width <= 0 || stageSize.height <= 0 || maskPaths.length === 0) {
      return '';
    }

    return pathsToDataUrl(maskPaths, stageSize.width, stageSize.height);
  }, [maskEnabled, maskPaths, stageSize.height, stageSize.width]);

  return (
    <section className="panel stack-gap lens-director-feedback-playback-card">
      <div className="section-heading lens-version-header">
        <div>
          <h4>反馈回放预览</h4>
          <p className="muted">关闭时播放原视频，开启时仅叠加当前轮正式已提交绘制内容。</p>
        </div>
        <label className="director-feedback-mask-toggle">
          <input checked={maskEnabled} onChange={(event) => onMaskEnabledChange(event.target.checked)} type="checkbox" />
          <span>显示导演反馈遮罩</span>
        </label>
      </div>

      <div className="director-feedback-playback-meta muted">
        <span>当前轮反馈 {currentRoundFeedbacks.length} 条</span>
        <span>遮罩绘制 {maskPaths.length} 段</span>
        <span>{maskEnabled ? '已开启遮罩回放' : '原视频回放中'}</span>
        {sourceLabel ? <span>{sourceLabel}</span> : null}
      </div>

      {videoSrc ? (
        <div className="director-feedback-playback-stage" ref={stageRef}>
          <video className="director-feedback-playback-video" controls preload="metadata" src={videoSrc} />
          {maskEnabled && maskSrc ? <img alt="导演反馈遮罩" className="director-feedback-playback-mask" src={maskSrc} /> : null}
          {maskEnabled && !maskSrc ? <div className="director-feedback-playback-empty muted">当前轮没有可叠加的正式绘制内容。</div> : null}
        </div>
      ) : (
        <div className="director-feedback-playback-empty muted">当前版本没有可回放的视频。</div>
      )}

      {currentRoundFeedbacks.length > 0 ? (
        <div className="director-feedback-playback-summary muted">
          <span>当前轮最近反馈：{formatTime(currentRoundFeedbacks[currentRoundFeedbacks.length - 1].createdAtUtc)}</span>
          <span>反馈编号：{currentRoundFeedbacks[currentRoundFeedbacks.length - 1].feedbackId.slice(0, 8)}</span>
        </div>
      ) : (
        <p className="muted">暂无当前轮导演反馈。</p>
      )}
    </section>
  );
}
