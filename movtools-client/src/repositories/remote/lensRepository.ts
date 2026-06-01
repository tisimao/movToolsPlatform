/**
 * 远程镜头仓储实现
 *
 * 通过 API Client 调用服务端 REST 接口。
 */
import { useProjectStore } from '../../stores/projectStore';
import type { ILensRepository } from '../types';
import type { LensDetailPayload, LensListResponse, LensRecord, LensStatus, LensStatusAction, LensVersionSnapshot, ServerLensDetailResponse, LensLifecycleEvent, LensFileBindingSyncRequest, LensFileBindingSyncResponse, LensBindingType, MakerMatchStatus, LensLifecycleAttachment } from '../../types/lens';
import type { FileCheckStatePayload, LensBoundFile, LensLayoutCandidate, LensLayoutVideoBinding, LayoutReferenceCheckRecord } from '../../types/fileCheck';
import type { LensMutationResponse, ResolveLensLocalPreviewResponse } from '../../types/ipc';
import type { ReviewFeedback } from '../../types/review';
import { apiClient } from '../../api/client';
import { resolveImageUrl } from '../../lib/imageUrl';
import { getInternalReviewStatusLabel, type InternalReviewStatusCode } from '../../lib/internalReview';
import type { UpdateReworkRecordRequest } from '../../types/ipc';

interface RemoteLensResponse {
  id: string;
  code: string;
  name: string;
  episodeId: string;
  status: string;
  sequence: number;
  singleFrame?: number;
  maker?: string | null;
  makerUserId?: string | null;
  makerNameRaw?: string | null;
  makerDisplayName?: string | null;
  makerMatchStatus?: MakerMatchStatus;
  description?: string | null;
  rootCode?: string | null;
  logicalPath?: string | null;
  versionTag?: string | null;
  layoutTag?: string | null;
  comment?: string | null;
  versionNum?: string;
  currentVersionReady?: boolean;
  currentVersionMatchedFileNames?: string[];
  layoutCandidateCount?: number;
  selectedLayoutFileName?: string;
  selectedLayoutRelativePath?: string;
  layoutReady?: boolean;
  layoutVideoReady?: boolean;
  layoutVideoFileName?: string;
  layoutVideoRelativePath?: string;
  layoutVideoAbsolutePath?: string;
  layoutVideoVersionNum?: string;
  layoutReferenceStatus?: string;
  layoutReferenceIssueCount?: number;
  latestFileBindingUpdatedAtUtc?: string | null;
  fileBindingCount?: number;
  internalReviewStatusCode?: InternalReviewStatusCode | null;
  internalReviewStatusName?: string | null;
  internalReviewUpdatedAtUtc?: string | null;
  latestReviewTaskId?: string | null;
  latestDirectorFeedbackAtUtc?: string | null;
  pendingDirectorFeedbackCount?: number;
  submissionAllowed?: boolean;
  isArchived: boolean;
  rowVersion: number;
  createdAtUtc: string;
  updatedAtUtc: string;
}

function mapReviewFeedbackResponse(feedback: any): ReviewFeedback {
  return {
    feedbackId: feedback.id,
    feedbackRoundId: feedback.feedbackRoundId ?? feedback.roundId ?? null,
    reviewTaskId: feedback.reviewTaskId ?? '',
    taskShotId: feedback.taskShotId ?? null,
    lensId: feedback.lensId ?? '',
    lensCode: feedback.lensCode ?? '',
    versionNum: feedback.versionNum ?? null,
    frameNumber: feedback.frameNumber ?? null,
    timecode: feedback.timecode ?? null,
    commentText: feedback.content ?? feedback.commentText ?? null,
    decisionCode: feedback.decisionCode ?? null,
    frameImagePath: resolveImageUrl(feedback.frameImagePath) ?? feedback.frameImagePath ?? null,
    annotatedImagePath: resolveImageUrl(feedback.annotatedImagePath) ?? feedback.annotatedImagePath ?? null,
    thumbnailPath: resolveImageUrl(feedback.thumbnailPath) ?? feedback.thumbnailPath ?? null,
    annotationDataJson: feedback.annotationDataJson ?? null,
    createdByDisplayName: feedback.createdByUserName ?? feedback.createdByDisplayName ?? null,
    createdAtUtc: feedback.createdAtUtc,
    updatedAtUtc: feedback.updatedAtUtc ?? null,
    decisionName: feedback.decisionName ?? feedback.decisionCode ?? null,
  };
}

interface RemoteLensStatusHistoryResponse {
  id: string;
  lensId: string;
  fromStatus: string;
  toStatus: string;
  changedByUserName: string;
  comment?: string | null;
  createdAtUtc: string;
}

interface RemoteRepairAttachmentResponse {
  id: string;
  lensId: string;
  lensStatusHistoryId?: string | null;
  fileName: string;
  originalName: string;
  fileSize: number;
  sortOrder: number;
  previewUrl: string;
  createdAtUtc: string;
}

function getActiveEpisodeId(): string | null {
  return useProjectStore.getState().activeEpisodeId;
}

function requireActiveEpisodeId(): string | null {
  return getActiveEpisodeId();
}

function mapServerStatusToClient(status: string): LensStatus {
  switch (status.toUpperCase()) {
    case 'WIP':
    case '制作':
      return '制作';
    case 'SUBMITTED':
    case '提交':
    case 'IN_REVIEW':
      return '提交';
    case 'REWORK':
    case 'REJECTED':
    case '返修':
      return '返修';
    case 'APPROVED':
    case '通过':
      return '通过';
    case 'CLOSED':
    case '关闭':
      return '关闭';
    default:
      return '制作';
  }
}

function mapActionToServerStatus(action: LensStatusAction, currentStatus?: LensStatus): string {
  switch (action) {
    case 'submit':
      return 'SUBMITTED';
    case 'approve':
      return 'APPROVED';
    case 'rework':
      return 'REWORK';
    case 'close':
      return 'CLOSED';
  }
}

function extractMakerFromDescription(description?: string | null): string {
  const value = description?.trim() ?? '';
  if (!value) {
    return '';
  }

  const matched = value.match(/(?:负责人|制作人员)[:：]\s*(.+)$/);
  return matched?.[1]?.trim() ?? '';
}

function getLensMakerMatchStatus(raw: RemoteLensResponse): MakerMatchStatus {
  if (raw.makerMatchStatus) {
    return raw.makerMatchStatus;
  }

  if (raw.makerUserId?.trim()) {
    return 'matched';
  }

  if ((raw.makerNameRaw ?? raw.maker ?? extractMakerFromDescription(raw.description)).trim()) {
    return 'unmatched';
  }

  return 'unassigned';
}

function getLensMakerDisplayName(raw: RemoteLensResponse, status: MakerMatchStatus): string {
  if (status === 'matched') {
    return raw.makerDisplayName?.trim() || raw.makerNameRaw?.trim() || raw.maker?.trim() || '';
  }

  if (status === 'unmatched') {
    return raw.makerNameRaw?.trim() || raw.maker?.trim() || extractMakerFromDescription(raw.description);
  }

  return '';
}

