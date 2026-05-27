/**
 * 审片工作台 - 任务级连播核心逻辑
 *
 * 职责：
 * 1. 播放列表构建与预解析
 * 2. 镜头详情预加载调度
 * 3. 视频源预解析与缓存
 * 4. 切换调度（统一入口）
 * 5. 镜头详情/反馈/帧信息刷新编排
 */
import type { PlaybackItem, PlaybackState, SwitchReason, PreloadStatus, PlaybackSourceType } from '../types/reviewPlayback';
import type { ReviewTaskDetail, ReviewTaskShot } from '../types/review';
import type { LensDetailPayload } from '../types/lens';
import { lensService } from '../services/repositoryService';
import { loadAllFeedbacksForShot } from './reviewFrameFeedback';
import { resolveReviewParticipationMode } from './reviewParticipationMode';

/** 镜头详情缓存（减少重复拉取） */
const lensDetailCache = new Map<string, LensDetailPayload>();

export function clearLensDetailCache(): void {
  lensDetailCache.clear();
}

export function getCachedLensDetail(lensId: string): LensDetailPayload | undefined {
  return lensDetailCache.get(lensId);
}

export function setLensDetailCache(lensId: string, detail: LensDetailPayload): void {
  lensDetailCache.set(lensId, detail);
}

type PlaybackSourceProbe = {
  shotId: string;
  taskShotId: string;
  lensCode: string;
  sortOrder: number;
  submitVersionNum?: string | null;
  actualVersionNum?: string | null;
  feedbackCount: number;
};

function normalizeVersionKey(versionNum?: string | null): string {
  return (versionNum ?? '').trim().toUpperCase();
}

function extractVersionOrder(versionNum?: string | null): number {
  const normalized = normalizeVersionKey(versionNum);
  const match = normalized.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : Number.NEGATIVE_INFINITY;
}

function getVersionBindings(detail?: LensDetailPayload | null, versionNum?: string | null) {
  const target = normalizeVersionKey(versionNum);
  if (!detail || !target) return [];
  const version = detail.versions.find((item) => normalizeVersionKey(item.versionNum) === target);
  return version?.bindings ?? [];
}

function resolveVersionPreviewUrl(detail: LensDetailPayload | null | undefined, versionNum?: string | null): string | null {
  const bindings = getVersionBindings(detail, versionNum);
  const playable = bindings.find((binding) => binding.fileType === 'mov' && Boolean(binding.mediaPreviewUrl));
  return playable?.mediaPreviewUrl ?? null;
}

function resolveHighestPlayableVersion(detail: LensDetailPayload | null | undefined): { versionNum: string | null; videoSrc: string | null } {
  if (!detail?.versions?.length) {
    return { versionNum: null, videoSrc: null };
  }

  const ranked = [...detail.versions]
    .map((version) => ({
      versionNum: normalizeVersionKey(version.versionNum),
      order: extractVersionOrder(version.versionNum),
      videoSrc: version.bindings.find((binding) => binding.fileType === 'mov' && Boolean(binding.mediaPreviewUrl))?.mediaPreviewUrl ?? null,
    }))
    .filter((item) => Boolean(item.versionNum) && Boolean(item.videoSrc))
    .sort((a, b) => b.order - a.order || b.versionNum.localeCompare(a.versionNum));

  const top = ranked[0];
  return top ? { versionNum: top.versionNum, videoSrc: top.videoSrc } : { versionNum: null, videoSrc: null };
}

export interface ResolvedPlaybackSource {
  resolvedVideoSrc: string | null;
  resolvedSourceType: PlaybackSourceType;
  resolvedVersionNum: string | null;
  sourceLabel: string;
  sourceDescription: string;
  isPlayable: boolean;
  hasPlayableMedia: boolean;
}

