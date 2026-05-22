import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ReviewTask, ReviewComment, ReviewAction, ReviewTaskDetail } from '../types/review';
import type { ReviewFeedback } from '../types/review';
import type { LensDetailPayload } from '../types/lens';
import type { LocalFeedbackDraft } from '../types/localDraft';
import type { PlaybackItem, SwitchReason } from '../types/reviewPlayback';
import type { ReviewLocalShotState } from '../lib/reviewLocalState';
import type { ShotFeedbackView } from '../lib/reviewFrameFeedback';
import { reviewService, lensService } from '../services/repositoryService';
import { pathMappingService } from '../services/repositoryService';
import { useAuthStore } from '../auth/store';
import { useLensStore } from '../stores/lensStore';
import { getInternalReviewStatusLabel } from '../lib/internalReview';
import { collectDirectorFeedbackMaskPaths } from '../lib/directorFeedback';
import { useDirectorNavigationStore } from '../stores/directorNavigationStore';
import { AnnotationCanvas, type AnnotationPath, serializeAnnotationPaths, deserializeAnnotationPaths } from '../components/AnnotationCanvas';
import { FeedbackCardList, buildFeedbackListItemFromDraft, buildFeedbackListItemFromSubmitted, type FeedbackListItem } from '../components/FeedbackCardList';
import { extractPastedImages, addPendingPaths, removeItem, type ImageAttachmentItem, createPendingItemsFromPaths } from '../lib/imageAttachment';
import { resolveImageUrl } from '../lib/imageUrl';
import { createFeedbackRoundId, normalizeFeedbackRoundId } from '../lib/reviewFeedbackRound';
import { clearReviewLocalShotState, createEmptyReviewLocalShotState, loadReviewLocalShotState, saveReviewLocalShotState, upsertClearFrameRecord, upsertFrameDrawingRecord } from '../lib/reviewLocalState';
import { resolveReviewVisibleAnnotationPaths } from '../lib/reviewDrawingResolver';
import {
  buildPlaybackItems,
  buildPlaybackItemsWithLensDetails,
  applyPreloadResult,
  preloadLensDetail,
  preloadRange,
  getLensDetailWithCache,
  clearLensDetailCache,
  getCachedLensDetail,
} from '../lib/reviewPlayback';
import { filterFeedbacksForShot, loadAllFeedbacksForShot } from '../lib/reviewFrameFeedback';

type ReviewStatusFilter = 'all' | 'pending' | 'in-review' | 'approved' | 'rejected';
type FeedbackEditorMode = 'blank' | 'draft' | 'submitted-feedback';
type FeedbackItemPendingAction = 'create' | 'update' | 'delete';

interface ReviewFeedbackListEntry extends FeedbackListItem {
  frameKey: number;
}

const defaultCommentState = {
  content: '',
  timestampInSeconds: 0,
  isTimestampMode: false,
};

interface ReviewPageProps {
  initialTaskId?: string | null;
  onTaskOpened?: () => void;
  onOpenLens?: (lensId?: string) => void;
}

// 将 ISO 时间转换为简洁的中文本地时间显示
function formatTime(isoString: string): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 将秒数格式化为 mm:ss 时间码
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// 将任务状态码映射为界面文案
function getTaskStatusLabel(status: string): string {
  switch (status) {
    case 'pending': return '待审';
    case 'in-review': return '审阅中';
    case 'approved': return '通过';
    case 'rejected': return '返修';
    case 'closed': return '已关闭';
    default: return status;
  }
}

// 根据当前时间和帧率估算帧号
function estimateFrameNumber(currentTime: number, fps: number): number {
  return Math.floor(currentTime * fps) + 1;
}

// 将时间秒数格式化为帧级时间码
function formatFrameTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 24);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

type ReviewQueueState = 'unmatched' | 'pending' | 'processed';

// 判断当前镜头在任务队列中的状态
function getReviewQueueState(item: PlaybackItem): ReviewQueueState {
  if (item.reviewParticipationMode === 'context') return 'processed';
  if (item.internalReviewStatusCode === 'DIRECTOR_APPROVED') return 'processed';
  if ((item.feedbackCount ?? 0) <= 0) return 'unmatched';
  return 'pending';
}

// 获取镜头队列状态的中文标签
function getReviewQueueStateLabel(item: PlaybackItem): string {
  if (item.reviewParticipationMode === 'context') return '上下文';
  const state = getReviewQueueState(item);
  switch (state) {
    case 'processed':
      return '已处理';
    case 'pending':
      return '已匹配待处理';
    default:
      return '未匹配';
  }
}

const PRELOAD_AHEAD_COUNT = 2;
const PRELOAD_THRESHOLD_SECONDS = 5;

// 生成一次反馈会话的唯一标识
function generateFeedbackRoundId(): string {
  return createFeedbackRoundId();
}