function normalizeOutgoingMakerPayload(request: {
  maker?: string | null;
  makerUserId?: string | null;
  makerNameRaw?: string | null;
  makerMatchStatus?: MakerMatchStatus;
}): {
  makerUserId: string | null;
  makerNameRaw: string | null;
  makerMatchStatus: MakerMatchStatus;
} {
  const makerUserId = request.makerUserId?.trim() || null;
  const makerNameRaw = request.makerNameRaw?.trim() || request.maker?.trim() || null;
  const makerMatchStatus = request.makerMatchStatus ?? (makerUserId ? 'matched' : makerNameRaw ? 'unmatched' : 'unassigned');

  return {
    makerUserId,
    makerNameRaw,
    makerMatchStatus: makerUserId ? 'matched' : makerMatchStatus,
  };
}

function normalizeVersionKey(versionNum?: string | null): string {
  return (versionNum ?? '').trim().toUpperCase() || '1';
}

function extractVersionOrder(versionNum?: string | null): number {
  const normalized = normalizeVersionKey(versionNum);
  const matched = normalized.match(/(\d+)/);
  return matched ? Number.parseInt(matched[1], 10) || 0 : 0;
}

function isVersionedBindingType(bindingType: LensBindingType): bindingType is 'ma' | 'mov' {
  return bindingType === 'ma' || bindingType === 'mov';
}

function mapServerBindingToVersionBinding(binding: LensFileBindingSyncResponse): LensVersionSnapshot['bindings'][number] | null {
  if (!isVersionedBindingType(binding.bindingType)) {
    return null;
  }

  const fileName = binding.fileName ?? binding.relativePath.split(/[\\/]/).pop() ?? binding.relativePath;
  return {
    fileId: binding.bindingId,
    lensCode: binding.lensCode,
    versionNum: normalizeVersionKey(binding.versionNum),
    fileType: binding.bindingType,
    relativePath: binding.relativePath,
    bindTime: binding.bindTime,
    absolutePath: binding.relativePath,
    exists: true,
    sourceRoot: binding.sourceRoot ?? undefined,
    bindingId: binding.bindingId,
    lensId: binding.lensId,
    bindingType: binding.bindingType,
    fileName,
  };
}

function mapLocalBindingToVersionBinding(binding: LensBoundFile): LensVersionSnapshot['bindings'][number] {
  const fileName = binding.fileName ?? binding.relativePath.split(/[\\/]/).pop() ?? binding.relativePath;
  return {
    fileId: binding.fileId,
    bindingId: binding.bindingId,
    lensId: binding.lensId,
    lensCode: binding.lensCode,
    versionNum: normalizeVersionKey(binding.versionNum),
    fileType: binding.fileType,
    bindingType: binding.bindingType ?? binding.fileType,
    fileName,
    relativePath: binding.relativePath,
    bindTime: binding.bindTime,
    absolutePath: binding.absolutePath,
    exists: binding.exists !== false,
    sourceRoot: binding.sourceRoot ?? undefined,
  };
}

function getVersionBindingKey(binding: Pick<LensVersionSnapshot['bindings'][number], 'fileType' | 'versionNum'>): string {
  return `${binding.fileType}:${normalizeVersionKey(binding.versionNum)}`;
}

function mergeVersionBindings(
  serverBindings: LensVersionSnapshot['bindings'],
  localBindings: LensVersionSnapshot['bindings'],
): LensVersionSnapshot['bindings'] {
  const merged = new Map<string, LensVersionSnapshot['bindings'][number]>();

  for (const binding of serverBindings) {
    merged.set(getVersionBindingKey(binding), binding);
  }

  for (const binding of localBindings) {
    const key = getVersionBindingKey(binding);
    const existing = merged.get(key);
    merged.set(key, existing ? {
      ...existing,
      absolutePath: binding.absolutePath,
      exists: binding.exists,
      sourceRoot: existing.sourceRoot ?? binding.sourceRoot,
      fileName: existing.fileName ?? binding.fileName,
      bindTime: existing.bindTime || binding.bindTime,
    } : binding);
  }

  return [...merged.values()].sort((left, right) => {
    const versionDiff = extractVersionOrder(right.versionNum) - extractVersionOrder(left.versionNum);
    if (versionDiff !== 0) {
      return versionDiff;
    }
    return left.fileType.localeCompare(right.fileType);
  });
}

function buildVersionSnapshotsFromBindings(
  detail: ServerLensDetailResponse,
  currentVersionNum: string,
  mergedBindings: LensVersionSnapshot['bindings'],
): LensVersionSnapshot[] {
  const bindingGroups = new Map<string, LensVersionSnapshot['bindings']>();
  for (const binding of mergedBindings) {
    const versionKey = normalizeVersionKey(binding.versionNum || currentVersionNum);
    const list = bindingGroups.get(versionKey) ?? [];
    list.push({
      ...binding,
      versionNum: versionKey,
    });
    bindingGroups.set(versionKey, list);
  }

  const versions = detail.versions.map((version) => ({
    versionNum: normalizeVersionKey(version.versionNum),
    fileName: version.fileName ?? detail.lens.code,
    issues: version.issues.map((issue) => ({
      fileType: 'mov' as const,
      reason: issue.issueType as '未绑定' | '文件缺失' | '多候选待确认' | '帧数不匹配',
      message: issue.description,
      candidatePaths: issue.filePath ? [issue.filePath] : undefined,
    })),
    bindings: bindingGroups.get(normalizeVersionKey(version.versionNum)) ?? [],
    matchDebug: {},
  }));

  const existingVersionKeys = new Set(versions.map((version) => version.versionNum));
  for (const [versionNum, bindings] of bindingGroups.entries()) {
    if (existingVersionKeys.has(versionNum)) {
      continue;
    }
    versions.push({
      versionNum,
      fileName: detail.lens.logicalPath ? detail.lens.logicalPath.split(/[\\/]/).pop() ?? detail.lens.code : detail.lens.code,
      issues: [],
      bindings,
      matchDebug: {},
    });
  }

  return versions.sort((left, right) => extractVersionOrder(right.versionNum) - extractVersionOrder(left.versionNum));
}

function resolveCurrentVersionNum(
  detail: ServerLensDetailResponse,
  mergedBindings: LensVersionSnapshot['bindings'],
): string {
  const bindingVersions = mergedBindings.map((binding) => normalizeVersionKey(binding.versionNum));
  if (bindingVersions.length > 0) {
    return bindingVersions.sort((left, right) => extractVersionOrder(right) - extractVersionOrder(left))[0];
  }

  const detailVersions = detail.versions.map((version) => normalizeVersionKey(version.versionNum));
  if (detailVersions.length > 0) {
    return detailVersions.sort((left, right) => extractVersionOrder(right) - extractVersionOrder(left))[0];
  }

  if (detail.lens.versionNum?.trim()) {
    return normalizeVersionKey(detail.lens.versionNum);
  }

  return normalizeVersionKey(detail.lens.versionTag);
}