export function resolvePlaybackSource(shot: PlaybackSourceProbe, lensDetail?: LensDetailPayload | null): ResolvedPlaybackSource {
  const actualVersion = normalizeVersionKey(shot.actualVersionNum);
  const submitVersion = normalizeVersionKey(shot.submitVersionNum);

  const actualVersionSrc = resolveVersionPreviewUrl(lensDetail, actualVersion);
  if (actualVersion && actualVersionSrc) {
    return {
      resolvedVideoSrc: actualVersionSrc,
      resolvedSourceType: 'submitted-version',
      resolvedVersionNum: actualVersion,
      sourceLabel: `使用指定版本 ${actualVersion}`,
      sourceDescription: `审片使用任务实际播放版本 ${actualVersion}`,
      isPlayable: true,
      hasPlayableMedia: true,
    };
  }

  const submitVersionSrc = resolveVersionPreviewUrl(lensDetail, submitVersion);
  if (submitVersion && submitVersionSrc) {
    return {
      resolvedVideoSrc: submitVersionSrc,
      resolvedSourceType: actualVersion && actualVersion !== submitVersion ? 'fallback-version' : 'submitted-version',
      resolvedVersionNum: submitVersion,
      sourceLabel: actualVersion && actualVersion !== submitVersion
        ? `未找到实际播放版本，已自动切换 ${submitVersion}`
        : `使用指定版本 ${submitVersion}`,
      sourceDescription: `审片使用提审版本 ${submitVersion}`,
      isPlayable: true,
      hasPlayableMedia: true,
    };
  }

  const highestPlayable = resolveHighestPlayableVersion(lensDetail);
  if (highestPlayable.videoSrc && highestPlayable.versionNum) {
    return {
      resolvedVideoSrc: highestPlayable.videoSrc,
      resolvedSourceType: 'fallback-version',
      resolvedVersionNum: highestPlayable.versionNum,
      sourceLabel: `未找到提审版本，已自动切换 ${highestPlayable.versionNum}`,
      sourceDescription: `审片使用该镜头最高可播放版本 ${highestPlayable.versionNum}`,
      isPlayable: true,
      hasPlayableMedia: true,
    };
  }

  const layoutVideoSrc = lensDetail?.lens?.layoutVideoPreviewUrl ?? null;
  if (layoutVideoSrc) {
    return {
      resolvedVideoSrc: layoutVideoSrc,
      resolvedSourceType: 'layout',
      resolvedVersionNum: normalizeVersionKey(lensDetail?.lens?.layoutVideoVersionNum) || null,
      sourceLabel: '无版本视频，已使用 Layout',
      sourceDescription: '当前镜头未匹配到版本视频，已回退到 Layout 视频补位',
      isPlayable: true,
      hasPlayableMedia: true,
    };
  }

  return {
    resolvedVideoSrc: null,
    resolvedSourceType: 'none',
    resolvedVersionNum: null,
    sourceLabel: '无可播放素材',
    sourceDescription: '版本视频与 Layout 视频均未解析到可播放地址',
    isPlayable: false,
    hasPlayableMedia: false,
  };
}

function buildResolvedPlaybackItem(shot: ReviewTaskShot, lensDetail?: LensDetailPayload | null): PlaybackItem {
  const resolved = resolvePlaybackSource(shot, lensDetail);
  const participationMode = resolveReviewParticipationMode(shot);
  return {
    shotId: shot.shotId,
    taskShotId: shot.taskShotId,
    lensCode: shot.lensCode,
    sequence: shot.sortOrder,
    submitVersionNum: shot.submitVersionNum ?? null,
    actualVersionNum: shot.actualVersionNum ?? null,
    videoSrc: resolved.resolvedVideoSrc,
    resolvedVideoSrc: resolved.resolvedVideoSrc,
    resolvedSourceType: resolved.resolvedSourceType,
    resolvedVersionNum: resolved.resolvedVersionNum,
    sourceLabel: resolved.sourceLabel,
    sourceDescription: resolved.sourceDescription,
    isPlayable: resolved.isPlayable,
    hasPlayableMedia: resolved.hasPlayableMedia,
    preloadStatus: resolved.isPlayable ? 'idle' : 'error',
    feedbackCount: shot.feedbackCount ?? 0,
    reviewParticipationMode: participationMode ?? undefined,
    playabilityStatus: resolved.isPlayable ? 'playable' : 'no-video',
    internalReviewStatusCode: shot.internalReviewStatusCode ?? null,
    internalReviewStatusName: shot.internalReviewStatusName ?? null,
  };
}

/**
 * 从任务详情构建播放列表
 * 以 taskDetail.shots 顺序为真相源，逐项构建 PlaybackItem
 */
export function buildPlaybackItems(taskDetail: ReviewTaskDetail): PlaybackItem[] {
  return taskDetail.shots.map((shot) => buildResolvedPlaybackItem(shot));
}

export async function buildPlaybackItemsWithLensDetails(taskDetail: ReviewTaskDetail): Promise<PlaybackItem[]> {
  const resolvedDetails = await Promise.all(
    taskDetail.shots.map(async (shot) => ({
      shot,
      detail: await getLensDetailWithCache(shot.shotId),
    })),
  );

  return resolvedDetails.map(({ shot, detail }) => buildResolvedPlaybackItem(shot, detail));
}

/**
 * 预加载指定镜头的 lens detail（用于提前解析 videoSrc）
 * 返回是否成功获取到视频地址
 */