export function ReviewPage({ initialTaskId, onTaskOpened, onOpenLens }: ReviewPageProps) {
  const { user } = useAuthStore();
  const { lenses } = useLensStore();
  const { pendingReviewTaskId, clearPendingReviewTaskId } = useDirectorNavigationStore();
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; error?: string }>({ success: true });
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>('all');

  // Task & detail
  const [selectedTask, setSelectedTask] = useState<ReviewTask | null>(null);
  const [taskDetail, setTaskDetail] = useState<ReviewTaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 播放状态：统一管理当前镜头、播放进度和暂停状态
  const [playbackItems, setPlaybackItems] = useState<PlaybackItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [switchReason, setSwitchReason] = useState<SwitchReason>('initial');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  // 视频引用：当前视频、下一个预加载视频，以及拖动跳转的暂存信息
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const nextVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingSeekRef = useRef<{ index: number; time: number } | null>(null);
  const shotDurationMapRef = useRef<Record<string, number>>({});

  // Lens detail cache ref (for current shot's full detail)
  const [currentLensDetail, setCurrentLensDetail] = useState<LensDetailPayload | null>(null);

  // 当前激活镜头：作为反馈、草稿、绘制的展示上下文
  const [activeShotId, setActiveShotId] = useState<string | null>(null);

  // Review feedback cache keyed by shot
  const [shotFeedbackViewByShotId, setShotFeedbackViewByShotId] = useState<Record<string, ShotFeedbackView>>({});

  // Derived
  const currentItem = useMemo(() => playbackItems[currentIndex] ?? null, [playbackItems, currentIndex]);
  const currentShots = useMemo(() => taskDetail?.shots ?? [], [taskDetail]);
  const fps = 24;

  const currentShotFeedbackView = useMemo(() => {
    if (!activeShotId) return null;
    return shotFeedbackViewByShotId[activeShotId] ?? null;
  }, [activeShotId, shotFeedbackViewByShotId]);

  const currentShotTaskShotId = useMemo(() => playbackItems[currentIndex]?.taskShotId ?? null, [currentIndex, playbackItems]);

  // 当前播放版本显示：优先展示实际播放版本，其次是提审版本
  const currentPlaybackVersionLabel = useMemo(() => {
    if (currentItem?.resolvedSourceType === 'layout') {
      return 'Layout';
    }

    return currentItem?.resolvedVersionNum || currentItem?.submitVersionNum || selectedTask?.versionNum || '—';
  }, [currentItem, selectedTask?.versionNum]);

  const currentFrameNumber = useMemo(() => estimateFrameNumber(currentTime, fps), [currentTime]);
  const currentFrameTime = useMemo(() => formatFrameTime(currentTime), [currentTime]);
  const frameStep = useMemo(() => 1 / fps, [fps]);
  const currentShotParticipationMode = useMemo(() => currentItem?.reviewParticipationMode ?? 'review', [currentItem]);
  const isContextShot = currentShotParticipationMode === 'context';

  // Video source for current shot
  const videoSrc = useMemo(() => currentItem?.resolvedVideoSrc ?? currentItem?.videoSrc ?? null, [currentItem]);

  // Preload status for next shot
  // 计算下一镜头索引，用于预加载和自动切换
  const nextShotIndex = useMemo(() => {
    if (currentIndex >= playbackItems.length - 1) return -1;
    return currentIndex + 1;
  }, [currentIndex, playbackItems.length]);

  // 下一镜头数据缓存
  const nextItem = useMemo(() => {
    if (nextShotIndex < 0) return null;
    return playbackItems[nextShotIndex] ?? null;
  }, [nextShotIndex, playbackItems]);

  // Next video src (preloaded)
  const nextVideoSrc = useMemo(() => nextItem?.resolvedVideoSrc ?? nextItem?.videoSrc ?? null, [nextItem]);

  // 标注状态：仅在暂停时允许编辑当前帧标注
  const [annotationPaths, setAnnotationPaths] = useState<AnnotationPath[]>([]);
  const annotationEnabled = isPaused;

  // Draft feedback state
  const [localShotState, setLocalShotState] = useState<ReviewLocalShotState | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<FeedbackEditorMode>('blank');
  const [editorSourceId, setEditorSourceId] = useState<string | null>(null);
  const [draftCommentText, setDraftCommentText] = useState('');
  const [draftImages, setDraftImages] = useState<ImageAttachmentItem[]>([]);

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);

  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const listRequestSeqRef = useRef(0);
  const shotLoadSeqRef = useRef(0);

  // Track if we've already triggered preload for the current position
  const preloadTriggeredRef = useRef<number>(-1);
  const ignoreNextPauseRef = useRef(false);
  const editorIsDirtyRef = useRef(false);
  const editorDirtyFrameNumberRef = useRef<number | null>(null);

  // 当前镜头的二级审片状态
  const currentShotInternalReviewStatus = useMemo(() => {
    return currentItem?.internalReviewStatusCode ?? null;
  }, [currentItem]);

  const drafts = useMemo(() => localShotState?.feedbackDrafts ?? [], [localShotState]);
  const currentDrafts = useMemo(
    () => (isContextShot
      ? []
      : drafts.filter((draft) => {
          const isVisibleStatus = draft.submitStatus === 'unsaved' || draft.submitStatus === 'pending' || draft.submitStatus === 'failed';
          if (!isVisibleStatus) return false;
          if (draft.pendingAction !== 'delete') return true;
          return Boolean(draft.sourceFeedbackId?.trim() || draft.submittedFeedbackId?.trim());
        })),
    [drafts, isContextShot],
  );
  const invalidLocalDrafts = useMemo(() => (isContextShot ? [] : drafts.filter((draft) => draft.pendingAction === 'delete' && !draft.sourceFeedbackId?.trim() && !draft.submittedFeedbackId?.trim())), [drafts, isContextShot]);
  const submittableCurrentDrafts = useMemo(
    () => currentDrafts.filter((draft) => isDraftSubmittable(draft)),
    [currentDrafts],
  );

  // Fall back to lens store if needed
  // 从镜头库中补充当前镜头详情
  const selectedLens = useMemo(() => {
    const targetLensId = activeShotId ?? selectedTask?.lensId;
    return targetLensId ? lenses.find((lens) => lens.lensId === targetLensId) ?? null : null;
  }, [activeShotId, lenses, selectedTask]);

  const activeLensDetail = currentLensDetail?.lens ?? selectedLens;

  // 优先使用当前镜头状态，缺失时回退到镜头库状态
  const effectiveInternalReviewStatus = useMemo(() => {
    return currentShotInternalReviewStatus ?? activeLensDetail?.internalReviewStatusCode ?? null;
  }, [currentShotInternalReviewStatus, activeLensDetail?.internalReviewStatusCode]);

  const hasPendingDrawingChanges = useMemo(
    () => Boolean(localShotState && (localShotState.frameDrawingRecords.length > 0 || localShotState.clearFrameRecords.length > 0)),
    [localShotState],
  );

  const pendingDraftsCount = useMemo(() => submittableCurrentDrafts.length, [submittableCurrentDrafts]);

  const reviewFeedbacks = useMemo(
    () => (isContextShot
      ? []
      : filterFeedbacksForShot(currentShotFeedbackView?.feedbacks ?? [], {
        shotId: activeShotId,
        taskShotId: currentShotTaskShotId,
        reviewTaskId: selectedTask?.taskId ?? null,
      })),
    [activeShotId, currentShotFeedbackView?.feedbacks, currentShotTaskShotId, isContextShot, selectedTask?.taskId],
  );

  const canApproveCurrentShot = useMemo(
    () => Boolean(activeShotId)
      && currentShotFeedbackView?.shotId === activeShotId
      && !isContextShot
      && currentDrafts.length === 0
      && reviewFeedbacks.length === 0
      && !hasPendingDrawingChanges
      && !detailLoading,
    [activeShotId, currentDrafts.length, currentShotFeedbackView?.shotId, detailLoading, hasPendingDrawingChanges, isContextShot, reviewFeedbacks.length],
  );

  const approveDisabledReason = useMemo(() => {
    if (!activeShotId) return '当前镜头未就绪';
    if (currentShotFeedbackView?.shotId !== activeShotId) return '当前镜头反馈未加载完成';
    if (isContextShot) return '上下文陪审镜头不参与正式审片结论';
    if (hasPendingDrawingChanges) return '存在待提交绘制修改时不可通过';
    if (reviewFeedbacks.length > 0 && currentDrafts.length > 0) return '存在待提交修改和反馈记录时不可通过';
    if (reviewFeedbacks.length > 0) return '存在反馈记录时不可通过';
    if (currentDrafts.length > 0) return '存在待提交反馈时不可通过';
    return undefined;
  }, [activeShotId, currentDrafts.length, currentShotFeedbackView?.shotId, hasPendingDrawingChanges, isContextShot, reviewFeedbacks.length]);

  const activeDraft = useMemo(
    () => drafts.find((d) => d.draftId === activeDraftId) ?? null,
    [drafts, activeDraftId],
  );

  const currentFrameFeedbacks = useMemo(
    () => reviewFeedbacks.filter((feedback) => (feedback.frameNumber ?? null) === currentFrameNumber),
    [currentFrameNumber, reviewFeedbacks],
  );

  const currentFrameSubmittedFeedback = useMemo(
    () => currentFrameFeedbacks[currentFrameFeedbacks.length - 1] ?? null,
    [currentFrameFeedbacks],
  );

  const activeSubmittedFeedback = useMemo(() => {
    if (editorMode !== 'submitted-feedback' || !editorSourceId || !activeShotId) return null;
    return reviewFeedbacks.find((feedback) => feedback.feedbackId === editorSourceId) ?? null;
  }, [activeShotId, editorMode, editorSourceId, reviewFeedbacks]);

  const editorSubmittedFeedback = useMemo(() => {
    if (editorMode === 'submitted-feedback') {
      return activeSubmittedFeedback ?? currentFrameSubmittedFeedback;
    }

    return currentFrameSubmittedFeedback;
  }, [activeSubmittedFeedback, currentFrameSubmittedFeedback, editorMode]);

  const currentFramePlaybackAnnotationPaths = useMemo(() => resolveReviewVisibleAnnotationPaths(
    {
      drawingFrames: currentShotFeedbackView?.latestRoundDrawingFrames ?? editorSubmittedFeedback?.drawingFrames ?? null,
      frameDrawingRecords: localShotState?.frameDrawingRecords ?? null,
      clearFrameRecords: localShotState?.clearFrameRecords ?? null,
    },
    currentFrameNumber,
  ), [currentFrameNumber, currentShotFeedbackView?.latestRoundDrawingFrames, editorSubmittedFeedback?.drawingFrames, localShotState?.clearFrameRecords, localShotState?.frameDrawingRecords]);

  const feedbackListEntries = useMemo<ReviewFeedbackListEntry[]>(() => {
    try {
      if (!activeShotId) {
        return [];
      }

      const draftByFrame = new Map<number, ReviewFeedbackListEntry>();
      for (const draft of currentDrafts) {
        if (draft.pendingAction === 'update') {
          continue;
        }

        draftByFrame.set(draft.frameNumber, {
          ...buildFeedbackListItemFromDraft(draft),
          frameKey: draft.frameNumber,
        });
      }

      const entries: ReviewFeedbackListEntry[] = [];
      for (const feedback of reviewFeedbacks) {
        const frameKey = typeof feedback.frameNumber === 'number' && Number.isFinite(feedback.frameNumber)
          ? feedback.frameNumber
          : -1;
        const draftEntry = draftByFrame.get(frameKey);
        if (draftEntry) {
          entries.push(draftEntry);
          draftByFrame.delete(frameKey);
          continue;
        }

        entries.push({
          ...buildFeedbackListItemFromSubmitted(feedback),
          frameKey,
        });
      }

      for (const draftEntry of draftByFrame.values()) {
        entries.push(draftEntry);
      }

      return entries.sort((left, right) => left.frameKey - right.frameKey || new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime());
    } catch {
      return [];
    }
  }, [activeShotId, currentDrafts, reviewFeedbacks]);

  const activeFeedbackListItemId = useMemo(() => {
    if (editorMode === 'draft' && activeDraftId) return activeDraftId;
    if (editorMode === 'submitted-feedback' && editorSourceId) return editorSourceId;
    return null;
  }, [activeDraftId, editorMode, editorSourceId]);

  // 按状态筛选后的任务列表
  const filteredTasks = useMemo(() => {
    if (statusFilter === 'all') return tasks;
    return tasks.filter((task) => task.status === statusFilter);
  }, [tasks, statusFilter]);

  const stats = useMemo(() => ({
    total: tasks.filter((task) => task.status !== 'completed' && task.status !== 'closed').length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    inReview: tasks.filter((t) => t.status === 'in-review').length,
    approved: tasks.filter((t) => t.status === 'approved').length,
    rejected: tasks.filter((t) => t.status === 'rejected').length,
  }), [tasks]);

  const playbackSourceStats = useMemo(() => ({
    version: playbackItems.filter((item) => item.resolvedSourceType === 'submitted-version' || item.resolvedSourceType === 'fallback-version').length,
    layout: playbackItems.filter((item) => item.resolvedSourceType === 'layout').length,
    none: playbackItems.filter((item) => item.resolvedSourceType === 'none').length,
  }), [playbackItems]);

  const reviewPlaybackItems = useMemo(
    () => playbackItems.filter((item) => item.reviewParticipationMode !== 'context'),
    [playbackItems],
  );

  const reviewTaskStats = useMemo(() => ({
    total: reviewPlaybackItems.length,
    feedback: reviewPlaybackItems.filter((item) => (item.feedbackCount ?? 0) > 0).length,
    approved: reviewPlaybackItems.filter((item) => item.internalReviewStatusCode === 'DIRECTOR_APPROVED').length,
    pending: reviewPlaybackItems.filter((item) => item.internalReviewStatusCode === 'PENDING_FEEDBACK_FIX').length,
  }), [reviewPlaybackItems]);

  // 持久化当前镜头的本地草稿状态
  // 持久化当前镜头的本地草稿状态
  function persistLocalShotState(nextState: ReviewLocalShotState): void {
    setLocalShotState(nextState);
    saveReviewLocalShotState(nextState);
  }

  function applyEditorSnapshot(mode: FeedbackEditorMode, sourceId: string | null, text: string): void {
    setEditorMode(mode);
    setEditorSourceId(sourceId);
    setDraftCommentText(text);
    editorIsDirtyRef.current = false;
    editorDirtyFrameNumberRef.current = null;
  }

  // === Core: unified shot switch ===
  // 切换镜头：统一处理切镜、清理当前状态、加载新镜头详情和反馈
  const switchToShot = useCallback(async (index: number, reason: SwitchReason) => {
    if (index < 0 || index >= playbackItems.length || !selectedTask) return;
    if (index === currentIndex && reason !== 'initial') return;

    const requestSeq = ++shotLoadSeqRef.current;
    const targetShot = playbackItems[index];
    const targetShotId = targetShot?.shotId ?? null;
    setActiveShotId(targetShotId);

    // Clean up previous shot's annotation/draft state
    setCurrentLensDetail(null);
    setAnnotationPaths([]);
    setActiveDraftId(null);
    setDraftCommentText('');
    setDraftImages([]);
    setLocalShotState(null);

    // Stop current playback (keep playing for auto-next)
    if (reason !== 'auto-next') {
      setIsPlaying(false);
      setIsPaused(false);
    } else {
      ignoreNextPauseRef.current = true;
    }
    setCurrentTime(0);
    setDuration(0);

    // Update index and reason
    setCurrentIndex(index);
    setSwitchReason(reason);

    // Load lens detail for new shot
    setCurrentLensDetail(null);
    setDetailLoading(true);

    const shot = targetShot;
    if (!shot) {
      setDetailLoading(false);
      return;
    }

    // Parallel: load lens detail + full shot feedbacks
    try {
      const [lensDetail, feedbackView] = await Promise.all([
        getLensDetailWithCache(shot.shotId),
        loadAllFeedbacksForShot(shot.shotId, { shotId: shot.shotId, taskShotId: shot.taskShotId, reviewTaskId: selectedTask?.taskId ?? taskDetail?.taskId ?? null }),
      ]);

      if (shotLoadSeqRef.current !== requestSeq || shot.shotId !== targetShotId) {
        return;
      }

      if (lensDetail) {
        setCurrentLensDetail(lensDetail);
      }
      setShotFeedbackViewByShotId((prev) => ({ ...prev, [feedbackView.shotId]: feedbackView }));
    } finally {
      setDetailLoading(false);
    }

    // If the video source for this item isn't resolved yet,
    // do a synchronous preload now
    if (!shot.resolvedVideoSrc && !shot.videoSrc && shot.preloadStatus === 'idle') {
      const { videoSrc, lensDetail } = await preloadLensDetail(shot.shotId);
      if (shotLoadSeqRef.current !== requestSeq || shot.shotId !== targetShotId) {
        setDetailLoading(false);
        return;
      }
      setPlaybackItems(prev => prev.map((item, i) =>
        i === index
          ? applyPreloadResult(item, videoSrc, lensDetail)
          : item
      ));
      if (lensDetail && !currentLensDetail) {
        setCurrentLensDetail(lensDetail);
      }
    }

    // Start preloading upcoming shots
    preloadTriggeredRef.current = index;
    void preloadRange(playbackItems, index + 1, PRELOAD_AHEAD_COUNT).then(updated => {
      if (shotLoadSeqRef.current !== requestSeq || shot.shotId !== targetShotId) {
        return;
      }
      setPlaybackItems(prev => {
        let changed = false;
        const merged = prev.map((item, i) => {
          const updatedItem = updated[i];
          if (updatedItem && (updatedItem.preloadStatus !== item.preloadStatus || updatedItem.resolvedVideoSrc !== item.resolvedVideoSrc)) {
            changed = true;
            return updatedItem;
          }
          return item;
        });
        return changed ? merged : prev;
      });
    });
  }, [playbackItems, selectedTask, currentIndex]);

  // 视频源变化后同步播放/暂停状态
  // 视频源变化后同步播放/暂停状态，避免 UI 和播放器不同步
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;
    if (isPlaying && video.paused) {
      void video.play();
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying, videoSrc]);

  // 任务详情刷新后重新对齐当前镜头和反馈数据
  // 任务详情刷新后，重新对齐当前播放列表和当前镜头
  useEffect(() => {
    if (!selectedTask || !taskDetail) return;

    let cancelled = false;
    const currentShotId = activeShotId ?? currentItem?.shotId ?? null;

    void (async () => {
      clearLensDetailCache();
      const detailResponse = await reviewService.getTaskDetail(selectedTask.taskId);
      if (cancelled || !detailResponse.success || !detailResponse.detail) {
        return;
      }

      const refreshedDetail = detailResponse.detail;
      const refreshedItems = buildPlaybackItems(refreshedDetail);
      const mergedItems = refreshedItems.map((item) => {
        const existing = playbackItems.find((prevItem) => prevItem.shotId === item.shotId);
        return existing
          ? {
              ...item,
              videoSrc: existing.videoSrc,
              resolvedVideoSrc: existing.resolvedVideoSrc,
              resolvedSourceType: existing.resolvedSourceType,
              resolvedVersionNum: existing.resolvedVersionNum,
              sourceLabel: existing.sourceLabel,
              sourceDescription: existing.sourceDescription,
              isPlayable: existing.isPlayable,
              hasPlayableMedia: existing.hasPlayableMedia,
              preloadStatus: existing.preloadStatus,
              playabilityStatus: existing.playabilityStatus,
            }
          : item;
      });
      const nextIndex = currentShotId
        ? mergedItems.findIndex((item) => item.shotId === currentShotId)
        : -1;

      setTaskDetail(refreshedDetail);
      setPlaybackItems(mergedItems);
      if (nextIndex >= 0) {
        setCurrentIndex(nextIndex);
      }

      if (currentShotId) {
        const [lensDetail, feedbackView] = await Promise.all([
          getLensDetailWithCache(currentShotId),
          loadAllFeedbacksForShot(currentShotId, {
            shotId: currentShotId,
            taskShotId: playbackItems.find((item) => item.shotId === currentShotId)?.taskShotId ?? null,
            reviewTaskId: selectedTask.taskId,
          }),
        ]);

        if (!cancelled) {
          if (lensDetail) {
            setCurrentLensDetail(lensDetail);
          }
          setShotFeedbackViewByShotId((prev) => ({ ...prev, [feedbackView.shotId]: feedbackView }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lenses, selectedTask?.taskId]);

  // 接近视频尾部时提前预加载下一镜头
  // 接近视频尾部时，提前预加载下一镜头，减少切换等待
  useEffect(() => {
    if (nextShotIndex < 0) return;
    if (nextItem?.preloadStatus !== 'idle') return;
    if (!duration || duration <= 0) return;

    if (duration - currentTime <= PRELOAD_THRESHOLD_SECONDS) {
      const idx = nextShotIndex;
      if (idx === preloadTriggeredRef.current) return;
      preloadTriggeredRef.current = idx;

      void preloadRange(playbackItems, idx, 1).then(updated => {
        setPlaybackItems(prev => {
          let changed = false;
          const merged = prev.map((item, i) => {
            const updatedItem = updated[i];
            if (updatedItem && (updatedItem.preloadStatus !== item.preloadStatus || updatedItem.videoSrc !== item.videoSrc)) {
              changed = true;
              return updatedItem;
            }
            return item;
          });
          return changed ? merged : prev;
        });
      });
    }
  }, [currentTime, duration, nextShotIndex, nextItem, playbackItems]);

  // 仅在切换镜头时恢复本地草稿状态，避免跳帧覆盖编辑器输入
  useEffect(() => {
    if (!selectedTask || !activeShotId) {
      setLocalShotState(null);
      setAnnotationPaths([]);
      return;
    }

    const loaded = loadReviewLocalShotState(selectedTask.taskId, activeShotId);
    setLocalShotState(loaded);
    setActiveDraftId((prev) => (loaded.feedbackDrafts.some((draft) => draft.draftId === prev) ? prev : null));
    if (!editorIsDirtyRef.current) {
      applyEditorSnapshot('blank', null, '');
      setDraftImages([]);
    }
  }, [activeShotId, selectedTask?.taskId]);

  useEffect(() => {
    if (!selectedTask || !activeShotId) return;

    const savedFrameDraft = getDraftByFrame(currentFrameNumber);
    const sourceDraft = activeDraft && activeDraft.frameNumber === currentFrameNumber ? activeDraft : savedFrameDraft;

    if (sourceDraft) {
      setAnnotationPaths(deserializeAnnotationPaths(sourceDraft.annotationDataJson));
      return;
    }

    setAnnotationPaths(currentFramePlaybackAnnotationPaths);
  }, [activeDraft, activeShotId, currentFrameNumber, currentFramePlaybackAnnotationPaths, localShotState, selectedTask]);

  useEffect(() => {
    if (!selectedTask || !activeShotId) return;
    if (editorIsDirtyRef.current) return;

    const savedFrameDraft = getDraftByFrame(currentFrameNumber);
    const sourceDraft = activeDraft && activeDraft.frameNumber === currentFrameNumber ? activeDraft : savedFrameDraft;

    if (sourceDraft) {
      applyEditorSnapshot('draft', sourceDraft.draftId, sourceDraft.commentText);
      return;
    }

    if (editorSubmittedFeedback) {
      applyEditorSnapshot('submitted-feedback', editorSubmittedFeedback.feedbackId, editorSubmittedFeedback.commentText || '');
      return;
    }

    applyEditorSnapshot('blank', null, '');
  }, [activeDraft, activeShotId, currentFrameNumber, drafts, editorSubmittedFeedback, selectedTask]);

  // 视频播放结束后自动切换到下一镜头
  const handleVideoEnded = useCallback(() => {
    if (currentIndex < playbackItems.length - 1) {
      void switchToShot(currentIndex + 1, 'auto-next');
    } else {
      setIsPlaying(false);
      setIsPaused(true);
    }
  }, [currentIndex, playbackItems.length, switchToShot]);

  // 全局键盘快捷键监听
  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [currentIndex, isPaused, isPlaying, playbackItems.length, frameStep]);

  // 进入镜头后，应用待处理的跳转定位
  useEffect(() => {
    if (!videoSrc) return;
    const video = videoRef.current;
    if (video && pendingSeekRef.current && pendingSeekRef.current.index === currentIndex) {
      const targetTime = pendingSeekRef.current.time;
      const applySeek = () => {
        const safeTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : targetTime, targetTime));
        video.currentTime = safeTime;
        setCurrentTime(safeTime);
        pendingSeekRef.current = null;
      };
      if (video.readyState >= 1) {
        applySeek();
      }
    }
  }, [currentIndex, videoSrc]);

  // 暂停且未播放时，再次应用待处理跳转
  useEffect(() => {
    if (!videoSrc) return;
    if (!isPaused || isPlaying) return;
    const pendingSeek = pendingSeekRef.current;
    if (!pendingSeek || pendingSeek.index !== currentIndex) return;

    const video = videoRef.current;
    if (!video) return;

    const targetTime = pendingSeek.time;
    const safeTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : targetTime, targetTime));
    if (video.readyState >= 1) {
      video.currentTime = safeTime;
      setCurrentTime(safeTime);
      pendingSeekRef.current = null;
    }
  }, [currentIndex, isPaused, isPlaying, videoSrc]);

  // === Load tasks ===
  // 拉取审片任务列表，支持状态筛选与错误提示
  async function loadTasks(): Promise<ReviewTask[] | void> {
    const requestSeq = listRequestSeqRef.current + 1;
    listRequestSeqRef.current = requestSeq;
    setLoading(true);
    try {
      const response = await reviewService.listReviewTasks({
        status: statusFilter === 'all' ? undefined : statusFilter as 'pending' | 'in-review' | 'approved' | 'rejected',
      });
      if (requestSeq !== listRequestSeqRef.current) return;
      if (response.success) {
        setTasks(response.tasks);
        return response.tasks;
      } else {
        const errorMsg = response.error || '';
        if (errorMsg.includes('404') || errorMsg.includes('not found')) {
          setResult({ success: false, error: '审片功能不可用：服务端接口返回错误。' });
        } else {
          setResult({ success: false, error: response.error });
        }
      }
    } catch (error) {
      if (requestSeq === listRequestSeqRef.current) {
        setResult({ success: false, error: '审片功能不可用：无法连接服务端。' });
      }
    } finally {
      if (requestSeq === listRequestSeqRef.current) setLoading(false);
    }
  }

  // === Load task with shots (enters task) ===
  // 加载任务详情、镜头列表和首镜数据
  async function loadTaskWithShots(task: ReviewTask): Promise<void> {
    setDetailLoading(true);

    try {
      const detailResponse = await reviewService.getTaskDetail(task.taskId);
      if (!detailResponse.success || !detailResponse.detail) {
        setResult({ success: false, error: detailResponse.error || '获取任务详情失败' });
        return;
      }
      setTaskDetail(detailResponse.detail);
      setSelectedTask(task);
      setShotFeedbackViewByShotId({});
      setActiveShotId(null);
      setCurrentIndex(0);
      setPlaybackItems([]);
      setCurrentLensDetail(null);
      setIsPlaying(false);
      setIsPaused(false);
      setCurrentTime(0);
      setDuration(0);
      setAnnotationPaths([]);
      setActiveDraftId(null);

      // Build playback items from task detail shots
      const items = await buildPlaybackItemsWithLensDetails(detailResponse.detail);
      setPlaybackItems(items);

      // Preload initial range (current + next few)
      const preloaded = await preloadRange(items, 0, PRELOAD_AHEAD_COUNT + 1);
      setPlaybackItems(preloaded);

      // Set current index to 0 and load first shot's detail
      setSwitchReason('initial');
      const firstShot = preloaded[0];
      if (firstShot) {
        setActiveShotId(firstShot.shotId);
        const [lensDetail, feedbackView] = await Promise.all([
          getLensDetailWithCache(firstShot.shotId),
          loadAllFeedbacksForShot(firstShot.shotId, { shotId: firstShot.shotId, taskShotId: firstShot.taskShotId, reviewTaskId: task.taskId }),
        ]);
        if (lensDetail) {
          setCurrentLensDetail(lensDetail);
        }
        setShotFeedbackViewByShotId((prev) => ({ ...prev, [feedbackView.shotId]: feedbackView }));
      }

      setIsPaused(false);
      setIsPlaying(true);
    } catch (error) {
      setResult({ success: false, error: error instanceof Error ? error.message : '进入审片失败' });
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedTask) return;
    if (!playbackItems.length) return;

    const taskHasContextShot = playbackItems.some((item) => item.reviewParticipationMode === 'context');
    if (!taskHasContextShot) return;

    const taskId = selectedTask.taskId;
    for (const item of playbackItems) {
      if (item.reviewParticipationMode === 'context') {
        void clearReviewLocalShotState(taskId, item.shotId);
      }
    }
  }, [playbackItems, selectedTask]);

  // 刷新当前镜头的镜头详情
  async function loadSelectedLensDetail(lensId: string | null | undefined): Promise<void> {
    if (!lensId) {
      setCurrentLensDetail(null);
      return;
    }
    const detail = await getLensDetailWithCache(lensId);
    if (detail) {
      setCurrentLensDetail(detail);
    } else {
      const response = await lensService.getLensDetail(lensId);
      setCurrentLensDetail(response.success ? response.detail ?? null : null);
    }
  }

  // 任务未开始时先切换为审阅中
  async function ensureTaskStarted(task: ReviewTask): Promise<ReviewTask> {
    if (task.status !== 'pending') return task;

    const response = await reviewService.startTask(task.taskId);
    if (response.success) {
      const startedTask = { ...task, status: 'in-review' as const };
      setTasks((current) => current.map((item) => (item.taskId === task.taskId ? startedTask : item)));
      setSelectedTask(startedTask);
      return startedTask;
    }
    return task;
  }

  // === Initial load ===
  useEffect(() => {
    void (async () => {
      const nextTasks = await loadTasks();
      const targetTaskId = initialTaskId ?? pendingReviewTaskId;
      if (!targetTaskId || !Array.isArray(nextTasks)) return;
      const targetTask = nextTasks.find((task) => task.taskId === targetTaskId);
      if (targetTask) {
        const openedTask = await ensureTaskStarted(targetTask);
        await loadTaskWithShots(openedTask);
        clearPendingReviewTaskId();
        onTaskOpened?.();
      }
    })();
  }, [statusFilter, initialTaskId, pendingReviewTaskId]);

  // === Playback controls ===
  // 播放/暂停切换
  // 切换播放与暂停
  function togglePlayPause() {
    if (isPlaying) {
      setIsPlaying(false);
      setIsPaused(true);
    } else {
      setIsPaused(false);
      setIsPlaying(true);
    }
  }

  // 播放开始时，清空当前帧临时标注，避免误写到播放态
  // 播放开始：进入播放态并清除临时标注
  function handlePlay() {
    setIsPlaying(true);
    setIsPaused(false);
    setAnnotationPaths(currentFramePlaybackAnnotationPaths);
  }

  // 暂停时进入可绘制状态；如果已经到达视频末尾则不重复处理
  // 暂停播放：进入可绘制状态
  function handlePause() {
    const video = videoRef.current;
    if (video && (video.ended || (video.duration > 0 && video.currentTime >= video.duration - 0.05))) {
      return;
    }
    if (ignoreNextPauseRef.current) {
      ignoreNextPauseRef.current = false;
      return;
    }
    setIsPlaying(false);
    setIsPaused(true);
  }

  // 实时更新当前播放时间，驱动帧号与进度条显示
  function handleTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    setCurrentTime(e.currentTarget.currentTime);
  }

  // 记录视频时长，供进度、跳帧和跨镜头切换使用
  // 记录当前视频时长
  function handleDurationChange(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    const shotId = currentItem?.shotId;
    setDuration(video.duration);
    if (shotId) {
      shotDurationMapRef.current[shotId] = video.duration;
    }
  }

  // 元数据加载完成后，应用待执行的跳转位置
  // 元数据加载完成后应用待跳转时间
  function handleLoadedMetadata(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    const shotId = currentItem?.shotId;
    setDuration(video.duration);
    if (shotId) {
      shotDurationMapRef.current[shotId] = video.duration;
    }

    const pendingSeek = pendingSeekRef.current;
    if (pendingSeek && pendingSeek.index === currentIndex) {
      const targetTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : pendingSeek.time, pendingSeek.time));
      video.currentTime = targetTime;
      setCurrentTime(targetTime);
      pendingSeekRef.current = null;
    }
  }

  // 在当前镜头内精确跳转到指定时间
  // 跳转当前视频到指定时间
  function seekCurrentVideo(time: number): void {
    const video = videoRef.current;
    if (!video) return;
    const safeTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : time, time));
    video.currentTime = safeTime;
    setCurrentTime(safeTime);
  }

  // 逐帧前进/后退；必要时会跨镜头跳转
  // 按帧前后移动，必要时跨镜头
  function handleStepFrame(direction: 'forward' | 'backward') {
    const video = videoRef.current;
    if (!video) return;
    if (!isPaused) return;

    const step = frameStep;
    const isFirstFrame = video.currentTime <= step * 0.5;
    const isLastFrame = Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= Math.max(0, video.duration - step * 0.5);

    if (direction === 'backward') {
      if (isFirstFrame && currentIndex > 0) {
        const prevShotId = playbackItems[currentIndex - 1]?.shotId;
        const prevDuration = prevShotId ? (shotDurationMapRef.current[prevShotId] ?? 0) : 0;
        pendingSeekRef.current = { index: currentIndex - 1, time: Math.max(0, prevDuration > 0 ? prevDuration - step : 0) };
        void switchToShot(currentIndex - 1, 'user-prev');
        setIsPlaying(false);
        setIsPaused(true);
        return;
      }

      const nextTime = Math.max(0, video.currentTime - step);
      video.currentTime = nextTime;
      setCurrentTime(nextTime);
      return;
    }

    const crossesToNextShot = isLastFrame && currentIndex < playbackItems.length - 1;
    if (crossesToNextShot) {
      pendingSeekRef.current = { index: currentIndex + 1, time: 0 };
      void switchToShot(currentIndex + 1, 'user-next');
      setIsPlaying(false);
      setIsPaused(true);
      return;
    }

    const nextTime = Number.isFinite(video.duration) ? Math.min(video.duration, video.currentTime + step) : video.currentTime + step;
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  // 处理边界跳转：首页、尾页、前后镜头
  function handleBoundarySeek(target: 'prev-shot' | 'next-shot' | 'home' | 'end'): void {
    const video = videoRef.current;
    if (!video) return;

    if (target === 'home') {
      seekCurrentVideo(0);
      return;
    }

    if (target === 'end') {
      const endTime = Number.isFinite(video.duration) ? Math.max(0, video.duration - frameStep) : 0;
      seekCurrentVideo(endTime);
      return;
    }

    if (target === 'prev-shot') {
      if (currentIndex <= 0) return;
      const prevShotId = playbackItems[currentIndex - 1]?.shotId;
      const prevDuration = prevShotId ? (shotDurationMapRef.current[prevShotId] ?? 0) : 0;
      pendingSeekRef.current = { index: currentIndex - 1, time: Math.max(0, prevDuration > 0 ? prevDuration - frameStep : 0) };
      void switchToShot(currentIndex - 1, 'user-prev');
      setIsPlaying(false);
      setIsPaused(true);
      return;
    }

    if (currentIndex >= playbackItems.length - 1) return;
    pendingSeekRef.current = { index: currentIndex + 1, time: 0 };
    void switchToShot(currentIndex + 1, 'user-next');
    setIsPlaying(false);
    setIsPaused(true);
  }

  // 判断事件目标是否属于输入类控件
  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  // 监听键盘快捷键
  function handleKeyboardShortcuts(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
      return;
    }

    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey) {
        handleBoundarySeek('prev-shot');
      } else {
        void handleStepFrame('backward');
      }
      return;
    }

    if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey) {
        handleBoundarySeek('next-shot');
      } else {
        void handleStepFrame('forward');
      }
      return;
    }

    if (e.code === 'Home') {
      e.preventDefault();
      handleBoundarySeek('home');
      return;
    }

    if (e.code === 'End') {
      e.preventDefault();
      handleBoundarySeek('end');
    }
  }

  // 进入任务：确保任务已启动后再加载镜头列表和播放器内容
  // 进入某个审片任务
  async function handleEnterTask(task: ReviewTask): Promise<void> {
    setSelectedTask(task);
    const openedTask = await ensureTaskStarted(task);
    await loadTaskWithShots(openedTask);
  }

  async function handleSelectContextTask(task: ReviewTask): Promise<void> {
    setSelectedTask(task);
    const openedTask = await ensureTaskStarted(task);
    await loadTaskWithShots(openedTask);
  }

  // 打开外部预览：把镜头路径解析成本地地址并提示用户
  // 打开系统预览路径
  async function handleOpenPreview(task: ReviewTask): Promise<void> {
    const logicalPath = task.episodeCode
      ? `/${task.episodeCode}/${task.lensCode}/output/${task.lensCode}_v${task.versionNum}.mov`
      : `/${task.lensCode}/output/${task.lensCode}_v${task.versionNum}.mov`;
    const resolveResponse = await pathMappingService.resolveLogicalPath('lens-root-main', logicalPath);
    if (!resolveResponse.success || !resolveResponse.localPath) {
      window.alert(resolveResponse.error || '无法解析文件路径');
      return;
    }
    window.alert(`文件路径：${resolveResponse.localPath}\n\n请使用系统播放器打开预览。`);
  }

  // 处理导演结论操作：通过/返修/关闭任务
  async function handleReviewAction(action: ReviewAction): Promise<void> {
    if (!selectedTask || !activeShotId) return;
    if (isContextShot) {
      setResult({ success: false, error: '上下文陪审镜头不支持通过/返修。' });
      return;
    }
    if (action === 'approve' && !canApproveCurrentShot) {
      setResult({ success: false, error: '存在草稿或反馈记录时不可点击镜头通过。' });
      return;
    }
    const confirmed = window.confirm(
      action === 'approve'
        ? '确认通过该镜头审片？'
        : action === 'rework'
          ? '确认要求返修该镜头？'
          : '确认关闭该审片任务？',
    );
    if (!confirmed) return;
    setReviewAction(action);
    try {
      const targetLensId = activeShotId;
      const targetStatusCode = action === 'rework' ? 'PENDING_FEEDBACK_FIX' : 'DIRECTOR_APPROVED';
      const response = await lensService.updateInternalReviewStatus(targetLensId, targetStatusCode);
      if (response.success) {
        await loadSelectedLensDetail(targetLensId);
        if (action === 'rework') {
          clearReviewLocalShotState(selectedTask.taskId, targetLensId);
        }
        // Refresh playback items with updated status
        const detailResponse = await reviewService.getTaskDetail(selectedTask.taskId);
        if (detailResponse.success && detailResponse.detail) {
          setTaskDetail(detailResponse.detail);
          const items = await buildPlaybackItemsWithLensDetails(detailResponse.detail);
          setPlaybackItems(prev => {
            const updated = [...items];
            // Preserve preloaded video src info
            for (let i = 0; i < updated.length; i++) {
              const existing = prev[i];
              if (existing && updated[i]?.shotId === existing.shotId) {
                updated[i] = { ...updated[i], ...existing };
              }
            }
            return updated;
          });
        }
        await loadTasks();
      } else {
        setResult({ success: false, error: response.error || '更新镜头二级状态失败。' });
      }
    } finally {
      setReviewAction(null);
    }
  }

  // === Draft feedback management ===
  // 草稿管理：生成唯一草稿 ID
  // 生成草稿 ID
  function generateDraftId(): string {
    return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // 提交时打包当前帧绘制记录
  // 组装绘制数据负载
  function buildDrawingPayload(): string | undefined {
    if (!localShotState) return undefined;
    return JSON.stringify({
      frameDrawingRecords: localShotState.frameDrawingRecords,
      clearFrameRecords: localShotState.clearFrameRecords,
    });
  }

  function getDraftByFrame(frameNumber: number): LocalFeedbackDraft | null {
    return drafts.find((draft) => draft.frameNumber === frameNumber) ?? null;
  }

  function getSubmittedFeedbackByFrame(frameNumber: number): ReviewFeedback | null {
    const frameFeedbacks = reviewFeedbacks.filter((feedback) => feedback.frameNumber === frameNumber);
    return frameFeedbacks[frameFeedbacks.length - 1] ?? null;
  }

  function navigateToFrame(frameNumber: number): void {
    seekCurrentVideo(Math.max(0, ((frameNumber - 1) / fps) + (frameStep / 4)));
  }

  function buildPendingAction(frameNumber: number, sourceFeedbackId?: string | null): FeedbackItemPendingAction {
    return sourceFeedbackId || Boolean(getSubmittedFeedbackByFrame(frameNumber)) ? 'update' : 'create';
  }

  function detectDrawingChanges(paths: AnnotationPath[], sourceFeedback?: ReviewFeedback | null): boolean {
    if (!sourceFeedback) return paths.length > 0;
    return serializeAnnotationPaths(paths) !== serializeAnnotationPaths(collectDirectorFeedbackMaskPaths([sourceFeedback]));
  }

  function buildDraftChangeFlags(nextCommentText: string, paths: AnnotationPath[], sourceFeedback?: ReviewFeedback | null): { hasTextChanges: boolean; hasDrawingChanges: boolean } {
    const normalizedText = nextCommentText.trim();
    const sourceText = (sourceFeedback?.commentText || '').trim();
    return {
      hasTextChanges: normalizedText !== sourceText,
      hasDrawingChanges: detectDrawingChanges(paths, sourceFeedback),
    };
  }

  function hasDraftTextChanges(draft: LocalFeedbackDraft): boolean {
    return Boolean(draft.hasTextChanges);
  }

  function hasDraftDrawingChanges(draft: LocalFeedbackDraft): boolean {
    return Boolean(draft.hasDrawingChanges);
  }

  function isDraftSubmittable(draft: LocalFeedbackDraft): boolean {
    if (draft.pendingAction === 'delete') return Boolean(draft.sourceFeedbackId?.trim() || draft.submittedFeedbackId?.trim());
    return hasDraftTextChanges(draft) || hasDraftDrawingChanges(draft) || Boolean(draft.annotationDataJson?.trim());
  }

  function isEditorSubmittable(nextCommentText: string, paths: AnnotationPath[], sourceFeedback?: ReviewFeedback | null): boolean {
    if (isContextShot) return false;
    const changes = buildDraftChangeFlags(nextCommentText, paths, sourceFeedback);
    return changes.hasTextChanges || changes.hasDrawingChanges;
  }

  // 清空右侧草稿编辑器的临时输入
  // 重置草稿编辑器
  function resetDraftEditorState(): void {
    setActiveDraftId(null);
    setEditorMode('blank');
    setEditorSourceId(null);
    setDraftCommentText('');
    setAnnotationPaths([]);
    setDraftImages([]);
    editorIsDirtyRef.current = false;
    editorDirtyFrameNumberRef.current = null;
  }

  function startNewDraft(): void {
    setActiveDraftId(null);
    setEditorMode('blank');
    setEditorSourceId(null);
    setDraftCommentText('');
    setAnnotationPaths([]);
    setDraftImages([]);
    editorIsDirtyRef.current = false;
    editorDirtyFrameNumberRef.current = null;
  }

  function buildDraftDrawingFrames(frameNumber: number): Array<{
    frameNumber: number;
    timestampSeconds: number | null;
    timecode: string | null;
    drawingStateCode: 'DRAWN' | 'CLEAR';
    drawingObjectsJson: string | null;
  }> {
    if (!localShotState) return [];

    return [
      ...localShotState.frameDrawingRecords.map((record) => ({
          frameNumber: record.frameNumber,
          timestampSeconds: null,
          timecode: null,
          drawingStateCode: 'DRAWN' as const,
          drawingObjectsJson: JSON.stringify(record.paths),
        })),
      ...localShotState.clearFrameRecords.map((record) => ({
          frameNumber: record.frameNumber,
          timestampSeconds: null,
          timecode: null,
          drawingStateCode: 'CLEAR' as const,
          drawingObjectsJson: null,
        })),
    ].sort((a, b) => a.frameNumber - b.frameNumber);
  }

  // 将当前编辑内容组装成草稿对象
  // 组装一条反馈草稿
  function buildDraftPayload(draftId: string | null = null): LocalFeedbackDraft {
    const now = new Date().toISOString();
    const submittedFeedback = getSubmittedFeedbackByFrame(currentFrameNumber);
    const sourceFeedback = editorSubmittedFeedback ?? submittedFeedback ?? null;
    const sourceFeedbackId = activeDraft?.sourceFeedbackId
      ?? activeSubmittedFeedback?.feedbackId
      ?? sourceFeedback?.feedbackId
      ?? null;
    const sourceFeedbackRoundId = activeDraft?.sourceFeedbackRoundId
      ?? activeSubmittedFeedback?.feedbackRoundId
      ?? sourceFeedback?.feedbackRoundId
      ?? null;
    const [frameImageLocalPath, annotatedImageLocalPath, thumbnailLocalPath] = draftImages
      .map((item) => item.localPath)
      .filter((path): path is string => Boolean(path))
      .slice(0, 3);
    const feedbackRoundId = editorMode === 'draft'
      ? normalizeFeedbackRoundId(activeDraft?.feedbackRoundId)
      : editorMode === 'submitted-feedback'
        ? normalizeFeedbackRoundId(activeSubmittedFeedback?.feedbackRoundId)
        : null;

    return {
      draftId: draftId ?? generateDraftId(),
      feedbackRoundId: feedbackRoundId ?? generateFeedbackRoundId(),
      sourceFeedbackId,
      sourceFeedbackRoundId,
      taskShotId: currentItem?.taskShotId || '',
      shotId: activeShotId || currentItem?.shotId || '',
      lensCode: currentItem?.lensCode || '',
      versionNum: currentItem?.resolvedVersionNum || currentItem?.submitVersionNum || selectedTask!.versionNum || '',
      frameNumber: currentFrameNumber,
      timecode: currentFrameTime,
      commentText: draftCommentText,
      decisionCode: 'PENDING',
      pendingAction: buildPendingAction(currentFrameNumber, sourceFeedbackId),
      submitStatus: 'unsaved',
      createdAt: now,
      updatedAt: now,
      annotationDataJson: annotationPaths.length > 0 ? serializeAnnotationPaths(annotationPaths) : undefined,
      ...buildDraftChangeFlags(draftCommentText, annotationPaths, sourceFeedback),
      frameImageLocalPath,
      annotatedImageLocalPath,
      thumbnailLocalPath,
    };
  }

  // 保存或更新本地草稿
  // 保存当前草稿
  function handleSaveDraft() {
    if (!currentItem || !selectedTask || !activeShotId) return;
    if (isContextShot) {
      setResult({ success: false, error: '上下文陪审镜头不支持保存反馈。' });
      return;
    }
    const sourceFeedback = editorSubmittedFeedback ?? null;
    const existingFrameDraft = getDraftByFrame(currentFrameNumber);
    if (!isEditorSubmittable(draftCommentText, annotationPaths, sourceFeedback) && !existingFrameDraft) {
      setResult({ success: false, error: '请先修改文字或绘制内容' });
      return;
    }

    const targetDraftId = activeDraftId ?? existingFrameDraft?.draftId ?? null;
    const newDraft = buildDraftPayload(targetDraftId);
    const sourceFeedbackId = existingFrameDraft?.sourceFeedbackId ?? activeDraft?.sourceFeedbackId ?? sourceFeedback?.feedbackId ?? null;
    const sourceFeedbackRoundId = existingFrameDraft?.sourceFeedbackRoundId ?? activeDraft?.sourceFeedbackRoundId ?? sourceFeedback?.feedbackRoundId ?? null;

    setDraftImages(createPendingItemsFromPaths([
      newDraft.frameImageLocalPath,
      newDraft.annotatedImageLocalPath,
      newDraft.thumbnailLocalPath,
    ].filter((path): path is string => Boolean(path))));

    const nextDrafts = targetDraftId
      ? drafts.map((d) => (d.draftId === targetDraftId
        ? {
            ...newDraft,
            draftId: targetDraftId,
            createdAt: d.createdAt,
            feedbackRoundId: normalizeFeedbackRoundId(d.feedbackRoundId) ?? newDraft.feedbackRoundId,
            sourceFeedbackId: d.sourceFeedbackId ?? newDraft.sourceFeedbackId ?? sourceFeedbackId,
            sourceFeedbackRoundId: d.sourceFeedbackRoundId ?? newDraft.sourceFeedbackRoundId ?? sourceFeedbackRoundId,
            hasTextChanges: newDraft.hasTextChanges,
            hasDrawingChanges: newDraft.hasDrawingChanges,
          }
        : d))
      : [...drafts.filter((d) => d.frameNumber !== currentFrameNumber), newDraft];
    const nextState = localShotState ?? createEmptyReviewLocalShotState(selectedTask.taskId, currentItem.shotId);
    persistLocalShotState({ ...nextState, feedbackDrafts: nextDrafts, updatedAt: new Date().toISOString() });
    startNewDraft();

    setResult({ success: true });
  }

  function buildSubmitRequestPayload(draft: LocalFeedbackDraft, drawingPayload?: string) {
    return {
      commentText: draft.commentText || undefined,
      frameImagePath: draft.frameImageLocalPath || undefined,
      annotatedImagePath: draft.annotatedImageLocalPath || undefined,
      thumbnailPath: draft.thumbnailLocalPath || undefined,
      annotationDataJson: drawingPayload || draft.annotationDataJson || undefined,
      drawingFrames: buildDraftDrawingFrames(draft.frameNumber),
      decisionCode: draft.decisionCode,
    };
  }

  async function submitSingleDraft(draft: LocalFeedbackDraft, drawingPayload?: string): Promise<{ success: boolean; error?: string }> {
    if (isContextShot) {
      return { success: false, error: '上下文陪审镜头不支持正式反馈写入。' };
    }
    if (draft.pendingAction === 'delete') {
      const targetFeedbackId = draft.sourceFeedbackId || draft.submittedFeedbackId;
      if (!targetFeedbackId) return { success: true };
      return reviewService.deleteReviewFeedback(targetFeedbackId);
    }

    if (draft.sourceFeedbackId) {
      return reviewService.updateReviewFeedback(draft.sourceFeedbackId, buildSubmitRequestPayload(draft, drawingPayload));
    }

    return reviewService.createReviewFeedback({
      feedbackRoundId: draft.feedbackRoundId ?? generateFeedbackRoundId(),
      reviewTaskId: selectedTask!.taskId,
      taskShotId: draft.taskShotId,
      lensId: draft.shotId,
      versionNum: draft.versionNum,
      frameNumber: draft.frameNumber,
      timecode: draft.timecode,
      commentText: draft.commentText || undefined,
      decisionCode: draft.decisionCode,
      frameImagePath: draft.frameImageLocalPath || undefined,
      annotatedImagePath: draft.annotatedImageLocalPath || undefined,
      thumbnailPath: draft.thumbnailLocalPath || undefined,
      annotationDataJson: drawingPayload || draft.annotationDataJson || undefined,
      drawingFrames: buildDraftDrawingFrames(draft.frameNumber),
    });
  }

  // 进入某条草稿的编辑态，并跳回对应帧
  // 编辑已有草稿并回到对应帧
  function handleEditDraft(itemId: string) {
    if (isContextShot) return;
    const draft = drafts.find((d) => d.draftId === itemId);
    if (draft) {
      void (async () => {
      const targetIndex = playbackItems.findIndex((s) => s.taskShotId === draft.taskShotId || s.shotId === draft.shotId);
        if (targetIndex >= 0 && targetIndex !== currentIndex) {
          pendingSeekRef.current = { index: targetIndex, time: Math.max(0, (draft.frameNumber - 1) / fps) };
          await switchToShot(targetIndex, 'user-queue-click');
        }
        setActiveDraftId(draft.draftId);
        applyEditorSnapshot('draft', draft.draftId, draft.commentText);
        setAnnotationPaths(deserializeAnnotationPaths(draft.annotationDataJson));
        setDraftImages(createPendingItemsFromPaths([
          draft.frameImageLocalPath,
          draft.annotatedImageLocalPath,
          draft.thumbnailLocalPath,
        ].filter((path): path is string => Boolean(path))));
        navigateToFrame(draft.frameNumber);
      })();
      return;
    }

      const feedback = reviewFeedbacks.find((item) => item.feedbackId === itemId);
    if (!feedback) return;
    void (async () => {
      setActiveDraftId(null);
      applyEditorSnapshot('submitted-feedback', feedback.feedbackId, feedback.commentText || '');
      setAnnotationPaths(collectDirectorFeedbackMaskPaths([feedback]));
      setDraftImages(createPendingItemsFromPaths([
        feedback.frameImagePath,
        feedback.annotatedImagePath,
        feedback.thumbnailPath,
      ].filter((path): path is string => Boolean(path))));
      navigateToFrame(feedback.frameNumber ?? currentFrameNumber);
    })();
  }

  function handleDeleteDraft(itemId: string) {
    if (isContextShot) return;
    const draft = drafts.find((d) => d.draftId === itemId);
    if (draft) {
      const confirmed = window.confirm('确认删除该反馈草稿？');
      if (!confirmed) return;
      const nextDrafts = draft.pendingAction === 'create' || (draft.pendingAction === 'delete' && !draft.sourceFeedbackId && !draft.submittedFeedbackId)
        ? drafts.filter((d) => d.draftId !== itemId)
        : drafts.map((d) => d.draftId === itemId ? { ...d, pendingAction: 'delete' as const, submitStatus: 'unsaved' as const, updatedAt: new Date().toISOString() } : d);
      if (localShotState) {
        persistLocalShotState({ ...localShotState, feedbackDrafts: nextDrafts, updatedAt: new Date().toISOString() });
      }
      if (activeDraftId === itemId) {
        resetDraftEditorState();
      }
      return;
    }

    const feedback = reviewFeedbacks.find((item) => item.feedbackId === itemId);
    if (!feedback || !selectedTask || !activeShotId) return;
    const confirmed = window.confirm('确认删除该条已提交反馈？删除后需点击“提交反馈”才会真正生效。');
    if (!confirmed) return;
    const nextState = localShotState ?? createEmptyReviewLocalShotState(selectedTask.taskId, activeShotId);
    const feedbackRoundId = normalizeFeedbackRoundId(feedback.feedbackRoundId) ?? generateFeedbackRoundId();
    const deletionDraft: LocalFeedbackDraft = {
      draftId: generateDraftId(),
      feedbackRoundId,
      sourceFeedbackId: feedback.feedbackId,
      taskShotId: feedback.taskShotId || currentItem.taskShotId,
      shotId: feedback.lensId,
      lensCode: feedback.lensCode,
      versionNum: feedback.versionNum || currentPlaybackVersionLabel,
      frameNumber: feedback.frameNumber ?? currentFrameNumber,
      timecode: feedback.timecode || currentFrameTime,
      commentText: feedback.commentText || '',
      decisionCode: feedback.decisionCode || 'PENDING',
      pendingAction: 'delete',
      submitStatus: 'unsaved',
      createdAt: feedback.createdAtUtc,
      updatedAt: new Date().toISOString(),
      submittedFeedbackId: feedback.feedbackId,
    };
    const nextDrafts = [...nextState.feedbackDrafts.filter((d) => d.frameNumber !== deletionDraft.frameNumber), deletionDraft];
    persistLocalShotState({ ...nextState, feedbackDrafts: nextDrafts, updatedAt: new Date().toISOString() });
    if (editorSourceId === feedback.feedbackId) {
      resetDraftEditorState();
    }
  }

  useEffect(() => {
    if (!localShotState || invalidLocalDrafts.length === 0) return;
    const cleanedDrafts = localShotState.feedbackDrafts.filter((draft) => !invalidLocalDrafts.some((invalid) => invalid.draftId === draft.draftId));
    persistLocalShotState({ ...localShotState, feedbackDrafts: cleanedDrafts, updatedAt: new Date().toISOString() });
    if (invalidLocalDrafts.some((draft) => draft.draftId === activeDraftId)) {
      resetDraftEditorState();
    }
    setResult({ success: false, error: `已自动清理 ${invalidLocalDrafts.length} 条历史无效删除草稿。` });
  }, [activeDraftId, invalidLocalDrafts, localShotState]);

  function handleSelectDraft(itemId: string) {
    handleEditDraft(itemId);
  }

  // 标注画布提示文案
  function getAnnotationCanvasHint(): string {
    if (isContextShot) return '上下文陪审镜头仅供播放参考，不支持标注编辑';
    return annotationEnabled ? '暂停后可编辑当前帧及其继承标注' : '播放中禁止绘制';
  }

  // 标注变更时同步到本地草稿状态
  // 标注路径变化时同步本地状态
  function handleAnnotationPathsChange(paths: AnnotationPath[]): void {
    if (!localShotState || !selectedTask || !activeShotId) return;
    persistLocalShotState(upsertFrameDrawingRecord(localShotState, currentFrameNumber, paths));
    setAnnotationPaths(paths);
  }

  // 清除当前帧标注
  // 清除某一帧的标注
  function handleClearAnnotationFrame(frameNumber: number): void {
    if (!localShotState) return;
    persistLocalShotState(upsertClearFrameRecord(localShotState, frameNumber));
    setAnnotationPaths([]);
  }

  // 从剪贴板粘贴图片附件
  // 粘贴图片附件
  async function handlePasteDraftImages(e: React.ClipboardEvent) {
    const paths = await extractPastedImages(e.clipboardData.items);
    if (paths.length === 0) return;
    e.preventDefault();
    setDraftImages((prev) => addPendingPaths(prev, paths));
  }

  // === Submit feedback ===
  // 批量提交当前镜头下所有未提交的反馈草稿
  // 批量提交反馈草稿
  async function handleSubmitFeedback() {
    if (!selectedTask || !taskDetail) return;
    if (isContextShot) {
      setResult({ success: false, error: '上下文陪审镜头不支持提交反馈。' });
      return;
    }
    const submittingShotId = activeShotId ?? currentItem?.shotId ?? null;
    const submittingFrameNumber = currentFrameNumber;
    const drawingPayload = buildDrawingPayload();
    const drawingOnlyDraft: LocalFeedbackDraft | null = pendingDraftsCount === 0 && hasPendingDrawingChanges && currentItem
      ? ({
          draftId: generateDraftId(),
          feedbackRoundId: normalizeFeedbackRoundId(editorSubmittedFeedback?.feedbackRoundId) ?? generateFeedbackRoundId(),
          sourceFeedbackId: editorSubmittedFeedback?.feedbackId ?? null,
          sourceFeedbackRoundId: editorSubmittedFeedback?.feedbackRoundId ?? null,
          hasTextChanges: false,
          hasDrawingChanges: true,
          taskShotId: currentItem.taskShotId,
          shotId: currentItem.shotId,
          lensCode: currentItem.lensCode,
          versionNum: currentItem.resolvedVersionNum || currentItem.submitVersionNum || selectedTask.versionNum || '',
          frameNumber: currentFrameNumber,
          timecode: currentFrameTime,
          commentText: editorSubmittedFeedback?.commentText || '',
          decisionCode: editorSubmittedFeedback?.decisionCode || 'PENDING',
          pendingAction: buildPendingAction(currentFrameNumber, editorSubmittedFeedback?.feedbackId),
          submitStatus: 'unsaved',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          frameImageLocalPath: undefined,
          annotatedImageLocalPath: undefined,
          thumbnailLocalPath: undefined,
          submittedFeedbackId: editorSubmittedFeedback?.feedbackId,
          annotationDataJson: drawingPayload || undefined,
        })
      : null;
    const pendingDrafts = drawingOnlyDraft ? [drawingOnlyDraft] : submittableCurrentDrafts;
    if (pendingDrafts.length === 0 && !hasPendingDrawingChanges) {
      setResult({ success: false, error: '没有待提交的反馈卡片。' });
      return;
    }

    if (pendingDrafts.some((draft) => draft.pendingAction !== 'delete' && !isDraftSubmittable(draft))) {
      setResult({ success: false, error: '存在空白反馈，无法提交。' });
      return;
    }

    const confirmed = window.confirm(`确认提交当前镜头的反馈变更？本次将同步新增、更新、删除以及绘制修改。`);
    if (!confirmed) return;

    setIsSubmitting(true);
    setSubmitErrors([]);
    const errors: string[] = [];
    let submittedAnyFeedback = false;
    for (const draft of pendingDrafts) {
      if (localShotState) {
        persistLocalShotState({
          ...localShotState,
          feedbackDrafts: localShotState.feedbackDrafts.map((d) => (d.draftId === draft.draftId ? { ...d, submitStatus: 'pending' as const } : d)),
          updatedAt: new Date().toISOString(),
        });
      }

      try {
        const response = await submitSingleDraft(draft, drawingPayload);
        const success = response.success;
        const responseError = response.error;

        if (success) {
          submittedAnyFeedback = true;
        } else {
          errors.push(`${draft.lensCode} #${draft.frameNumber}: ${responseError || '保存失败'}`);
        }
      } catch (err) {
        errors.push(`${draft.lensCode} #${draft.frameNumber}: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    }

    setIsSubmitting(false);
    if (errors.length > 0) {
      setSubmitErrors(errors);
      setResult({ success: false, error: `${errors.length} 条反馈提交失败，可重试。` });
    } else {
      const refreshedShotId = submittingShotId;
      const refreshedTaskId = selectedTask?.taskId ?? null;
      let clearedState: ReviewLocalShotState | null = null;
      if (refreshedTaskId && refreshedShotId) {
        clearedState = clearReviewLocalShotState(refreshedTaskId, refreshedShotId);
        setLocalShotState(clearedState);
        resetDraftEditorState();
      }
      setResult({ success: true });
      if (selectedTask && submittingShotId) {
        const feedbackView = await loadAllFeedbacksForShot(submittingShotId, {
          shotId: submittingShotId,
          taskShotId: currentItem?.taskShotId ?? null,
          reviewTaskId: selectedTask?.taskId ?? null,
        });
        setShotFeedbackViewByShotId((prev) => ({ ...prev, [feedbackView.shotId]: feedbackView }));
        const detailResponse = await reviewService.getTaskDetail(selectedTask.taskId);
        if (detailResponse.success && detailResponse.detail) {
          setTaskDetail(detailResponse.detail);
        }
        setAnnotationPaths(resolveReviewVisibleAnnotationPaths({
          drawingFrames: feedbackView.latestRoundDrawingFrames ?? null,
          frameDrawingRecords: clearedState?.frameDrawingRecords ?? null,
          clearFrameRecords: clearedState?.clearFrameRecords ?? null,
        }, submittingFrameNumber));
      }
    }
  }

  // === Video ref callbacks ===
  // 绑定当前播放视频元素
  // 绑定主视频元素
  function setVideoRef(el: HTMLVideoElement | null) {
    videoRef.current = el;
  }

  // 绑定下一镜头预加载视频元素
  // 绑定下一个预加载视频元素
  function setNextVideoRef(el: HTMLVideoElement | null) {
    nextVideoRef.current = el;
  }

  // === Queue click handler ===
  // 点击镜头队列切换到指定镜头
  // 点击镜头队列切换镜头
  function handleQueueClick(index: number) {
    if (index === currentIndex) return;
    void switchToShot(index, 'user-queue-click');
  }

  // === Prev/Next handlers ===
  // 切到上一镜头
  // 切换到上一镜头
  function handlePrevShot() {
    if (currentIndex <= 0) return;
    void switchToShot(currentIndex - 1, 'user-prev');
  }

  // 切到下一镜头
  // 切换到下一镜头
  function handleNextShot() {
    if (currentIndex >= playbackItems.length - 1) return;
    void switchToShot(currentIndex + 1, 'user-next');
  }

  return (
    <section className="page-layout">
      <header className="page-header">
        <div>
          <p className="eyebrow">审片</p>
          <h2>导演审片工作台</h2>
          <div className="page-header-tags">
            <span className="page-header-tag">连播审片</span>
            <span className="page-header-tag">暂停标注</span>
            <span className="page-header-tag">反馈卡片</span>
          </div>
          <p className="muted review-shortcut-hint" style={{ marginTop: '0.5rem' }}>
            快捷键：Space 播放/暂停 · ←/→ 逐帧 · Shift+←/→ 切镜头 · Home/End 首尾帧
          </p>
        </div>
        <div className="page-header-actions">
          <p className="muted">当前用户：{user?.displayName}</p>
        </div>
      </header>

      <div className="review-stats-grid">
        <article className="review-stat-card"><span className="review-stat-label">待审</span><strong>{stats.pending}</strong></article>
        <article className="review-stat-card"><span className="review-stat-label">审阅中</span><strong>{stats.inReview}</strong></article>
        <article className="review-stat-card approved"><span className="review-stat-label">已通过</span><strong>{stats.approved}</strong></article>
        <article className="review-stat-card rejected"><span className="review-stat-label">已返修</span><strong>{stats.rejected}</strong></article>
      </div>

      <div className="review-stats-grid">
        <article className="review-stat-card"><span className="review-stat-label">版本视频</span><strong>{playbackSourceStats.version}</strong></article>
        <article className="review-stat-card"><span className="review-stat-label">Layout 补位</span><strong>{playbackSourceStats.layout}</strong></article>
        <article className="review-stat-card"><span className="review-stat-label">无视频</span><strong>{playbackSourceStats.none}</strong></article>
        <article className="review-stat-card"><span className="review-stat-label">总镜头</span><strong>{playbackItems.length}</strong></article>
      </div>

      <div className="review-workspace stack-gap">
        <section className="panel stack-gap review-task-strip">
          <div className="section-heading">
            <div>
              <h3>审片任务队列</h3>
              <p className="muted">从这里进入审片，选择任务后会在下方展开播放器与反馈区。</p>
            </div>
            <div className="filter-bar review-filter-bar">
              <button className={statusFilter === 'all' ? 'tab-button active' : 'tab-button'} onClick={() => setStatusFilter('all')} type="button">全部 ({stats.total})</button>
              <button className={statusFilter === 'pending' ? 'tab-button active' : 'tab-button'} onClick={() => setStatusFilter('pending')} type="button">待审 ({stats.pending})</button>
              <button className={statusFilter === 'in-review' ? 'tab-button active' : 'tab-button'} onClick={() => setStatusFilter('in-review')} type="button">审阅中 ({stats.inReview})</button>
              <button className={statusFilter === 'approved' ? 'tab-button active' : 'tab-button'} onClick={() => setStatusFilter('approved')} type="button">通过 ({stats.approved})</button>
              <button className={statusFilter === 'rejected' ? 'tab-button active' : 'tab-button'} onClick={() => setStatusFilter('rejected')} type="button">返修 ({stats.rejected})</button>
            </div>
          </div>

          {loading ? (
            <p className="muted">加载中...</p>
          ) : filteredTasks.length === 0 ? (
            <p className="muted">暂无待审镜头</p>
          ) : (
            <div className="review-task-list review-task-list--strip">
              {filteredTasks.map((task) => (
                <article key={task.taskId} className={selectedTask?.taskId === task.taskId ? 'review-task-card active' : 'review-task-card'} onClick={() => void handleEnterTask(task)}>
                  <div className="section-heading">
                    <div>
                      <h4>{task.lensCode} <small className="muted">({task.shotCount || 1} 镜头)</small></h4>
                      <p className="muted">{task.episodeCode} · V{task.versionNum}</p>
                    </div>
                    <span className={`status-pill status-${task.status}`}>
                      {getTaskStatusLabel(task.status)}
                    </span>
                  </div>
                  <div className="stack-gap compact-gap">
                    <small className="muted">提交人：{task.submitterName}</small>
                    <small className="muted">提交时间：{formatTime(task.submitTime)}</small>
                    <small className="muted">反馈数：{task.commentCount}</small>
                  </div>
                  <div className="actions-row compact-actions">
                    <button className="primary-button" onClick={(e) => { e.stopPropagation(); void handleEnterTask(task); }} type="button">进入审片</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel stack-gap review-workspace-body">
          {selectedTask ? (
            <>
              {/* Task queue bar with active shot highlighting */}
              <div className="review-task-queue-bar">
                <div className="section-heading">
                  <div>
                    <h3>{taskDetail?.taskName || `任务 ${selectedTask.taskId.slice(0, 8)}`}</h3>
                    <p className="muted">
                      {taskDetail?.description || '—'} · 导演：{taskDetail?.directorName || selectedTask.reviewerName || '—'} · 提交人：{taskDetail?.submitterName || selectedTask.submitterName || '—'}
                    </p>
                  </div>
                  <span className={`status-pill status-${taskDetail?.status || selectedTask.status}`}>{getTaskStatusLabel(taskDetail?.status || selectedTask.status)}</span>
                </div>
                <div className="review-queue-legend muted">
                  <span className="review-queue-legend__item review-queue-legend__item--unmatched">未匹配</span>
                  <span className="review-queue-legend__item review-queue-legend__item--pending">已匹配待处理</span>
                  <span className="review-queue-legend__item review-queue-legend__item--processed">已处理</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflowX: 'auto', padding: '0.5rem 0' }}>
                  <small className="muted" style={{ whiteSpace: 'nowrap' }}>
                    上任务镜头列表 ({currentIndex + 1}/{playbackItems.length})：
                  </small>
                  {playbackItems.map((item, index) => {
                    const queueState = getReviewQueueState(item);
                    let itemClass = 'tab-button';
                    if (index === currentIndex) {
                      itemClass += ' active shot-queue-active';
                    }
                    itemClass += ` review-queue-button review-queue-button--${queueState}`;
                    if (item.preloadStatus === 'ready' && index !== currentIndex) {
                      itemClass += ' shot-queue-preloaded';
                    }
                    return (
                      <button
                        key={item.taskShotId}
                        className={itemClass}
                        onClick={() => handleQueueClick(index)}
                        style={{ whiteSpace: 'normal', fontSize: '0.8rem', minWidth: '9rem' }}
                        type="button"
                        title={
                          item.resolvedSourceType === 'layout'
                            ? 'Layout 补位（非版本视频）'
                            : item.playabilityStatus === 'no-video'
                              ? '无视频素材'
                            : item.preloadStatus === 'ready'
                              ? '已预加载'
                              : ''
                        }
                      >
                        <span className="review-queue-button__title">
                          <strong>#{index + 1} {item.lensCode}</strong>
                          {item.reviewParticipationMode === 'context' ? <span className="review-queue-state">上下文</span> : null}
                          <span className="review-queue-state">{getReviewQueueStateLabel(item)}</span>
                        </span>
                        <span className="review-queue-button__meta">
                          <small className="muted">反馈 {item.feedbackCount} 条</small>
                          <small className="muted">{item.internalReviewStatusName || getInternalReviewStatusLabel(item.internalReviewStatusCode)}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 播放器区域：视频、标注层和控制条 */}
              <div className="review-player-shell" style={{ display: 'flex', flexDirection: 'column', width: '100%' , marginBottom: '2rem'}}>
                <div className="review-player-preview" style={{ position: 'relative', background: '#000', overflow: 'hidden' }}>
                    {videoSrc ? (
                      <>
                        <video
                          ref={setVideoRef}
                          className="review-player-video"
                          controls={false}
                          preload="auto"
                          src={videoSrc}
                          onEnded={handleVideoEnded}
                          onTimeUpdate={handleTimeUpdate}
                          onDurationChange={handleDurationChange}
                          onLoadedMetadata={handleLoadedMetadata}
                          onPlay={handlePlay}
                          onPause={handlePause}
                          style={{ width: '100%', height: 'auto', display: 'block' }}
                        />
                        {/* 标注画布：叠加在视频上方，暂停时可直接绘制 */}
                        <AnnotationCanvas
                          currentFrameNumber={currentFrameNumber}
                          enabled={annotationEnabled}
                          height={360}
                          onClearFrame={handleClearAnnotationFrame}
                          onPathsChange={handleAnnotationPathsChange}
                          paths={annotationPaths}
                          width={640}
                        />
                        {/* 播放中显示提示，提醒当前不能绘制 */}
                        {!annotationEnabled ? (
                          <div className="review-annotation-hint muted">{getAnnotationCanvasHint()}</div>
                        ) : null}
                        {/* 预加载下一镜头视频，减少切换等待 */}
                        {nextVideoSrc ? (
                          <video
                            ref={setNextVideoRef}
                            preload="auto"
                            src={nextVideoSrc}
                            style={{ display: 'none' }}
                          />
                        ) : null}
                    </>
                  ) : (
                    <div className="review-player-placeholder">
                      {currentItem?.playabilityStatus === 'no-video' ? (
                        <>
                          <strong>当前镜头无视频素材</strong>
                          <p className="muted">该镜头没有可播放的视频地址，请切换至下一镜头。</p>
                        </>
                      ) : currentItem?.resolvedSourceType === 'layout' ? (
                        <>
                          <strong>当前使用 Layout 补位视频</strong>
                          <p className="muted">未命中版本视频，已自动切换到 Layout 补位。</p>
                        </>
                      ) : currentItem?.resolvedSourceType === 'fallback-version' ? (
                        <>
                          <strong>{currentItem.sourceLabel}</strong>
                          <p className="muted">{currentItem.sourceDescription}</p>
                        </>
                      ) : detailLoading ? (
                        <>
                          <strong>正在加载视频...</strong>
                          <p className="muted">正在获取镜头视频信息，请稍候。</p>
                        </>
                      ) : (
                        <>
                          <strong>预览待接入</strong>
                          <p className="muted">当前任务暂无可直接内嵌的视频地址。</p>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Playback controls */}
                {videoSrc || currentItem?.playabilityStatus === 'no-video' ? (
                    <div className="review-player-controls">
                      <button className="playback-btn" disabled={currentIndex <= 0} onClick={handlePrevShot} type="button">⏮</button>
                    <button className="playback-btn" onClick={() => handleStepFrame('backward')} disabled={!isPaused || !videoSrc} type="button">⏪</button>
                    <button className={`playback-btn ${isPlaying ? 'active' : ''}`} onClick={togglePlayPause} disabled={!videoSrc} type="button">
                      {isPlaying ? '⏸' : '▶'}
                    </button>
                    <button className="playback-btn" onClick={() => handleStepFrame('forward')} disabled={!isPaused || !videoSrc} type="button">⏩</button>
                    <button className="playback-btn" disabled={currentIndex >= playbackItems.length - 1} onClick={handleNextShot} type="button">⏭</button>
                    <div className="review-shot-indicator">
                      <span>{currentItem?.lensCode || '—'}</span>
                      <span className="muted">
                        {formatTimestamp(currentTime)} / {formatTimestamp(duration)}
                      </span>
                      <span className="muted">
                        #{currentFrameNumber}帧
                      </span>
                      <span className="muted">{currentItem?.sourceLabel || '等待解析'}</span>
                    </div>
                    <select
                      value={playbackRate}
                      onChange={(e) => {
                        const rate = Number(e.target.value);
                        setPlaybackRate(rate);
                        if (videoRef.current) videoRef.current.playbackRate = rate;
                      }}
                      style={{ marginLeft: 'auto', fontSize: '0.8rem' }}
                    >
                      <option value={0.5}>0.5x</option>
                      <option value={1}>1x</option>
                      <option value={1.5}>1.5x</option>
                      <option value={2}>2x</option>
                    </select>
                  </div>
                ) : null}

                <div className="review-progress-shell" aria-label="播放进度">
                  <div className="review-progress-track">
                    <div className="review-progress-fill" style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }} />
                    {videoSrc && duration > 0 ? (
                      <input
                        aria-label="拖动播放进度"
                        className="review-progress-input"
                        max={duration}
                        min={0}
                        onChange={(e) => seekCurrentVideo(Number(e.target.value))}
                        step={frameStep}
                        type="range"
                        value={Math.min(currentTime, duration)}
                      />
                    ) : null}
                  </div>
                  <div className="review-progress-meta">
                    <span>{formatTimestamp(currentTime)}</span>
                    <span>{duration > 0 ? formatTimestamp(duration) : '--:--'}</span>
                  </div>
                </div>

              </div>

                {/* Feedback editor + list */}
                <div className="stack-gap" style={{ marginTop: '1.5rem' }}>
                <article className="panel review-comment-panel">
                  <div className="section-heading">
                    <div>
                      <h4>当前帧反馈</h4>
                      <p className="muted">
                        {currentItem?.lensCode || '—'} · #{currentFrameNumber}帧 · {currentFrameTime} · {currentPlaybackVersionLabel}
                      </p>
                      <p className="muted">
                        {isContextShot ? '上下文陪审镜头仅展示播放与衔接信息' : `当前帧命中 ${currentFrameFeedbacks.length} 条反馈，回显最新一条`}
                      </p>
                      <p className="muted">{currentItem?.sourceLabel || '等待解析'}</p>
                    </div>
                  </div>
                  {isContextShot ? (
                    <div className="feedback-editor feedback-editor--readonly">
                      <p className="muted">上下文陪审镜头仅用于播放与衔接参考，不提供反馈编辑与提交。</p>
                    </div>
                  ) : (
                    <div className="feedback-editor" onPaste={handlePasteDraftImages}>
                      <label className="field">
                        <span>反馈说明</span>
                            <textarea
                            onChange={(e) => {
                              editorIsDirtyRef.current = true;
                              editorDirtyFrameNumberRef.current = currentFrameNumber;
                              setDraftCommentText(e.target.value);
                            }}
                          placeholder="输入对该镜头的审片意见，可配合画面标注一起提交。"
                          rows={3}
                          value={draftCommentText}
                        />
                      </label>
                      <div className="feedback-editor-actions">
                        <button className="primary-button" onClick={handleSaveDraft} disabled={!isEditorSubmittable(draftCommentText, annotationPaths, editorSubmittedFeedback)} type="button">
                          {activeDraftId || editorMode === 'submitted-feedback' ? '更新草稿' : '保存为草稿'}
                        </button>
                        {activeDraftId || editorMode === 'submitted-feedback' ? (
                          <button className="secondary-button" onClick={() => {
                            startNewDraft();
                          }} type="button">
                            取消编辑
                          </button>
                        ) : null}
                      </div>
                      {draftImages.length > 0 ? (
                        <div className="image-attachment-compact-list">
                          {draftImages.map((img) => (
                            <div className="image-attachment-compact-item image-attachment-compact-item--thumb" key={img.uid}>
                              <img alt={img.fileName} className="image-attachment-thumb" onError={(event) => { event.currentTarget.style.display = 'none'; }} src={resolveImageUrl(img.previewUrl || img.localPath) || ''} />
                              <div className="image-attachment-compact-item-meta">
                                <span>{img.fileName}</span>
                                <button className="ghost-button" onClick={() => setDraftImages((prev) => removeItem(prev, img.uid))} type="button">
                                  移除
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                </article>

                <article className="panel review-comment-panel">
                  <div className="section-heading">
                    <div>
                      <h4>当前镜头反馈列表</h4>
                    <p className="muted">列表展示当前镜头全部反馈项；同一帧只保留一条，已提交反馈也可再次编辑或删除。</p>
                    </div>
                  </div>
                  {isContextShot ? (
                    <div className="feedback-card-list-empty">
                      <p className="muted">上下文陪审镜头没有正式反馈卡片操作。</p>
                    </div>
                  ) : (
                    <FeedbackCardList
                      items={feedbackListEntries}
                      activeItemId={activeFeedbackListItemId}
                      onSelect={handleSelectDraft}
                      onDelete={handleDeleteDraft}
                      onEdit={handleEditDraft}
                    />
                  )}
                </article>

                <div className="submit-feedback-bar">
                  <div className="submit-feedback-info">
                    <strong>待提交变更：{pendingDraftsCount} 项{hasPendingDrawingChanges ? ' + 绘制修改' : ''}</strong>
                    <small className="muted">
                      {isContextShot ? '上下文陪审镜头不参与正式反馈、通过或返修。' : '提交反馈会统一处理新增、更新、删除与绘制修改；当前镜头无反馈且无待提交修改时才可执行“镜头通过”。'}
                    </small>
                  </div>
                  <div className="submit-feedback-actions">
                    {!isContextShot ? <button
                      className="primary-button"
                      disabled={(pendingDraftsCount === 0 && !hasPendingDrawingChanges) || isSubmitting}
                      onClick={() => void handleSubmitFeedback()}
                      type="button"
                    >
                      {isSubmitting ? '提交中…' : `提交反馈（${pendingDraftsCount}${hasPendingDrawingChanges ? ' + 绘制' : ''}）`}
                    </button> : null}
                    {!isContextShot ? <button
                      className="primary-button"
                      disabled={reviewAction !== null || !canApproveCurrentShot}
                      onClick={() => void handleReviewAction('approve')}
                      title={approveDisabledReason}
                      type="button"
                    >
                      镜头通过
                    </button> : null}
                  </div>
                </div>
                {submitErrors.length > 0 ? (
                  <div className="submit-feedback-errors">
                    <strong className="danger-copy">以下反馈提交失败：</strong>
                    {submitErrors.map((err, i) => (
                      <p className="danger-copy" key={i}>{err}</p>
                    ))}
                  </div>
                ) : null}

                <div className="review-player-meta review-player-meta--footer">
                  <article className="review-meta-card">
                    <span className="lens-summary-label">制作人员 / 版本 / 当前帧</span>
                    <strong>{activeLensDetail?.makerDisplayName ?? activeLensDetail?.maker ?? '—'}</strong>
                    <small className={`muted ${effectiveInternalReviewStatus === 'DIRECTOR_APPROVED' ? 'success-copy' : ''}`}>
                      版本 {currentPlaybackVersionLabel} · #{currentFrameNumber}
                    </small>
                  </article>
                  <article className="review-meta-card">
                    <span className="lens-summary-label">反馈状态</span>
                    <strong>{isContextShot ? '上下文陪审镜头不统计正式反馈' : (reviewTaskStats.feedback > 0 ? `已提交 ${reviewTaskStats.feedback} 条正式反馈` : '暂无正式反馈记录')}</strong>
                    <small className="muted">{isContextShot ? '上下文陪审镜头仅参与播放，不计入正式审片统计' : (approveDisabledReason || `正式镜头待处理 ${reviewTaskStats.pending} 个`)}</small>
                  </article>
                  <article className="review-meta-card">
                    <span className="lens-summary-label">当前素材来源</span>
                    <strong>{currentItem?.sourceLabel || '等待解析'}</strong>
                    <small className="muted">{currentItem?.resolvedSourceType === 'layout' ? '当前素材来源：Layout 补位' : currentItem?.resolvedSourceType === 'none' ? '当前素材来源：无可播放素材' : '当前素材来源：版本视频'}</small>
                  </article>
                </div>
                <p className="muted review-footer-note">{isContextShot ? '上下文陪审镜头不参与通过/返修和待处理统计。' : '当前任务无草稿且反馈列表为 0 时才允许执行镜头通过。'}</p>
              </div>
            </>
          ) : (
            <p className="muted">请选择一个任务进行审片</p>
          )}
        </section>
      </div>

      {result.error && (
        <div className="danger-copy">
          {result.error}
          <button onClick={() => setResult({ success: true })} type="button">关闭</button>
        </div>
      )}
    </section>
  );
}