function mapServerLayoutCandidates(detail: ServerLensDetailResponse): LensLayoutCandidate[] {
  return detail.layoutCandidates.map((candidate) => ({
    candidateId: candidate.relativePath,
    lensCode: detail.lens.code,
    fileName: candidate.fileName,
    relativePath: candidate.relativePath,
    absolutePath: candidate.relativePath,
    bindTime: candidate.scannedAt,
    exists: true,
    isSelected: detail.currentLayout?.fileName === candidate.fileName,
    source: 'auto-scan' as const,
  }));
}

function mergeLayoutCandidates(
  localCandidates: LensLayoutCandidate[],
  serverCandidates: LensLayoutCandidate[],
  currentLayoutFileName?: string | null,
): LensLayoutCandidate[] {
  const baseCandidates = serverCandidates.length > 0 ? serverCandidates : localCandidates;
  const localCandidateLookup = new Map<string, LensLayoutCandidate>();
  for (const candidate of localCandidates) {
    localCandidateLookup.set(candidate.candidateId, candidate);
    localCandidateLookup.set(candidate.fileName.trim().toUpperCase(), candidate);
    localCandidateLookup.set(candidate.relativePath.trim().toUpperCase(), candidate);
  }

  const mergedCandidates = baseCandidates.map((candidate) => {
    const localCandidate = localCandidateLookup.get(candidate.candidateId)
      ?? localCandidateLookup.get(candidate.fileName.trim().toUpperCase())
      ?? localCandidateLookup.get(candidate.relativePath.trim().toUpperCase())
      ?? null;

    if (!localCandidate) {
      return candidate;
    }

    return {
      ...candidate,
      absolutePath: localCandidate.absolutePath,
      exists: localCandidate.exists,
      sourceRoot: localCandidate.sourceRoot ?? candidate.sourceRoot,
      isSelected: candidate.isSelected,
    };
  });

  const selectedCandidateId = mergedCandidates.find((candidate) => candidate.isSelected)?.candidateId;
  if (selectedCandidateId || !currentLayoutFileName) {
    return mergedCandidates;
  }

  return mergedCandidates.map((candidate) => ({
    ...candidate,
    isSelected: candidate.fileName === currentLayoutFileName,
  }));
}

function resolveLayoutVideoBinding(
  selectedLayoutCandidate: LensLayoutCandidate | null,
  layoutVideoBindings: LensLayoutVideoBinding[],
): LensLayoutVideoBinding | null {
  if (!selectedLayoutCandidate) {
    return null;
  }

  return layoutVideoBindings.find((binding) => binding.candidateId === selectedLayoutCandidate.candidateId) ?? null;
}

function buildRemotePreferredLayoutVideoState(
  detail: ServerLensDetailResponse,
  selectedLayoutVideoBinding: LensLayoutVideoBinding | null,
): Pick<LensRecord, 'layoutVideoReady' | 'layoutVideoFileName' | 'layoutVideoRelativePath' | 'layoutVideoAbsolutePath' | 'layoutVideoVersionNum'> {
  if (selectedLayoutVideoBinding?.exists) {
    return {
      layoutVideoReady: true,
      layoutVideoFileName: selectedLayoutVideoBinding.fileName,
      layoutVideoRelativePath: selectedLayoutVideoBinding.relativePath,
      layoutVideoAbsolutePath: selectedLayoutVideoBinding.absolutePath,
      layoutVideoVersionNum: normalizeVersionKey(selectedLayoutVideoBinding.fileName),
    };
  }

  return {
    layoutVideoReady: detail.currentLayout?.videoReady ?? false,
    layoutVideoFileName: detail.currentLayout?.videoFileName ?? '',
    layoutVideoRelativePath: detail.currentLayout?.videoRelativePath ?? '',
    layoutVideoAbsolutePath: '',
    layoutVideoVersionNum: detail.currentLayout?.videoFileName
      ? normalizeVersionKey(detail.currentLayout.videoFileName)
      : '',
  };
}

function mapServerLayoutReferenceCheck(detail: ServerLensDetailResponse, lensId: string): LayoutReferenceCheckRecord | undefined {
  if (!detail.layoutReferenceCheck) {
    return undefined;
  }

  return {
    checkId: `check-${lensId}`,
    episodeId: detail.lens.episodeId,
    lensCode: detail.lens.code,
    candidateId: detail.currentLayout?.fileName ?? '',
    layoutFileName: detail.currentLayout?.fileName ?? '',
    layoutRelativePath: detail.currentLayout?.relativePath ?? '',
    layoutAbsolutePath: detail.currentLayout?.relativePath ?? '',
    layoutExists: detail.currentLayout?.videoReady ?? false,
    status: detail.layoutReferenceCheck.missingReferences > 0 ? '存在缺失' as const : '正常' as const,
    issueCount: detail.layoutReferenceCheck.missingReferences,
    pathMissingCount: 0,
    fileMissingCount: detail.layoutReferenceCheck.missingReferences,
    fileNameMismatchCount: 0,
    checkedReferenceCount: detail.layoutReferenceCheck.totalReferences,
    lastCheckTime: new Date().toISOString(),
    issues: [],
  };
}

async function readLocalFileCheckState(): Promise<FileCheckStatePayload | null> {
  try {
    const state = await window.movtools.fileCheck.getState();
    return state.success ? state : null;
  } catch {
    return null;
  }
}

function applyLocalPreviewToVersions(
  versions: LensVersionSnapshot[],
  previewResponse?: ResolveLensLocalPreviewResponse,
): LensVersionSnapshot[] {
  if (!previewResponse?.success) {
    return versions;
  }

  const previewMap = new Map(previewResponse.movBindings.map((binding) => [binding.fileId, binding]));
  return versions.map((version) => ({
    ...version,
    bindings: version.bindings.map((binding) => {
      if (binding.fileType !== 'mov') {
        return binding;
      }
      const preview = previewMap.get(binding.fileId);
      if (!preview) {
        return binding;
      }
      if (preview.previewMode === 'proxy' && !preview.previewUrl) {
        return {
          ...binding,
          mediaPreviewMode: 'proxy',
          mediaPreviewNote: preview.previewNote,
          mediaPreviewProgressPercent: preview.previewProgressPercent,
        };
      }
      return {
        ...binding,
        mediaPreviewUrl: preview.previewUrl,
        mediaDurationSeconds: preview.durationSeconds,
        mediaFrameCount: preview.frameCount,
        mediaFps: preview.fps,
        mediaWidth: preview.width,
        mediaHeight: preview.height,
        mediaCodecName: preview.codecName,
        mediaCodecLongName: preview.codecLongName,
        mediaCodecProfile: preview.codecProfile,
        mediaPixelFormat: preview.pixelFormat,
        mediaPreviewMode: preview.previewMode,
        mediaPreviewNote: preview.previewNote,
        mediaPreviewProgressPercent: preview.previewProgressPercent,
      };
    }),
  }));
}