export async function preloadLensDetail(shotId: string): Promise<{
  videoSrc: string | null;
  lensDetail: LensDetailPayload | null;
}> {
  const cached = lensDetailCache.get(shotId);
  if (cached) {
    return {
      videoSrc: cached.versions.find((version) => version.bindings.some((binding) => binding.fileType === 'mov' && Boolean(binding.mediaPreviewUrl)))?.bindings.find((binding) => binding.fileType === 'mov' && Boolean(binding.mediaPreviewUrl))?.mediaPreviewUrl ?? resolvePlaybackSource({ shotId, taskShotId: shotId, lensCode: '', sortOrder: 0, feedbackCount: 0 }, cached).resolvedVideoSrc,
      lensDetail: cached,
    };
  }

  try {
    const resp = await lensService.getLensDetail(shotId);
    if (resp.success && resp.detail) {
      lensDetailCache.set(shotId, resp.detail);
      return {
        videoSrc: resp.detail.versions.find((version) => version.bindings.some((binding) => binding.fileType === 'mov' && Boolean(binding.mediaPreviewUrl)))?.bindings.find((binding) => binding.fileType === 'mov' && Boolean(binding.mediaPreviewUrl))?.mediaPreviewUrl ?? resolvePlaybackSource({ shotId, taskShotId: shotId, lensCode: '', sortOrder: 0, feedbackCount: 0 }, resp.detail).resolvedVideoSrc,
        lensDetail: resp.detail,
      };
    }
  } catch {
    // Silently fail - preload failure should not block playback
  }

  return { videoSrc: null, lensDetail: null };
}

/**
 * 将预加载结果合并到播放列表项中
 */
export function applyPreloadResult(
  item: PlaybackItem,
  videoSrc: string | null,
  lensDetail: LensDetailPayload | null,
): PlaybackItem {
  const resolved = lensDetail ? resolvePlaybackSource({
    shotId: item.shotId,
    taskShotId: item.taskShotId,
    lensCode: item.lensCode,
    sortOrder: item.sequence,
    submitVersionNum: item.submitVersionNum,
    actualVersionNum: item.actualVersionNum,
    feedbackCount: item.feedbackCount,
  }, lensDetail) : null;
  return {
    ...item,
    videoSrc: videoSrc ?? item.videoSrc,
    resolvedVideoSrc: resolved?.resolvedVideoSrc ?? videoSrc ?? item.resolvedVideoSrc,
    resolvedSourceType: resolved?.resolvedSourceType ?? item.resolvedSourceType,
    resolvedVersionNum: resolved?.resolvedVersionNum ?? item.resolvedVersionNum,
    sourceLabel: resolved?.sourceLabel ?? item.sourceLabel,
    sourceDescription: resolved?.sourceDescription ?? item.sourceDescription,
    isPlayable: resolved?.isPlayable ?? Boolean(videoSrc),
    hasPlayableMedia: resolved?.hasPlayableMedia ?? item.hasPlayableMedia,
    preloadStatus: (resolved?.isPlayable ?? Boolean(videoSrc)) ? 'ready' : 'error',
    playabilityStatus: (resolved?.isPlayable ?? Boolean(videoSrc)) ? 'playable' : 'no-video',
  };
}

/**
 * 整体刷新：为播放列表中的指定范围镜头批量触发预加载
 * 返回更新后的 items 数组
 */
export async function preloadRange(
  items: PlaybackItem[],
  startIndex: number,
  count: number,
): Promise<PlaybackItem[]> {
  const updated = [...items];
  const endIndex = Math.min(startIndex + count, items.length);

  for (let i = startIndex; i < endIndex; i++) {
    const item = updated[i];
    if (item.preloadStatus !== 'idle' || item.isPlayable === false) continue;

    updated[i] = { ...item, preloadStatus: 'loading' };

    const { videoSrc, lensDetail } = await preloadLensDetail(item.shotId);

    if (lensDetail) {
      setLensDetailCache(item.shotId, lensDetail);
    }

    updated[i] = applyPreloadResult(updated[i], videoSrc, lensDetail);
  }

  return updated;
}

/**
 * 切换播放状态
 */
export function createSwitchState(
  prev: PlaybackState,
  nextIndex: number,
  reason: SwitchReason,
): PlaybackState {
  return {
    ...prev,
    currentIndex: nextIndex,
    switchReason: reason,
    player: {
      ...prev.player,
      playing: false,
      paused: false,
      currentTime: 0,
      duration: 0,
    },
  };
}

/**
 * 获取镜头详情（带缓存）
 */
export async function getLensDetailWithCache(shotId: string): Promise<LensDetailPayload | null> {
  const cached = lensDetailCache.get(shotId);
  if (cached) return cached;

  try {
    const resp = await lensService.getLensDetail(shotId);
    if (resp.success && resp.detail) {
      lensDetailCache.set(shotId, resp.detail);
      return resp.detail;
    }
  } catch {
    // Silently fail
  }

  return null;
}

/**
 * 获取镜头反馈列表
 */
export async function fetchReviewFeedbacks(shotId: string) {
  const view = await loadAllFeedbacksForShot(shotId);
  return view.feedbacks;
}
