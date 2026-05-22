/**
 * 审片工作台 - 任务级连播类型定义
 *
 * 本文件定义"播放列表 + 当前播放项 + 预加载项 + 切换原因"的正式状态模型。
 * 与 review.ts（任务/反馈类型）和 localDraft.ts（草稿类型）并列，职责分离。
 */
import type { InternalReviewStatusCode } from '../lib/internalReview';
import type { ReviewParticipationMode } from './review';

/** 播放源类型 */
export type PlaybackSourceType = 'submitted-version' | 'fallback-version' | 'layout' | 'none';

/** 预加载状态 */
export type PreloadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** 镜头可播放性分类 */
export type PlayabilityStatus = 'playable' | 'no-video' | 'loading';

/** 播放列表中的单镜头项（预解析后的播放上下文） */
export interface PlaybackItem {
  shotId: string;
  taskShotId: string;
  lensCode: string;
  sequence: number;
  submitVersionNum?: string | null;
  actualVersionNum?: string | null;
  /** 解析后的视频 URL，null 表示无可播放素材 */
  videoSrc: string | null;
  /** 解析后的真实视频 URL，作为最终播放依据 */
  resolvedVideoSrc: string | null;
  /** 解析后的播放源类型 */
  resolvedSourceType: PlaybackSourceType;
  /** 实际使用的版本号 */
  resolvedVersionNum: string | null;
  /** 播放来源提示文案 */
  sourceLabel: string;
  /** 播放来源说明 */
  sourceDescription: string;
  /** 最终是否可播放（仅看 resolvedVideoSrc） */
  isPlayable: boolean;
  /** 旧字段：仅作弱提示，不可直接作为最终可播判断 */
  hasPlayableMedia: boolean;
  /** 预加载状态 */
  preloadStatus: PreloadStatus;
  /** 镜头在服务端的反馈数量 */
  feedbackCount: number;
  /** 任务镜头参与类型，context 仅播放不参与正式审片 */
  reviewParticipationMode?: ReviewParticipationMode;
  /** 播放就绪状态 */
  playabilityStatus: PlayabilityStatus;
  /** 镜头内部审片二级状态 */
  internalReviewStatusCode?: InternalReviewStatusCode | null;
  /** 镜头内部审片二级状态显示名 */
  internalReviewStatusName?: string | null;
}

/** 切换原因 */
export type SwitchReason =
  | 'initial'
  | 'auto-next'
  | 'user-queue-click'
  | 'user-prev'
  | 'user-next';

/** 播放器状态（与 UI 渲染无关的播放控制核心态） */
export interface PlayerState {
  /** 是否正在播放（播放中=true，暂停/停止=false） */
  playing: boolean;
  /** 是否处于暂停态（暂停态=true，播放中或停止=false） */
  paused: boolean;
  /** 当前播放时间（秒） */
  currentTime: number;
  /** 当前视频总时长（秒） */
  duration: number;
  /** 播放速率 */
  playbackRate: number;
}

/** 播放队列完整状态 */
export interface PlaybackState {
  items: PlaybackItem[];
  currentIndex: number;
  switchReason: SwitchReason;
  player: PlayerState;
}

/** 构建播放列表项的初始状态 */
export function createPlaybackItem(shot: {
  shotId: string;
  taskShotId: string;
  lensCode: string;
  sequence: number;
  submitVersionNum?: string | null;
  actualVersionNum?: string | null;
  feedbackCount: number;
  reviewParticipationMode?: ReviewParticipationMode;
}): PlaybackItem {
  return {
    shotId: shot.shotId,
    taskShotId: shot.taskShotId,
    lensCode: shot.lensCode,
    sequence: shot.sequence,
    submitVersionNum: shot.submitVersionNum ?? null,
    actualVersionNum: shot.actualVersionNum ?? null,
    videoSrc: null,
    resolvedVideoSrc: null,
    resolvedSourceType: 'none',
    resolvedVersionNum: null,
    sourceLabel: '等待解析',
    sourceDescription: '等待镜头详情匹配结果',
    isPlayable: false,
    hasPlayableMedia: Boolean(shot.feedbackCount >= 0),
    preloadStatus: 'idle',
    feedbackCount: shot.feedbackCount ?? 0,
    reviewParticipationMode: shot.reviewParticipationMode ?? 'review',
    playabilityStatus: 'loading',
  };
}

/** 创建初始播放器状态 */
export function createInitialPlayerState(): PlayerState {
  return {
    playing: false,
    paused: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
  };
}

/** 创建初始播放状态 */
export function createInitialPlaybackState(): PlaybackState {
  return {
    items: [],
    currentIndex: 0,
    switchReason: 'initial',
    player: createInitialPlayerState(),
  };
}

/** 判断是否满足开始预加载条件（当前播放进度进入尾段） */
export function shouldPreloadNext(currentTime: number, duration: number, thresholdSeconds = 5): boolean {
  if (!duration || duration <= 0) return false;
  return duration - currentTime <= thresholdSeconds;
}

/** 判断是否还有下一镜头 */
export function hasNextShot(items: PlaybackItem[], currentIndex: number): boolean {
  return currentIndex >= 0 && currentIndex < items.length - 1;
}

/** 判断是否还有上一镜头 */
export function hasPrevShot(currentIndex: number): boolean {
  return currentIndex > 0;
}