function applyLocalPreviewToLens(lens: LensRecord, previewResponse?: ResolveLensLocalPreviewResponse): LensRecord {
  if (!previewResponse?.success || !previewResponse.layoutVideo) {
    return lens;
  }

  if (previewResponse.layoutVideo.previewMode === 'proxy' && !previewResponse.layoutVideo.previewUrl) {
    return {
      ...lens,
      layoutVideoPreviewMode: 'proxy',
      layoutVideoPreviewNote: previewResponse.layoutVideo.previewNote,
      layoutVideoPreviewProgressPercent: previewResponse.layoutVideo.previewProgressPercent,
    };
  }

  return {
    ...lens,
    layoutVideoPreviewUrl: previewResponse.layoutVideo.previewUrl,
    layoutVideoDurationSeconds: previewResponse.layoutVideo.durationSeconds,
    layoutVideoFrameCount: previewResponse.layoutVideo.frameCount,
    layoutVideoFps: previewResponse.layoutVideo.fps,
    layoutVideoWidth: previewResponse.layoutVideo.width,
    layoutVideoHeight: previewResponse.layoutVideo.height,
    layoutVideoCodecName: previewResponse.layoutVideo.codecName,
    layoutVideoCodecLongName: previewResponse.layoutVideo.codecLongName,
    layoutVideoCodecProfile: previewResponse.layoutVideo.codecProfile,
    layoutVideoPixelFormat: previewResponse.layoutVideo.pixelFormat,
    layoutVideoPreviewMode: previewResponse.layoutVideo.previewMode,
    layoutVideoPreviewNote: previewResponse.layoutVideo.previewNote,
    layoutVideoPreviewProgressPercent: previewResponse.layoutVideo.previewProgressPercent,
  };
}

function mergeRemoteLensWithLocal(remoteLens: LensRecord, localLens: LensRecord): LensRecord {
  return {
    ...remoteLens,
    singleFrame: localLens.singleFrame > 0 ? localLens.singleFrame : remoteLens.singleFrame,
    fileName: localLens.fileName,
    currentVersionIssues: localLens.currentVersionIssues,
    currentVersionReady: localLens.currentVersionReady,
    currentVersionMatchedFileNames: localLens.currentVersionMatchedFileNames,
    layoutCandidateCount: localLens.layoutCandidateCount,
    selectedLayoutFileName: localLens.selectedLayoutFileName,
    selectedLayoutRelativePath: localLens.selectedLayoutRelativePath,
    layoutReady: localLens.layoutReady,
    layoutVideoReady: localLens.layoutVideoReady,
    layoutVideoFileName: localLens.layoutVideoFileName,
    layoutVideoRelativePath: localLens.layoutVideoRelativePath,
    layoutVideoAbsolutePath: localLens.layoutVideoAbsolutePath,
    layoutVideoVersionNum: localLens.layoutVideoVersionNum,
    layoutVideoPreviewUrl: localLens.layoutVideoPreviewUrl,
    layoutVideoDurationSeconds: localLens.layoutVideoDurationSeconds,
    layoutVideoFrameCount: localLens.layoutVideoFrameCount,
    layoutVideoFps: localLens.layoutVideoFps,
    layoutVideoWidth: localLens.layoutVideoWidth,
    layoutVideoHeight: localLens.layoutVideoHeight,
    layoutVideoCodecName: localLens.layoutVideoCodecName,
    layoutVideoCodecLongName: localLens.layoutVideoCodecLongName,
    layoutVideoCodecProfile: localLens.layoutVideoCodecProfile,
    layoutVideoPixelFormat: localLens.layoutVideoPixelFormat,
    layoutVideoPreviewMode: localLens.layoutVideoPreviewMode,
    layoutVideoPreviewNote: localLens.layoutVideoPreviewNote,
    layoutVideoPreviewProgressPercent: localLens.layoutVideoPreviewProgressPercent,
    layoutReferenceStatus: localLens.layoutReferenceStatus,
    layoutReferenceIssueCount: localLens.layoutReferenceIssueCount,
    layoutReferenceLastCheckTime: localLens.layoutReferenceLastCheckTime,
    recentStatusAction: localLens.recentStatusAction ?? remoteLens.recentStatusAction,
    recentStatusActionLabel: localLens.recentStatusActionLabel || remoteLens.recentStatusActionLabel,
    recentStatusActionTime: localLens.recentStatusActionTime || remoteLens.recentStatusActionTime,
  };
}

async function readLocalLensList(): Promise<LensListResponse | null> {
  try {
    const response = await window.movtools.lens.list();
    return response.success ? response : null;
  } catch {
    return null;
  }
}

function groupBindingsByVersion(bindings: LensFileBindingSyncResponse[], lensCode: string, fallbackVersionNum: string): Map<string, LensVersionSnapshot['bindings']> {
  const grouped = new Map<string, LensVersionSnapshot['bindings']>();
  for (const binding of bindings) {
    const mapped = mapServerBindingToVersionBinding(binding);
    if (!mapped) {
      continue;
    }

    const versionKey = normalizeVersionKey(binding.versionNum || fallbackVersionNum);
    const list = grouped.get(versionKey) ?? [];
    list.push({
      ...mapped,
      lensCode,
      versionNum: versionKey,
    });
    grouped.set(versionKey, list);
  }

  return grouped;
}

function mapHistoryToLifecycleEvent(item: RemoteLensStatusHistoryResponse, index: number, fileName: string) {
  return {
    eventId: item.id,
    lensId: item.lensId,
    eventType: '状态流转' as const,
    title: `${item.fromStatus} → ${item.toStatus}`,
    detail: item.comment ? `${item.changedByUserName}：${item.comment}` : `${item.changedByUserName} 执行状态流转`,
    fromStatus: mapServerStatusToClient(item.fromStatus),
    toStatus: mapServerStatusToClient(item.toStatus),
    versionNum: String(index + 1),
    fileName,
    eventTime: item.createdAtUtc,
    editable: false,
    attachments: [],
  };
}

function mapRepairAttachmentToLifecycleAttachment(item: RemoteRepairAttachmentResponse, eventId: string): LensLifecycleAttachment {
  const previewUrl = resolveImageUrl(item.previewUrl) || item.previewUrl;
  return {
    attachmentId: item.id,
    eventId,
    fileName: item.originalName || item.fileName,
    relativePath: previewUrl,
    absolutePath: previewUrl,
    previewUrl,
    createTime: item.createdAtUtc,
  };
}

