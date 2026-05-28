import { useEffect, useMemo, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { ReviewFeedback, ReviewDrawingFrame } from '../../types/review';
import { pathsToDataUrl } from '../AnnotationCanvas';
import { selectCurrentDirectorFeedbacks } from '../../lib/directorFeedback';
import { resolveReviewVisibleAnnotationPaths } from '../../lib/reviewDrawingResolver';
import { DEFAULT_REVIEW_PLAYBACK_FPS } from '../../lib/reviewPlaybackFps';

const DEFAULT_OVERLAY_WIDTH = 640;
const DEFAULT_OVERLAY_HEIGHT = 360;
const PLAYBACK_FPS = DEFAULT_REVIEW_PLAYBACK_FPS;

interface DirectorFeedbackPlaybackProps {
  feedbacks: ReviewFeedback[];
  drawingTimeline: ReviewDrawingFrame[];
  currentVersionNum?: string | null;
  videoSrc: string | null;
  sourceLabel: string;
  sourceDescription?: string | null;
  seekTarget: { frameNumber: number; requestId: number } | null;
  fps?: number;
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
  drawingTimeline,
  currentVersionNum,
  videoSrc,
  sourceLabel,
  sourceDescription,
  seekTarget,
  fps = PLAYBACK_FPS,
}: DirectorFeedbackPlaybackProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [mediaSize, setMediaSize] = useState({ width: DEFAULT_OVERLAY_WIDTH, height: DEFAULT_OVERLAY_HEIGHT });
  const [currentTime, setCurrentTime] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  const currentRoundFeedbacks = useMemo(() => selectCurrentDirectorFeedbacks(feedbacks, currentVersionNum), [currentVersionNum, feedbacks]);
  const currentFrameNumber = useMemo(() => Math.max(1, Math.floor(currentTime * fps) + 1), [currentTime, fps]);
  const visiblePaths = useMemo(
    () => resolveReviewVisibleAnnotationPaths({ drawingTimeline }, currentFrameNumber, fps),
    [currentFrameNumber, drawingTimeline, fps],
  );

  useEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      setStageSize({ width: element.clientWidth, height: element.clientHeight });
    };

    updateSize();

    if (!window.ResizeObserver) {
      return;
    }

    const observer = new window.ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [videoSrc]);

  const frameSize = useMemo(() => {
    const mediaWidth = mediaSize.width > 0 ? mediaSize.width : DEFAULT_OVERLAY_WIDTH;
    const mediaHeight = mediaSize.height > 0 ? mediaSize.height : DEFAULT_OVERLAY_HEIGHT;
    const aspect = mediaWidth / mediaHeight;

    const availableWidth = stageSize.width > 0 ? stageSize.width : mediaWidth;
    const availableHeight = stageSize.height > 0 ? stageSize.height : mediaHeight;

    let width = availableWidth;
    let height = width / aspect;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * aspect;
    }

    return { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
  }, [mediaSize.height, mediaSize.width, stageSize.height, stageSize.width]);

  const maskSrc = useMemo(() => {
    if (visiblePaths.length === 0) {
      return '';
    }

    return pathsToDataUrl(visiblePaths, DEFAULT_OVERLAY_WIDTH, DEFAULT_OVERLAY_HEIGHT);
  }, [visiblePaths]);

  function applySeekTarget(): void {
    if (!seekTarget || !videoRef.current) {
      return;
    }

    const nextTime = Math.max(0, (seekTarget.frameNumber - 1) / fps);
    try {
      videoRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
    } catch {
      // ignore seek failures until metadata is ready
    }
  }

  function handleLoadedMetadata(event: SyntheticEvent<HTMLVideoElement>): void {
    const video = event.currentTarget;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setMediaSize({ width: video.videoWidth, height: video.videoHeight });
    }
    setCurrentTime(video.currentTime || 0);
    applySeekTarget();
  }

  function handleTimeUpdate(event: SyntheticEvent<HTMLVideoElement>): void {
    setCurrentTime(event.currentTarget.currentTime || 0);
  }

  useEffect(() => {
    applySeekTarget();
  }, [seekTarget?.requestId]);

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExpanded(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  async function handleEnterFullscreen(): Promise<void> {
    const element = stageRef.current;
    if (!element?.requestFullscreen) {
      setIsExpanded(true);
      return;
    }

    try {
      await element.requestFullscreen();
    } catch {
      setIsExpanded(true);
    }
  }

  return (
    <section className={isExpanded ? 'panel stack-gap lens-director-feedback-playback-card is-expanded' : 'panel stack-gap lens-director-feedback-playback-card'}>
      <div className="section-heading lens-version-header">
        <div>
          <h4>反馈回放预览</h4>
          <p className="muted">按当前视频时间逐帧叠加当前轮可见绘制路径。</p>
        </div>
        <div className="actions-row compact-actions wrap-actions director-feedback-playback-actions">
          {isExpanded ? (
            <button className="secondary-button" onClick={() => setIsExpanded(false)} type="button">退出大窗口</button>
          ) : (
            <button className="secondary-button" disabled={!videoSrc} onClick={() => setIsExpanded(true)} type="button">大窗口查看</button>
          )}
          <button className="secondary-button" disabled={!videoSrc} onClick={() => void handleEnterFullscreen()} type="button">全屏播放</button>
        </div>
      </div>

      <div className="director-feedback-playback-meta muted">
        <span>当前时间 {currentTime.toFixed(2)}s</span>
        <span>当前帧 {currentFrameNumber}</span>
        <span>当前轮反馈 {currentRoundFeedbacks.length} 条</span>
        <span>可见路径 {visiblePaths.length} 段</span>
        {sourceLabel ? <span>{sourceLabel}</span> : null}
        {sourceDescription ? <span>{sourceDescription}</span> : null}
      </div>

      {videoSrc ? (
        <div className="director-feedback-playback-stage" ref={stageRef}>
          <div className="director-feedback-playback-frame" style={{ width: frameSize.width, height: frameSize.height }}>
            <video
              ref={videoRef}
              className="director-feedback-playback-video"
              controls
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              preload="metadata"
              src={videoSrc}
            />
            {maskSrc ? <img alt="导演反馈遮罩" className="director-feedback-playback-mask" src={maskSrc} /> : null}
            {!maskSrc ? <div className="director-feedback-playback-empty muted">当前帧没有可见绘制内容。</div> : null}
          </div>
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