function blobFromBase64(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

function buildRecentStatusSummary(lens: LensRecord, history: RemoteLensStatusHistoryResponse[]): Pick<LensRecord, 'recentStatusAction' | 'recentStatusActionLabel' | 'recentStatusActionTime'> {
  const latest = history[0];
  if (!latest) {
    return {
      recentStatusAction: lens.recentStatusAction,
      recentStatusActionLabel: lens.recentStatusActionLabel,
      recentStatusActionTime: lens.recentStatusActionTime,
    };
  }

  const normalizedStatus = mapServerStatusToClient(latest.toStatus);
  const action = normalizedStatus === '提交'
    ? 'submit'
    : normalizedStatus === '通过'
      ? 'approve'
      : normalizedStatus === '返修'
        ? 'rework'
        : normalizedStatus === '关闭'
          ? 'close'
          : undefined;

  const labelMap: Record<string, string> = {
    submit: '最近提交',
    approve: '最近通过',
    rework: '最近返修',
    close: '最近关闭',
  };

  return {
    recentStatusAction: action,
    recentStatusActionLabel: action ? labelMap[action] : lens.recentStatusActionLabel,
    recentStatusActionTime: latest.createdAtUtc,
  };
}

/**
 * 构建远程镜头的版本快照
 * 
 * 远程模式下，服务端只提供基础元数据。
 * 版本、绑定、Layout 候选等信息需要通过本地文件检查来补齐。
 */
function buildFallbackVersions(lens: RemoteLensResponse): LensVersionSnapshot[] {
  return [{
    versionNum: '1',
    fileName: lens.logicalPath ? lens.logicalPath.split(/[\\/]/).pop() ?? lens.code : lens.code,
    // 基础问题列表 - 基于本地文件检查结果填充
    issues: [],
    // 绑定记录 - 需要通过本地扫描补齐
    bindings: [],
    // 匹配调试信息 - 需要通过本地扫描补齐
    matchDebug: {},
  }];
}

function mapRemoteLensToLocal(raw: RemoteLensResponse): LensRecord {
  const makerMatchStatus = getLensMakerMatchStatus(raw);
  const makerNameRaw = raw.makerNameRaw?.trim() || raw.maker?.trim() || extractMakerFromDescription(raw.description) || '';
  const makerDisplayName = getLensMakerDisplayName(raw, makerMatchStatus);
  const maker = makerDisplayName || makerNameRaw;
  return {
    lensId: raw.id,
    episodeId: raw.episodeId,
    lensCode: raw.code,
    sceneNo: raw.sequence,
    lensName: raw.name,
    singleFrame: raw.singleFrame ?? 0,
    maker,
    makerUserId: raw.makerUserId ?? null,
    makerNameRaw: makerNameRaw || null,
    makerDisplayName: makerDisplayName || null,
    makerMatchStatus,
    note: raw.description ?? undefined,
    lensStatus: mapServerStatusToClient(raw.status),
    versionTag: raw.versionTag ?? '',
    versionNum: raw.versionNum ?? 'V01',
    fileName: raw.logicalPath ? raw.logicalPath.split(/[\\/]/).pop() ?? raw.code : raw.code,
    updateTime: raw.updatedAtUtc,
    currentVersionIssues: [],
    currentVersionReady: raw.currentVersionReady ?? false,
    currentVersionMatchedFileNames: raw.currentVersionMatchedFileNames ?? [],
    layoutCandidateCount: raw.layoutCandidateCount ?? 0,
    selectedLayoutFileName: raw.selectedLayoutFileName ?? '',
    selectedLayoutRelativePath: raw.selectedLayoutRelativePath ?? '',
    layoutReady: raw.layoutReady ?? false,
    layoutVideoReady: raw.layoutVideoReady ?? false,
    layoutVideoFileName: raw.layoutVideoFileName ?? '',
    layoutVideoRelativePath: raw.layoutVideoRelativePath ?? '',
    layoutVideoAbsolutePath: raw.layoutVideoAbsolutePath ?? '',
    layoutVideoVersionNum: raw.layoutVideoVersionNum ?? '',
    layoutReferenceStatus: (raw.layoutReferenceStatus as LensRecord['layoutReferenceStatus']) ?? '未检查',
    layoutReferenceIssueCount: raw.layoutReferenceIssueCount ?? 0,
    recentStatusActionLabel: '',
    recentStatusActionTime: '',
    // 根据2.0固化文档：二级状态由服务端主导。
    // 若服务端未返回（null/undefined），使用 ?? 保留已知状态，
    // 不可硬编码 'NOT_IN_REVIEW' 覆盖 DIRECTOR_APPROVED。
    internalReviewStatusCode: raw.internalReviewStatusCode ?? 'NOT_IN_REVIEW',
    internalReviewStatusName: raw.internalReviewStatusName ?? getInternalReviewStatusLabel(raw.internalReviewStatusCode ?? 'NOT_IN_REVIEW'),
    internalReviewUpdatedAtUtc: raw.internalReviewUpdatedAtUtc ?? null,
    latestReviewTaskId: raw.latestReviewTaskId ?? null,
    latestDirectorFeedbackAtUtc: raw.latestDirectorFeedbackAtUtc ?? null,
    pendingDirectorFeedbackCount: raw.pendingDirectorFeedbackCount ?? 0,
    submissionAllowed: raw.submissionAllowed ?? false,
  };
}

async function fetchRemoteLens(lensId: string): Promise<RemoteLensResponse> {
  return apiClient.get<RemoteLensResponse>(`/api/lenses/${lensId}`);
}

async function fetchRemoteLensHistory(lensId: string): Promise<RemoteLensStatusHistoryResponse[]> {
  try {
    return await apiClient.get<RemoteLensStatusHistoryResponse[]>(`/api/lenses/${lensId}/history`);
  } catch {
    return [];
  }
}

async function fetchRemoteRepairAttachments(lensId: string): Promise<RemoteRepairAttachmentResponse[]> {
  try {
    return await apiClient.get<RemoteRepairAttachmentResponse[]>(`/api/lenses/${lensId}/repair-attachments`);
  } catch {
    return [];
  }
}

async function fetchRemoteLensDetail(lensId: string): Promise<ServerLensDetailResponse> {
  return apiClient.get<ServerLensDetailResponse>(`/api/lenses/${lensId}/detail`);
}

async function fetchRemoteLensFeedbacks(lensId: string): Promise<ReviewFeedback[]> {
  try {
    const response = await apiClient.get<any>(`/api/review-feedbacks/lens/${lensId}`);
    if (Array.isArray(response)) {
      return response.map(mapReviewFeedbackResponse);
    }

    return Array.isArray(response?.feedbacks) ? response.feedbacks.map(mapReviewFeedbackResponse) : [];
  } catch {
    return [];
  }
}

class RemoteLensRepository implements ILensRepository {
  async listLenses(): Promise<LensListResponse> {
    const episodeId = requireActiveEpisodeId();
    if (!episodeId) {
      return {
        success: false,
        lenses: [],
        activeProjectId: null,
        activeEpisodeId: null,
        error: '请先选择一个集后再加载镜头列表',
      };
    }

    try {
      const response = await apiClient.get<RemoteLensResponse[]>(`/api/episodes/${episodeId}/lenses`);
      const remoteLenses = response.map(mapRemoteLensToLocal);

      const localResponse = await readLocalLensList();
      const localLensMap = new Map((localResponse?.lenses ?? []).map((lens) => [lens.lensId, lens]));

      return {
        success: true,
        lenses: remoteLenses.map((lens) => {
          const localLens = localLensMap.get(lens.lensId);
          return localLens ? mergeRemoteLensWithLocal(lens, localLens) : lens;
        }),
        autoInitializedLensIds: localResponse?.autoInitializedLensIds ?? [],
        activeProjectId: useProjectStore.getState().activeProjectId,
        activeEpisodeId: episodeId,
      };
    } catch (error) {
      return {
        success: false,
        lenses: [],
        activeProjectId: useProjectStore.getState().activeProjectId,
        activeEpisodeId: episodeId,
        error: error instanceof Error ? error.message : '获取镜头列表失败',
      };
    }
  }

  async getLensDetail(lensId: string): Promise<{ success: boolean; detail?: LensDetailPayload; error?: string }> {
    try {
      const detail = await fetchRemoteLensDetail(lensId);
      const localState = await readLocalFileCheckState();
      const localLensResponse = await readLocalLensList();
      const localLens = localLensResponse?.lenses.find((lens) => lens.lensId === lensId);
      const localBindings = (localState?.bindings[detail.lens.code] ?? []).map(mapLocalBindingToVersionBinding);
      const localLayoutCandidates = localState?.layoutCandidates[detail.lens.code] ?? [];
      const localLayoutVideoBindings = localState?.layoutVideoBindings[detail.lens.code] ?? [];
      const localLayoutReferenceCheck = localState?.layoutReferenceChecks.find((check) => check.lensCode === detail.lens.code);
      const remoteHistory = await fetchRemoteLensHistory(lensId);

      const serverVersionBindings = detail.fileBindings
        .map(mapServerBindingToVersionBinding)
        .filter((binding): binding is NonNullable<typeof binding> => binding !== null);
      const mergedBindings = mergeVersionBindings(serverVersionBindings, localBindings);
      const currentVersionNum = resolveCurrentVersionNum(detail, mergedBindings);
      const versions = buildVersionSnapshotsFromBindings(detail, currentVersionNum, mergedBindings);
      const currentVersionBindings = versions.find((version) => version.versionNum === currentVersionNum)?.bindings ?? [];

      const serverLayoutCandidates = mapServerLayoutCandidates(detail);
      const layoutCandidates = mergeLayoutCandidates(localLayoutCandidates, serverLayoutCandidates, detail.currentLayout?.fileName);
      const selectedLayoutCandidate = layoutCandidates.find((candidate) => candidate.isSelected) ?? layoutCandidates[0] ?? null;
      const selectedLayoutVideoBinding = detail.currentLayout
        ? localLayoutVideoBindings.find((binding) =>
          binding.candidateId === selectedLayoutCandidate?.candidateId
          || binding.fileName === detail.currentLayout?.videoFileName
          || binding.relativePath === detail.currentLayout?.videoRelativePath,
        ) ?? null
        : resolveLayoutVideoBinding(selectedLayoutCandidate, localLayoutVideoBindings);
      const resolvedLayoutVideo = buildRemotePreferredLayoutVideoState(detail, selectedLayoutVideoBinding);
      const layoutReferenceCheck = localLayoutReferenceCheck ?? mapServerLayoutReferenceCheck(detail, lensId);
      const repairAttachments = await fetchRemoteRepairAttachments(lensId);
      const directorFeedbacks = await fetchRemoteLensFeedbacks(lensId);

      let lens: LensRecord = {
        lensId: detail.lens.id,
        episodeId: detail.lens.episodeId,
        lensCode: detail.lens.code,
        sceneNo: detail.lens.sequence,
        lensName: detail.lens.name,
        singleFrame: detail.lens.singleFrame ?? 0,
        maker: detail.lens.makerDisplayName?.trim() || detail.lens.makerNameRaw?.trim() || '',
        makerUserId: detail.lens.makerUserId ?? null,
        makerNameRaw: detail.lens.makerNameRaw ?? null,
        makerDisplayName: detail.lens.makerDisplayName ?? null,
        makerMatchStatus: detail.lens.makerMatchStatus ?? (detail.lens.makerUserId ? 'matched' : detail.lens.makerNameRaw ? 'unmatched' : 'unassigned'),
        note: detail.lens.description ?? undefined,
        lensStatus: mapServerStatusToClient(detail.lens.status),
        versionTag: detail.lens.versionTag ?? '',
        versionNum: currentVersionNum,
        fileName: detail.lens.logicalPath ? detail.lens.logicalPath.split(/[\\/]/).pop() ?? detail.lens.code : detail.lens.code,
        updateTime: detail.lens.updatedAtUtc,
        currentVersionIssues: [],
        currentVersionReady: currentVersionBindings.length > 0,
        currentVersionMatchedFileNames: currentVersionBindings.map((binding) => binding.fileName ?? binding.relativePath.split(/[\\/]/).pop() ?? binding.relativePath),
        layoutCandidateCount: layoutCandidates.length,
        selectedLayoutFileName: detail.currentLayout?.fileName ?? selectedLayoutCandidate?.fileName ?? '',
        selectedLayoutRelativePath: detail.currentLayout?.relativePath ?? selectedLayoutCandidate?.relativePath ?? '',
        layoutReady: Boolean(selectedLayoutCandidate ?? detail.currentLayout),
        layoutVideoReady: resolvedLayoutVideo.layoutVideoReady,
        layoutVideoFileName: resolvedLayoutVideo.layoutVideoFileName,
        layoutVideoRelativePath: resolvedLayoutVideo.layoutVideoRelativePath,
        layoutVideoAbsolutePath: resolvedLayoutVideo.layoutVideoAbsolutePath,
        layoutVideoVersionNum: resolvedLayoutVideo.layoutVideoVersionNum,
        layoutReferenceStatus: layoutReferenceCheck?.status ?? '未检查',
        layoutReferenceIssueCount: layoutReferenceCheck?.issueCount ?? 0,
        layoutReferenceLastCheckTime: layoutReferenceCheck?.lastCheckTime,
        recentStatusActionLabel: '',
        recentStatusActionTime: '',
        // 服务端返回的 internalReviewStatusCode 是唯一真相源。
        // localLens 仅作为服务端未返回时的中间回退，不可默认 NOT_IN_REVIEW 覆盖 DIRECTOR_APPROVED。
        internalReviewStatusCode: detail.lens.internalReviewStatusCode ?? localLens?.internalReviewStatusCode ?? 'NOT_IN_REVIEW',
        internalReviewStatusName: detail.lens.internalReviewStatusName ?? localLens?.internalReviewStatusName ?? getInternalReviewStatusLabel(detail.lens.internalReviewStatusCode ?? localLens?.internalReviewStatusCode ?? 'NOT_IN_REVIEW'),
        internalReviewUpdatedAtUtc: detail.lens.internalReviewUpdatedAtUtc ?? localLens?.internalReviewUpdatedAtUtc ?? null,
        latestReviewTaskId: detail.lens.latestReviewTaskId ?? localLens?.latestReviewTaskId ?? null,
        latestDirectorFeedbackAtUtc: detail.lens.latestDirectorFeedbackAtUtc ?? localLens?.latestDirectorFeedbackAtUtc ?? null,
        pendingDirectorFeedbackCount: detail.lens.pendingDirectorFeedbackCount ?? localLens?.pendingDirectorFeedbackCount ?? 0,
        submissionAllowed: detail.lens.submissionAllowed ?? localLens?.submissionAllowed ?? false,
      };

      if (localLens) {
        lens = mergeRemoteLensWithLocal(lens, localLens);
      }

      const previewResponse = await window.movtools.lens.resolveLocalPreview({
        movBindings: mergedBindings
          .filter((binding) => binding.fileType === 'mov' && binding.exists && binding.absolutePath)
          .map((binding) => ({
            fileId: binding.fileId,
            absolutePath: binding.absolutePath,
            exists: binding.exists,
          })),
        layoutVideoAbsolutePath: lens.layoutVideoAbsolutePath || undefined,
        forceProxyPreviewTargets: [
          ...(mergedBindings.some((binding) => binding.fileType === 'mov' && binding.exists) ? ['production' as const] : []),
          ...(lens.layoutVideoAbsolutePath ? ['layout' as const] : []),
        ],
      });

      const previewedVersions = applyLocalPreviewToVersions(versions, previewResponse);
      lens = applyLocalPreviewToLens(lens, previewResponse);
      lens = {
        ...lens,
        ...buildRecentStatusSummary(lens, remoteHistory),
        internalReviewStatusName: getInternalReviewStatusLabel(lens.internalReviewStatusCode ?? 'NOT_IN_REVIEW', lens.internalReviewStatusName),
      };

      const history = remoteHistory.map((item, index) => ({
        ...mapHistoryToLifecycleEvent(item, index, lens.fileName),
        attachments: repairAttachments
          .filter((attachment) => attachment.lensStatusHistoryId === item.id)
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((attachment) => mapRepairAttachmentToLifecycleAttachment(attachment, item.id)),
      }));

      return {
        success: true,
        detail: {
          lens,
          versions: previewedVersions,
          history,
          layoutCandidates,
          serverBindings: detail.fileBindings,
          layoutReferenceCheck,
          directorFeedbacks,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取镜头详情失败',
      };
    }
  }

  async syncLensFileBinding(lensId: string, request: LensFileBindingSyncRequest): Promise<LensMutationResponse> {
    const episodeId = requireActiveEpisodeId();
    if (!episodeId) {
      return { success: false, error: '请先选择一个集后再同步文件绑定' };
    }

    try {
      const response = await apiClient.post<LensFileBindingSyncResponse>(`/api/lenses/${lensId}/bindings`, {
        bindingType: request.bindingType,
        relativePath: request.relativePath,
        sourceRoot: request.sourceRoot ?? null,
        versionNum: request.versionNum ?? null,
        fileName: request.fileName ?? null,
      });

      return {
        success: true,
        binding: {
          bindingId: response.bindingId,
          lensId: response.lensId,
          lensCode: response.lensCode,
          fileId: response.bindingId,
          fileType: response.bindingType as 'ma' | 'mov',
          bindingType: response.bindingType,
          versionNum: normalizeVersionKey(response.versionNum),
          fileName: response.fileName ?? response.relativePath.split(/[\\/]/).pop() ?? response.relativePath,
          relativePath: response.relativePath,
          bindTime: response.bindTime,
          absolutePath: response.relativePath,
          exists: true,
          sourceRoot: response.sourceRoot ?? null,
        },
      };
    } catch (error) {
      const err = error as Error & { status?: number };
      if (err.status === 409) {
        return { success: false, error: '文件绑定与服务端现有记录冲突，请刷新后重试。' };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : '同步文件绑定失败',
      };
    }
  }

  async deleteLensFileBinding(lensId: string, bindingType: 'ma' | 'mov' | 'layout' | 'layoutVideo', versionNum?: string | null): Promise<LensMutationResponse> {
    const episodeId = requireActiveEpisodeId();
    if (!episodeId) {
      return { success: false, error: '请先选择一个集后再删除文件绑定' };
    }

    try {
      const params = new URLSearchParams();
      params.set('bindingType', bindingType);
      if (versionNum != null && versionNum !== '') {
        params.set('versionNum', versionNum);
      }

      await apiClient.request(`/api/lenses/${lensId}/bindings?${params.toString()}`, {
        method: 'DELETE',
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除文件绑定失败',
      };
    }
  }

  async createLens(request: {
    lensCode: string;
    sceneNo?: number;
    lensName?: string;
    singleFrame: number;
    maker?: string;
    makerUserId?: string | null;
    makerNameRaw?: string | null;
    makerMatchStatus?: MakerMatchStatus;
    note?: string;
    lensStatus: LensStatus;
    versionTag?: string;
    versionNum?: string;
    fileName?: string;
  }): Promise<LensMutationResponse> {
    const episodeId = requireActiveEpisodeId();
    if (!episodeId) {
      return { success: false, error: '请先选择一个集后再创建镜头' };
    }

    try {
      const makerPayload = normalizeOutgoingMakerPayload(request);
      const response = await apiClient.post<RemoteLensResponse>(`/api/episodes/${episodeId}/lenses`, {
        code: request.lensCode,
        name: request.lensName ?? request.lensCode,
        sequence: request.sceneNo ?? request.singleFrame,
        singleFrame: request.singleFrame,
        makerUserId: makerPayload.makerUserId,
        makerNameRaw: makerPayload.makerNameRaw,
        makerMatchStatus: makerPayload.makerMatchStatus,
        description: request.note ?? request.fileName ?? null,
        rootCode: null,
        logicalPath: null,
        versionTag: request.versionTag,
        layoutTag: null,
      });
      return { success: true, lens: mapRemoteLensToLocal(response) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '创建镜头失败',
      };
    }
  }

  async updateLens(lensId: string, request: {
    lensCode: string;
    sceneNo?: number;
    lensName?: string;
    singleFrame: number;
    maker?: string;
    makerUserId?: string | null;
    makerNameRaw?: string | null;
    makerMatchStatus?: MakerMatchStatus;
    note?: string;
    lensStatus: LensStatus;
    versionTag?: string;
    versionNum?: string;
    fileName?: string;
  }): Promise<LensMutationResponse> {
    const episodeId = requireActiveEpisodeId();
    if (!episodeId) {
      return { success: false, error: '请先选择一个集后再更新镜头' };
    }

    try {
      const currentLens = await fetchRemoteLens(lensId);
      const makerPayload = normalizeOutgoingMakerPayload(request);
      const response = await apiClient.request<RemoteLensResponse>(`/api/lenses/${lensId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: request.lensName ?? request.lensCode,
          singleFrame: request.singleFrame,
          makerUserId: makerPayload.makerUserId,
          makerNameRaw: makerPayload.makerNameRaw,
          makerMatchStatus: makerPayload.makerMatchStatus,
          description: request.note ?? request.fileName ?? null,
          rootCode: null,
          logicalPath: null,
          versionTag: request.versionTag,
          layoutTag: null,
          comment: request.note ?? null,
          rowVersion: currentLens.rowVersion,
        }),
      });
      return { success: true, lens: mapRemoteLensToLocal(response) };
    } catch (error) {
      const err = error as Error & { status?: number };
      if (err.status === 409) {
        return { success: false, error: '该镜头已被其他人修改，请刷新后重新编辑' };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : '更新镜头失败',
      };
    }
  }

  async updateLensStatus(lensId: string, action: LensStatusAction, note?: string, imagePaths?: string[]): Promise<LensMutationResponse> {
    const episodeId = requireActiveEpisodeId();
    if (!episodeId) {
      return { success: false, error: '请先选择一个集后再更新状态' };
    }

    try {
      const currentLens = await fetchRemoteLens(lensId);
      const nextStatus = mapActionToServerStatus(action, mapServerStatusToClient(currentLens.status));
      await apiClient.request(`/api/lenses/${lensId}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          newStatus: nextStatus,
          comment: note,
          rowVersion: currentLens.rowVersion,
        }),
      });

      if (action === 'rework' && imagePaths?.length) {
        const history = await fetchRemoteLensHistory(lensId);
        const latestHistory = history[0];
        if (latestHistory) {
          for (let index = 0; index < imagePaths.length; index += 1) {
            const uploadResult = await this.uploadRepairAttachment(lensId, imagePaths[index], index, latestHistory.id);
            if (!uploadResult.success) {
              return uploadResult;
            }
          }
        }
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '状态更新失败',
      };
    }
  }

  async updateInternalReviewStatus(lensId: string, targetStatusCode: InternalReviewStatusCode, note?: string): Promise<LensMutationResponse> {
    const episodeId = requireActiveEpisodeId();
    if (!episodeId) {
      return { success: false, error: '请先选择一个集后再更新二级状态' };
    }

    try {
      const currentLens = await fetchRemoteLens(lensId);
      await apiClient.request(`/api/lenses/${lensId}/internal-review-status`, {
        method: 'PUT',
        body: JSON.stringify({
          targetStatusCode,
          comment: note,
          rowVersion: currentLens.rowVersion,
        }),
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '更新二级状态失败',
      };
    }
  }

  async batchUpdateLensStatus(lensIds: string[], action: LensStatusAction, note?: string, imagePaths?: string[]): Promise<LensMutationResponse> {
    if (!lensIds.length) {
      return { success: true };
    }

    for (const lensId of lensIds) {
      const result = await this.updateLensStatus(lensId, action, note, imagePaths);
      if (!result.success) {
        return result;
      }
    }

    return { success: true };
  }

  async uploadRepairAttachment(lensId: string, filePath: string, sortOrder: number, lensStatusHistoryId?: string | null): Promise<LensMutationResponse> {
    const fileResponse = await window.movtools.file.readBase64({ path: filePath });
    if (!fileResponse.success || !fileResponse.base64 || !fileResponse.fileName) {
      return { success: false, error: fileResponse.error || '读取返修图片失败' };
    }

    const formData = new FormData();
    if (lensStatusHistoryId) {
      formData.append('LensStatusHistoryId', lensStatusHistoryId);
    }
    formData.append('SortOrder', String(sortOrder));
    formData.append('File', blobFromBase64(fileResponse.base64, fileResponse.mimeType || 'application/octet-stream'), fileResponse.fileName);

    await apiClient.request(`/api/lenses/${lensId}/repair-attachments`, {
      method: 'POST',
      body: formData,
    });

    return { success: true };
  }

  async updateReworkRecord(request: UpdateReworkRecordRequest): Promise<LensMutationResponse> {
    try {
      if (request.note !== undefined) {
        await apiClient.request(`/api/lenses/${request.lensId}/history/${request.eventId}`, {
          method: 'PUT',
          body: JSON.stringify({ comment: request.note }),
        });
      }

      const attachments = await fetchRemoteRepairAttachments(request.lensId);
      const eventAttachments = attachments.filter((attachment) => attachment.lensStatusHistoryId === request.eventId);
      const orderedKeptIds = (request.keepAttachmentIds ?? eventAttachments.map((attachment) => attachment.id)).filter(Boolean);
      const kept = new Set(orderedKeptIds);
      const toRemove = eventAttachments.filter((attachment) => !kept.has(attachment.id));
      for (const attachment of toRemove) {
        await apiClient.request(`/api/lenses/${request.lensId}/repair-attachments/${attachment.id}`, { method: 'DELETE' });
      }

      for (let index = 0; index < orderedKeptIds.length; index += 1) {
        const attachmentId = orderedKeptIds[index];
        await apiClient.request(`/api/lenses/${request.lensId}/repair-attachments/${attachmentId}/sort-order`, {
          method: 'PUT',
          body: JSON.stringify({ sortOrder: index }),
        });
      }

      const history = await fetchRemoteLensHistory(request.lensId);
      const targetHistory = history.find((item) => item.id === request.eventId) ?? history[0];
      if (!targetHistory) {
        return { success: false, error: '未找到对应的返修记录' };
      }
      if (request.newImagePaths?.length) {
        const baseSortOrder = eventAttachments.filter((attachment) => kept.has(attachment.id)).length;
        for (let index = 0; index < request.newImagePaths.length; index += 1) {
          const uploadResult = await this.uploadRepairAttachment(request.lensId, request.newImagePaths[index], index + baseSortOrder, targetHistory.id);
          if (!uploadResult.success) {
            return uploadResult;
          }
        }
      }

      const refreshed = await fetchRemoteLens(request.lensId);
      return { success: true, lens: mapRemoteLensToLocal(refreshed) };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '返修记录更新失败',
      };
    }
  }

  async deleteLens(lensId: string): Promise<LensMutationResponse> {
    return {
      success: false,
      error: '协同模式下当前未开放删除镜头接口。',
    };
  }

  async batchDeleteLenses(lensIds: string[]): Promise<LensMutationResponse> {
    for (const lensId of lensIds) {
      const result = await this.deleteLens(lensId);
      if (!result.success) {
        return result;
      }
    }
    return { success: true };
  }

  async importLenses(filePath: string): Promise<LensMutationResponse> {
    return {
      success: false,
      error: `协同模式下当前未开放导入镜头接口：${filePath}`,
    };
  }

  async exportIssueReport(lensIds: string[], mode?: 'all-issues' | 'missing-layout'): Promise<{ success: boolean; filePath?: string; exportedCount?: number; error?: string }> {
    return {
      success: false,
      error: `协同模式下当前未开放导出问题报告接口（${mode ?? 'all-issues'} / ${lensIds.length}）。`,
    };
  }
}

export const remoteLensRepository = new RemoteLensRepository();
