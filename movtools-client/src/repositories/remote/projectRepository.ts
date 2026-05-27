/**
 * 远程项目仓储实现
 *
 * 通过 API Client 调用服务端 REST 接口。
 */
import type { IProjectRepository } from '../types';
import type { EpisodeSummary, ProjectSummary, ProjectWorkspace } from '../../types/project';
import type { ScanRootConfigItem } from '../../types/fileCheck';
import type { ApplyProjectInitializationRequest, ApplyProjectInitializationResponse, PrepareProjectInitializationRequest, PrepareProjectInitializationResponse, ProjectClientAction, ProjectInitializationResult, ProjectLensFolderPlan, ProjectLensSyncRequest } from '../../types/ipc';
import type { LensStatus } from '../../types/lens';
import { apiClient } from '../../api/client';
import { suppressAutoInitializedLensSync } from '../../services/repositoryService';
import type { RemoteEpisodeResponse, RemoteLensResponse, RemoteProjectCreateResponse, RemoteProjectResponse, RemoteRootResponse } from './types';
import { collectActivationTrace, collectEnabledRootPaths, describeRootCandidates, getLensLayoutRootConflictMessageFromPaths, resolveProjectActivationPaths, resolveWindowsDriveVariantPath } from '../../utils/projectActivationPaths';

interface RemoteProjectMemberResponse {
  userId: string;
  userName: string;
  displayName: string;
  projectRoleCode: string;
  isActive: boolean;
}

interface RemoteUserResponse {
  userId: string;
  userName: string;
  displayName: string;
  isActive: boolean;
}

function fallbackLegacyProjectRootPath(raw: RemoteProjectResponse): string {
  const projectRootPath = raw.projectRootPath?.trim();
  if (projectRootPath) {
    return projectRootPath;
  }

  // 兼容旧协议：description 曾经被错误复用为项目根路径；仅保留兜底，后续可删除。
  return raw.description?.trim() || '';
}

function mapRemoteRootToLocal(raw: RemoteRootResponse, fallbackFileKind: ScanRootConfigItem['fileKind'], index: number): ScanRootConfigItem | null {
  const absolutePath = raw.absolutePath?.trim();
  if (!absolutePath) {
    return null;
  }

  const fileKind = raw.fileKind && ['ma', 'mov', 'layout'].includes(raw.fileKind) ? raw.fileKind : fallbackFileKind;
  return {
    rootId: raw.rootId?.trim() || `${fallbackFileKind}-legacy-${index}`,
    fileKind,
    label: raw.label?.trim() || absolutePath,
    absolutePath,
    initExcelPath: raw.initExcelPath?.trim() || undefined,
    priority: Number.isFinite(raw.priority ?? NaN) ? Number(raw.priority) : 100,
    isEnabled: raw.isEnabled ?? true,
  };
}

function mapRemoteRootsToLocal(roots: RemoteRootResponse[] | undefined, fallbackFileKind: ScanRootConfigItem['fileKind']): ScanRootConfigItem[] | undefined {
  const mapped = (roots ?? [])
    .map((root, index) => mapRemoteRootToLocal(root, fallbackFileKind, index))
    .filter((root): root is ScanRootConfigItem => Boolean(root));
  return mapped.length > 0 ? mapped : undefined;
}

function getWindowsDriveLetter(value: string): string | null {
  const match = value.trim().match(/^([a-zA-Z]):[\\/]/);
  return match ? match[1].toUpperCase() : null;
}

function remapWindowsDriveLetter(value: string, targetDriveLetter: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (!/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return trimmed;
  }

  return `${targetDriveLetter.toUpperCase()}:${trimmed.slice(2)}`;
}

function remapScanRootsToDrive(roots: ScanRootConfigItem[] | undefined, targetDriveLetter: string): ScanRootConfigItem[] | undefined {
  const mapped = (roots ?? [])
    .filter((root) => Boolean(root?.rootId?.trim() && root?.label?.trim() && root?.absolutePath?.trim() && isValidScanRootFileKind(root.fileKind)))
    .map((root) => ({
      ...root,
      absolutePath: remapWindowsDriveLetter(root.absolutePath, targetDriveLetter),
    }));

  return mapped.length > 0 ? mapped : undefined;
}

function mapRemoteProjectToLocal(raw: RemoteProjectResponse): ProjectSummary {
  return {
    projectId: raw.code,
    projectName: raw.name,
    projectRootPath: fallbackLegacyProjectRootPath(raw),
    projectDefaultFps: normalizeProjectDefaultFps(raw.projectDefaultFps),
    databasePath: '',
    backupDir: '',
    versionTag: raw.versionTag,
    layoutTag: raw.layoutTag,
    lensFolderRootPath: raw.lensFolderRootPath ?? undefined,
    maCheckPath: raw.maCheckPath ?? undefined,
    movCheckPath: raw.movCheckPath ?? undefined,
    layoutCheckPath: raw.layoutCheckPath ?? undefined,
    lensRoots: mapRemoteRootsToLocal(raw.lensRoots, 'ma'),
    layoutRoots: mapRemoteRootsToLocal(raw.layoutRoots, 'layout'),
    createdAt: raw.createdAtUtc,
    updatedAt: raw.updatedAtUtc,
    lastOpenedAt: undefined,
  };
}

function isValidScanRootFileKind(fileKind: unknown): fileKind is ScanRootConfigItem['fileKind'] {
  return fileKind === 'ma' || fileKind === 'mov' || fileKind === 'layout';
}

async function pathExists(pathValue: string): Promise<boolean> {
  const result = await window.movtools.file.exists({ path: pathValue });
  return Boolean(result.success && result.exists);
}

function buildActivationPathError(
  kind: '项目根目录' | '镜头根目录' | 'Layout 根目录',
  resolution: { configuredPath?: string; missingServicePath: boolean; localMismatch: boolean },
  roots?: ScanRootConfigItem[] | undefined,
): string {
  if (resolution.missingServicePath) {
    return `[服务端未返回可用路径] 服务端未返回可用${kind}。${roots ? `当前可用根目录：${describeRootCandidates(roots)}` : '主字段缺失且未提供可用 roots。'}`;
  }

  if (resolution.localMismatch) {
    return `[本机无法匹配服务端路径] 本机无法匹配服务端${kind}：${resolution.configuredPath ?? '未知路径'}。请确认本机盘符映射或挂载状态。`;
  }

  return '[本地项目 bootstrap 失败]';
}

function mapRemoteEpisodeToLocal(raw: RemoteEpisodeResponse): EpisodeSummary {
  return {
    episodeId: raw.id,
    projectId: raw.projectCode,
    episodeCode: raw.code,
    episodeName: raw.name,
    lensFolderRootPath: raw.lensFolderRootPath ?? undefined,
    layoutCheckPath: raw.layoutCheckPath ?? undefined,
    versionTag: raw.versionTag ?? 'ANI',
    layoutTag: raw.layoutTag ?? 'LAY',
    initExcelPath: raw.initExcelPath ?? undefined,
    lensRoots: mapRemoteRootsToLocal(raw.lensRoots, 'ma'),
    layoutRoots: mapRemoteRootsToLocal(raw.layoutRoots, 'layout'),
    createdAt: raw.createdAtUtc,
    updatedAt: raw.updatedAtUtc,
  };
}

function normalizeProjectDefaultFps(value?: number | null): number {
  return Number.isFinite(value ?? NaN) && (value ?? 0) > 0 ? Math.trunc(value as number) : 30;
}

function mapRemoteStatusToLocal(status: string): LensStatus {
  if (['制作', '提交', '返修', '通过', '关闭'].includes(status)) {
    return status as LensStatus;
  }
  return '制作';
}

async function fetchRemoteProjectMembers(projectCode: string): Promise<RemoteProjectMemberResponse[]> {
  try {
    return await apiClient.get<RemoteProjectMemberResponse[]>(`/api/project-members?projectCode=${encodeURIComponent(projectCode)}`);
  } catch {
    return [];
  }
}

async function fetchRemoteUsers(): Promise<RemoteUserResponse[]> {
  try {
    return await apiClient.get<RemoteUserResponse[]>('/api/users');
  } catch {
    return [];
  }
}

function normalizePersonName(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000·、，,;；\/\\|\-_.()（）【】\[\]<>《》]/g, '');
}

function splitMakerCandidates(value: string): string[] {
  return value
    .split(/[、,，;；\/\\|]/g)
    .map((candidate) => candidate.replace(/[()（）【】\[\]<>《》]/g, '').trim())
    .filter(Boolean);
}

function getMakerCandidates(raw: string | null | undefined): string[] {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) {
    return [];
  }

  return Array.from(new Set([trimmed, ...splitMakerCandidates(trimmed)]))
    .map((candidate) => candidate.trim())
    .filter(Boolean);
}

function matchMakerToProjectMember(
  raw: string | null | undefined,
  members: Array<{ userId: string; userName: string; displayName: string; isActive: boolean }>,
): { userId: string; userName: string; displayName: string; isActive: boolean } | null {
  const candidates = getMakerCandidates(raw);
  if (candidates.length === 0) {
    return null;
  }

  const activeMembers = members.filter((member) => member.isActive);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizePersonName(candidate);
    const exact = activeMembers.find((member) => {
      const displayName = member.displayName.trim();
      const userName = member.userName.trim();
      return displayName === candidate
        || userName === candidate
        || member.userId === candidate
        || normalizePersonName(displayName) === normalizedCandidate
        || normalizePersonName(userName) === normalizedCandidate;
    });
    if (exact) {
      return exact;
    }

    if (!normalizedCandidate) {
      continue;
    }

    const normalizedMatch = activeMembers.find((member) => {
      const normalizedDisplayName = normalizePersonName(member.displayName);
      const normalizedUserName = normalizePersonName(member.userName);
      return normalizedCandidate === normalizedDisplayName
        || normalizedCandidate === normalizedUserName
        || normalizedDisplayName.includes(normalizedCandidate)
        || normalizedUserName.includes(normalizedCandidate)
        || normalizedCandidate.includes(normalizedDisplayName)
        || normalizedCandidate.includes(normalizedUserName);
    });

    if (normalizedMatch) {
      return normalizedMatch;
    }
  }

  return null;
}

function normalizePreparedLensSyncItem(item: ProjectLensSyncRequest, members: RemoteProjectMemberResponse[]): ProjectLensSyncRequest {
  const makerNameRaw = (item.makerNameRaw ?? item.maker ?? '').trim();
  const makerUserId = item.makerUserId?.trim() || null;
  const { maker: _legacyMaker, ...baseItem } = item;

  if (makerUserId) {
    const member = members.find((candidate) => candidate.isActive && candidate.userId === makerUserId);
    if (member) {
      return {
        ...baseItem,
        makerUserId: member.userId,
        makerNameRaw: makerNameRaw || null,
        makerMatchStatus: 'matched',
      };
    }
  }

  const matched = matchMakerToProjectMember(makerNameRaw, members);
  if (matched) {
    return {
      ...baseItem,
      makerUserId: matched.userId,
      makerNameRaw: makerNameRaw || null,
      makerMatchStatus: 'matched',
    };
  }

  return {
    ...baseItem,
    makerUserId: null,
    makerNameRaw: makerNameRaw || null,
    makerMatchStatus: makerNameRaw ? 'unmatched' : 'unassigned',
  };
}

function normalizePreparedLensSyncItems(items: ProjectLensSyncRequest[], members: RemoteProjectMemberResponse[]): ProjectLensSyncRequest[] {
  return items.map((item) => normalizePreparedLensSyncItem(item, members));
}

async function normalizePreparedLensSyncItemsWithFreshMembers(
  items: ProjectLensSyncRequest[],
  projectCode: string,
): Promise<ProjectLensSyncRequest[]> {
  const freshMembers = await fetchRemoteProjectMembers(projectCode);
  return normalizePreparedLensSyncItems(items, freshMembers);
}

function deriveAutoProjectMembers(preparedLensSyncItems: ProjectLensSyncRequest[], users: RemoteUserResponse[]): Array<{ userId: string; projectRoleCode: string }> {
  const projectMembers = new Map<string, { userId: string; projectRoleCode: string }>();

  for (const item of preparedLensSyncItems) {
    const makerUserId = item.makerUserId?.trim() || null;
    const makerNameRaw = (item.makerNameRaw ?? item.maker ?? '').trim();

    if (makerUserId) {
      const matchedById = users.find((user) => user.isActive && user.userId === makerUserId);
      if (matchedById) {
        projectMembers.set(matchedById.userId, { userId: matchedById.userId, projectRoleCode: 'maker' });
        continue;
      }
    }

    if (!makerNameRaw) {
      continue;
    }

    const matched = matchMakerToProjectMember(makerNameRaw, users);
    if (matched) {
      projectMembers.set(matched.userId, { userId: matched.userId, projectRoleCode: 'maker' });
    }
  }

  return Array.from(projectMembers.values());
}

function mergeProjectMembers(
  explicitMembers: Array<{ userId: string; projectRoleCode: string }> | undefined,
  explicitMemberUserIds: string[] | undefined,
  autoMembers: Array<{ userId: string; projectRoleCode: string }>,
): Array<{ userId: string; projectRoleCode: string }> {
  const merged = new Map<string, { userId: string; projectRoleCode: string }>();

  for (const member of explicitMembers ?? []) {
    merged.set(member.userId, { userId: member.userId, projectRoleCode: member.projectRoleCode || 'maker' });
  }

  for (const userId of explicitMemberUserIds ?? []) {
    if (!merged.has(userId)) {
      merged.set(userId, { userId, projectRoleCode: 'maker' });
    }
  }

  for (const member of autoMembers) {
    if (!merged.has(member.userId)) {
      merged.set(member.userId, member);
    }
  }

  return Array.from(merged.values());
}

async function ensureProjectMembers(projectCode: string, members: Array<{ userId: string; projectRoleCode: string }>): Promise<void> {
  if (members.length === 0) {
    return;
  }

  const currentMembers = await fetchRemoteProjectMembers(projectCode);
  const currentMemberIds = new Set(currentMembers.map((member) => member.userId));

  for (const member of members) {
    if (currentMemberIds.has(member.userId)) {
      continue;
    }

    await apiClient.request<void>('/api/project-members', {
      method: 'POST',
      body: JSON.stringify({
        projectCode,
        userId: member.userId,
        projectRoleCode: member.projectRoleCode || 'maker',
      }),
    });
  }
}

function toStructuredRoots(roots?: ScanRootConfigItem[]): ScanRootConfigItem[] | undefined {
  if (!roots || roots.length === 0) {
    return undefined;
  }

  const structured = roots
    .filter((root) => Boolean(root?.rootId?.trim() && root?.label?.trim() && root?.absolutePath?.trim() && isValidScanRootFileKind(root.fileKind)))
    .map((root) => ({
      rootId: root.rootId.trim(),
      fileKind: root.fileKind,
      label: root.label.trim(),
      absolutePath: root.absolutePath.trim(),
      initExcelPath: root.initExcelPath?.trim() || undefined,
      priority: Number.isFinite(root.priority) ? root.priority : 100,
      isEnabled: root.isEnabled,
    }));

  return structured.length > 0 ? structured : undefined;
}

function isUsableScanRoot(root: ScanRootConfigItem | undefined): root is ScanRootConfigItem {
  return Boolean(
    root
    && ['ma', 'mov', 'layout'].includes(root.fileKind)
    && typeof root.absolutePath === 'string'
    && root.absolutePath.trim()
    && typeof root.label === 'string'
    && typeof root.rootId === 'string',
  );
}

function getUsableScanRoots(roots?: ScanRootConfigItem[]): ScanRootConfigItem[] | undefined {
  const filtered = (roots ?? []).filter(isUsableScanRoot);
  return filtered.length > 0 ? filtered : undefined;
}

function resolveLensFolderName(lensName: string, lensCode?: string): string {
  return (lensName.trim() || lensCode?.trim() || '').trim();
}

function getPrimaryLensRoot(roots?: ScanRootConfigItem[]): ScanRootConfigItem | undefined {
  return roots
    ?.filter((root) => root.isEnabled && root.absolutePath.trim())
    .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, 'zh-CN'))[0];
}

function findLensRootPathByRootCode(roots: ScanRootConfigItem[] | undefined, rootCode?: string | null): string | undefined {
  if (!roots || roots.length === 0 || !rootCode?.trim()) {
    return undefined;
  }

  const normalized = rootCode.trim().toUpperCase();
  const matched = roots.find((root) => [root.rootId, root.label, root.fileKind].some((value) => value?.trim().toUpperCase() === normalized));
  return matched?.absolutePath?.trim() || undefined;
}

function buildLensFolderPlans(lenses: RemoteLensResponse[], lensRoots?: ScanRootConfigItem[]): ProjectLensFolderPlan[] {
  const primaryRoot = getPrimaryLensRoot(lensRoots)?.absolutePath.trim() ?? '';
  const plans: ProjectLensFolderPlan[] = [];
  const seen = new Set<string>();

  for (const lens of lenses) {
    const folderName = resolveLensFolderName(lens.name, lens.code);
    const rootPath = findLensRootPathByRootCode(lensRoots, lens.rootCode) ?? primaryRoot;
    const key = `${rootPath.toUpperCase()}::${folderName.toUpperCase()}`;

    if (!rootPath || !folderName || seen.has(key)) {
      continue;
    }

    seen.add(key);
    plans.push({
      lensId: lens.id,
      lensCode: lens.code,
      lensName: lens.name,
      rootPath,
      folderName,
    });
  }

  return plans;
}

function mapRemoteLensToProjectLensSyncRequest(lens: RemoteLensResponse): ProjectLensSyncRequest {
  const hasMakerValue = Boolean(lens.makerNameRaw?.trim() || lens.maker?.trim());
  return {
    lensId: lens.id,
    code: lens.code,
    name: lens.name,
    sequence: lens.sequence,
    singleFrame: lens.singleFrame,
    lensStatus: mapRemoteStatusToLocal(lens.status),
    maker: lens.maker ?? '',
    makerUserId: lens.makerUserId ?? null,
    makerNameRaw: lens.makerNameRaw ?? lens.maker ?? null,
    makerMatchStatus: lens.makerMatchStatus ?? (lens.makerUserId ? 'matched' : hasMakerValue ? 'unmatched' : 'unassigned'),
    description: lens.description ?? null,
    rootCode: lens.rootCode ?? null,
    logicalPath: lens.logicalPath ?? null,
    versionTag: lens.versionTag ?? null,
    layoutTag: lens.layoutTag ?? null,
  };
}

function sanitizeScanRoots(roots?: ScanRootConfigItem[]): ScanRootConfigItem[] | undefined {
  const sanitized = (roots ?? [])
    .filter((root) => Boolean(root && root.rootId?.trim() && root.label?.trim() && root.absolutePath?.trim() && isValidScanRootFileKind(root.fileKind)))
    .map((root) => ({
      rootId: root.rootId.trim(),
      fileKind: root.fileKind,
      label: root.label.trim(),
      absolutePath: root.absolutePath.trim(),
      initExcelPath: root.initExcelPath?.trim() || undefined,
      priority: Number.isFinite(root.priority) ? root.priority : 100,
      isEnabled: root.isEnabled,
    }));

  return sanitized.length > 0 ? sanitized : undefined;
}

async function resolveScanRootsToLocal(roots?: ScanRootConfigItem[]): Promise<ScanRootConfigItem[] | undefined> {
  const structured = sanitizeScanRoots(roots);
  if (!structured) {
    return undefined;
  }

  const mapped: ScanRootConfigItem[] = [];
  for (const root of structured) {
    const resolved = await resolveWindowsDriveVariantPath(root.absolutePath, pathExists);
    if (!resolved) {
      continue;
    }
    mapped.push({ ...root, absolutePath: resolved });
  }

  return mapped.length > 0 ? mapped : undefined;
}

function sanitizeLensSyncItems(items: ProjectLensSyncRequest[]): ProjectLensSyncRequest[] {
  return items.filter((item) => Boolean(item.code?.trim() && item.name?.trim() && Number.isFinite(item.sequence)));
}

function inferEpisodeTagsFromLenses(lenses: RemoteLensResponse[], fallbackVersionTag = 'ANI', fallbackLayoutTag = 'LAY'): { versionTag: string; layoutTag: string } {
  const versionTag = lenses.map((item) => item.versionTag?.trim()).find((value): value is string => Boolean(value)) ?? fallbackVersionTag;
  const layoutTag = lenses.map((item) => item.layoutTag?.trim()).find((value): value is string => Boolean(value)) ?? fallbackLayoutTag;
  return { versionTag, layoutTag };
}

async function prepareLocalInitialization(request: PrepareProjectInitializationRequest): Promise<PrepareProjectInitializationResponse> {
  return window.movtools.project.prepareInitialization(request);
}

async function syncRemoteLensBatch(projectCode: string, episodeId: string, lenses: ProjectLensSyncRequest[]): Promise<RemoteLensResponse[]> {
  if (lenses.length === 0) {
    return [];
  }

  return apiClient.post<RemoteLensResponse[]>(`/api/projects/${encodeURIComponent(projectCode)}/episodes/${encodeURIComponent(episodeId)}/lenses/batch`, {
    lenses,
  });
}

function mergeFinalInitializationResults(
  base: ProjectInitializationResult | undefined,
  prepareResult: PrepareProjectInitializationResponse | undefined,
  batchLensCount: number,
  localResult: ApplyProjectInitializationResponse | undefined,
): ProjectInitializationResult | undefined {
  if (!base && !prepareResult && !localResult) {
    return undefined;
  }

  const baseStatus = base?.status;
  const prepareStatus = prepareResult?.initResult.status;
  const localStatus = localResult?.initResult.status;
  const messages = [localResult?.initResult.message, prepareResult?.initResult.message, base?.message].filter(Boolean) as string[];
  const errors = Array.from(new Set([
    ...(base?.errors ?? []),
    ...(prepareResult?.initResult.errors ?? []),
    ...(localResult?.initResult.errors ?? []),
  ]));

  const hasFailure = [baseStatus, prepareStatus, localStatus].includes('failed');
  const pendingClientActions = Array.from(new Set([
    ...(base?.pendingClientActions ?? []),
    ...(prepareResult?.initResult.pendingClientActions ?? []),
    ...(localResult?.initResult.pendingClientActions ?? []),
  ]));
  const hasPendingClientActions = pendingClientActions.length > 0;

  let status: ProjectInitializationResult['status'] = baseStatus ?? 'not_requested';
  if (hasFailure) {
    status = 'failed';
  } else if (localStatus === 'success' && !hasPendingClientActions) {
    status = 'success';
  } else if (localStatus === 'partial_success' || hasPendingClientActions || (batchLensCount > 0 && !localResult)) {
    status = 'partial_success';
  } else if (prepareStatus === 'success' || baseStatus === 'success') {
    status = 'success';
  } else if (prepareStatus === 'skipped' || baseStatus === 'skipped') {
    status = 'skipped';
  } else if (prepareStatus === 'not_requested' || baseStatus === 'not_requested') {
    status = 'not_requested';
  }

  const failureMessage = [localResult?.initResult.message, prepareResult?.initResult.message, base?.message].find((message) => {
    if (!message) return false;
    return [baseStatus, prepareStatus, localStatus].includes('failed') && message.includes('失败');
  });

  return {
    status,
    message: failureMessage ?? messages[0] ?? '初始化完成。',
    excelImportAttempted: base?.excelImportAttempted ?? prepareResult?.initResult.excelImportAttempted ?? localResult?.initResult.excelImportAttempted ?? false,
    excelImportSuccess: base?.excelImportSuccess ?? prepareResult?.initResult.excelImportSuccess ?? localResult?.initResult.excelImportSuccess ?? false,
    createdLensCount: batchLensCount > 0 ? batchLensCount : (base?.createdLensCount ?? prepareResult?.initResult.createdLensCount ?? localResult?.initResult.createdLensCount),
    lensFoldersPlanned: localResult?.initResult.lensFoldersPlanned ?? base?.lensFoldersPlanned ?? prepareResult?.initResult.lensFoldersPlanned,
    lensFoldersCreated: localResult?.initResult.lensFoldersCreated ?? base?.lensFoldersCreated ?? prepareResult?.initResult.lensFoldersCreated,
    pendingClientActions,
    errors,
  };
}

function mergeInitializationResults(base: ProjectInitializationResult | undefined, localResult: ApplyProjectInitializationResponse | undefined, pendingClientActions: ProjectClientAction[] = []): ProjectInitializationResult | undefined {
  if (!base && !localResult) {
    return undefined;
  }

  if (!base) {
    return localResult ? { ...localResult.initResult, pendingClientActions } : undefined;
  }

  if (!localResult) {
    return {
      ...base,
      pendingClientActions,
    };
  }

  const local = localResult.initResult;
  const mergedStatus = base.status === 'failed' || local.status === 'failed'
    ? 'failed'
    : pendingClientActions.length > 0 || base.status === 'partial_success' || local.status === 'partial_success'
      ? 'partial_success'
      : base.status === 'success' || local.status === 'success'
        ? 'success'
        : base.status === 'skipped'
          ? 'skipped'
          : local.status === 'skipped'
            ? 'skipped'
            : 'not_requested';

  const mergedErrors = Array.from(new Set([...(base.errors ?? []), ...(local.errors ?? [])]));
  const failureMessage = base.status === 'failed'
    ? base.message
    : local.status === 'failed'
      ? local.message
      : local.message || base.message;

  return {
    status: mergedStatus,
    message: failureMessage,
    excelImportAttempted: base.excelImportAttempted || local.excelImportAttempted,
    excelImportSuccess: base.excelImportSuccess || local.excelImportSuccess,
    createdLensCount: base.createdLensCount ?? local.createdLensCount,
    lensFoldersPlanned: local.lensFoldersPlanned ?? base.lensFoldersPlanned,
    lensFoldersCreated: local.lensFoldersCreated ?? base.lensFoldersCreated,
    pendingClientActions,
    errors: mergedErrors,
  };
}

async function fetchRemoteEpisodeLenses(episodeId: string): Promise<RemoteLensResponse[]> {
  return apiClient.get<RemoteLensResponse[]>(`/api/episodes/${encodeURIComponent(episodeId)}/lenses`);
}

function isUninitializedLocalProjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('所选目录不是已初始化的制片项目。') || message.includes('旧版制片项目');
}

class RemoteProjectRepository implements IProjectRepository {
  private activeProjectId: string | null = null;
  private activeEpisodeId: string | null = null;

  async getWorkspace(): Promise<ProjectWorkspace> {
    try {
      const response = await apiClient.get<RemoteProjectResponse[]>('/api/projects');
      return {
        projects: response.map(mapRemoteProjectToLocal),
        activeProjectId: this.activeProjectId,
        activeEpisodeId: this.activeEpisodeId,
      };
    } catch {
      return { projects: [], activeProjectId: this.activeProjectId, activeEpisodeId: this.activeEpisodeId };
    }
  }

  async getProject(projectId: string): Promise<ProjectSummary | null> {
    try {
      const response = await apiClient.get<RemoteProjectResponse>(`/api/projects/${encodeURIComponent(projectId)}`);
      return mapRemoteProjectToLocal(response);
    } catch {
      return null;
    }
  }

  async listEpisodes(projectCode: string): Promise<{ success: boolean; episodes: EpisodeSummary[]; activeProjectId: string | null; activeEpisodeId: string | null; error?: string }> {
    try {
      const response = await apiClient.get<RemoteEpisodeResponse[]>(`/api/projects/${encodeURIComponent(projectCode)}/episodes`);
      return {
        success: true,
        episodes: response.map(mapRemoteEpisodeToLocal),
        activeProjectId: projectCode,
        activeEpisodeId: this.activeProjectId === projectCode ? this.activeEpisodeId : null,
      };
    } catch (error) {
      return {
        success: false,
        episodes: [],
        activeProjectId: projectCode,
        activeEpisodeId: this.activeProjectId === projectCode ? this.activeEpisodeId : null,
        error: error instanceof Error ? error.message : '获取集列表失败',
      };
    }
  }

  async createProject(request: {
    projectName: string;
    projectRootPath: string;
    projectDefaultFps?: number;
    initialEpisodeCode?: string;
    initialEpisodeName?: string;
    initExcelPath?: string;
    lensRoots?: ScanRootConfigItem[];
    layoutRoots?: ScanRootConfigItem[];
    members?: Array<{
      userId: string;
      projectRoleCode: string;
    }>;
    memberUserIds?: string[];
  }): Promise<{ success: boolean; project?: ProjectSummary; initialEpisode?: EpisodeSummary | null; workspace?: ProjectWorkspace; initResult?: ProjectInitializationResult; message?: string; error?: string }> {
    try {
      const code = request.projectName.trim();
      const name = request.projectName.trim();

      // 构建项目创建请求，初始化 Excel 不再交给服务端解析
      const createProjectBody: {
        code: string;
        name: string;
        projectRootPath: string;
        projectDefaultFps?: number;
        versionTag: string;
        layoutTag: string;
        initialEpisodeCode?: string;
        initialEpisodeName?: string;
        lensRoots?: ScanRootConfigItem[];
        layoutRoots?: ScanRootConfigItem[];
        members?: Array<{
          userId: string;
          projectRoleCode: string;
        }>;
      } = {
        code,
        name,
        projectRootPath: request.projectRootPath.trim(),
        projectDefaultFps: normalizeProjectDefaultFps(request.projectDefaultFps),
        versionTag: 'ANI',
        layoutTag: 'LAY',
      };

      // 如果有首集信息，添加到请求中
      if (request.initialEpisodeCode?.trim()) {
        createProjectBody.initialEpisodeCode = request.initialEpisodeCode.trim();
        createProjectBody.initialEpisodeName = request.initialEpisodeName?.trim() || request.initialEpisodeCode.trim();
      }

      const structuredLensRoots = toStructuredRoots(request.lensRoots);
      const structuredLayoutRoots = toStructuredRoots(request.layoutRoots);

      const prepareResult = await prepareLocalInitialization({
        initExcelPath: request.initExcelPath?.trim() || undefined,
        lensRoots: structuredLensRoots,
        layoutRoots: structuredLayoutRoots,
      });

      if (!prepareResult.success) {
        return {
          success: false,
          error: prepareResult.error ?? prepareResult.initResult.message,
          initResult: prepareResult.initResult,
        };
      }

      const remoteUsers = await fetchRemoteUsers();
      const autoProjectMembers = deriveAutoProjectMembers(prepareResult.preparedLensSyncItems, remoteUsers);
      const localLensRoots = await resolveScanRootsToLocal(structuredLensRoots);
      const localLayoutRoots = await resolveScanRootsToLocal(structuredLayoutRoots);

      if (structuredLensRoots) {
        createProjectBody.lensRoots = structuredLensRoots;
      }

      if (structuredLayoutRoots) {
        createProjectBody.layoutRoots = structuredLayoutRoots;
      }

      // 添加项目成员：手选成员 + 识别出的制作人员账号自动入组
      const mergedMembers = mergeProjectMembers(request.members, request.memberUserIds, autoProjectMembers);
      if (mergedMembers.length > 0) {
        createProjectBody.members = mergedMembers;
      }

      const localCreateResult = await window.movtools.project.create({
        projectName: request.projectName,
        projectRootPath: request.projectRootPath,
        projectDefaultFps: request.projectDefaultFps,
        initialEpisodeCode: request.initialEpisodeCode?.trim(),
        initialEpisodeName: request.initialEpisodeName?.trim() || request.initialEpisodeCode?.trim(),
        initExcelPath: request.initExcelPath?.trim() || undefined,
        lensRoots: localLensRoots,
        layoutRoots: localLayoutRoots,
        members: mergedMembers,
        memberUserIds: request.memberUserIds,
      });

      if (!localCreateResult.success) {
        return {
          success: false,
          error: localCreateResult.error ?? localCreateResult.initResult?.message ?? '本地项目初始化失败。',
          initResult: localCreateResult.initResult,
        };
      }

      const localProjectId = localCreateResult.project?.projectId ?? localCreateResult.workspace?.activeProjectId ?? null;
      const localEpisodeId = localCreateResult.initialEpisode?.episodeId ?? localCreateResult.workspace?.activeEpisodeId ?? null;
      if (!localProjectId || !localEpisodeId) {
        return {
          success: false,
          error: '本地项目初始化未返回有效的项目或集标识。',
          initResult: localCreateResult.initResult,
        };
      }

      const createdProject = await apiClient.post<RemoteProjectCreateResponse>('/api/projects', createProjectBody);

      this.activeProjectId = createdProject.project?.code ?? createdProject.code;
      this.activeEpisodeId = createdProject.initialEpisode?.id ?? null;

      const projectId = createdProject.project?.code ?? createdProject.code;
      const initialEpisodeId = createdProject.initialEpisode?.id ?? null;
      const workspace = await this.getWorkspace();

      let localInitialization: ApplyProjectInitializationResponse | undefined;
      let syncedLenses: RemoteLensResponse[] = [];

      if (autoProjectMembers.length > 0) {
        await ensureProjectMembers(projectId, autoProjectMembers);
      }

      const preparedLensSyncItems = await normalizePreparedLensSyncItemsWithFreshMembers(
        prepareResult.preparedLensSyncItems,
        projectId,
      );

      if (preparedLensSyncItems.length > 0) {
        if (!initialEpisodeId) {
          const message = '服务端未返回首集，无法同步镜头。';
          const mergedInitResult = mergeFinalInitializationResults(createdProject.initResult, {
            ...prepareResult,
            initResult: {
              ...prepareResult.initResult,
              status: 'failed',
              message,
              errors: [message],
            },
          }, 0, undefined);
          return {
            success: false,
            project: mapRemoteProjectToLocal(createdProject.project ?? {
              code: createdProject.code,
              name: createdProject.name,
              projectRootPath: null,
              description: null,
              versionTag: createdProject.versionTag,
              layoutTag: createdProject.layoutTag,
              isArchived: false,
              rowVersion: 1,
              createdAtUtc: new Date().toISOString(),
              updatedAtUtc: new Date().toISOString(),
            }),
            initialEpisode: createdProject.initialEpisode ? mapRemoteEpisodeToLocal(createdProject.initialEpisode) : null,
            workspace,
            initResult: mergedInitResult,
            message: mergedInitResult?.message,
            error: message,
          };
        }

        try {
          syncedLenses = await syncRemoteLensBatch(projectId, initialEpisodeId, preparedLensSyncItems);
        } catch (error) {
          const message = error instanceof Error ? `服务端镜头同步失败：${error.message}` : '服务端镜头同步失败：未知错误。';
          const failedPrepare = {
            ...prepareResult,
            initResult: {
              ...prepareResult.initResult,
              status: 'failed' as const,
              message,
              errors: [message],
            },
          };
          const mergedInitResult = mergeFinalInitializationResults(createdProject.initResult, failedPrepare, 0, undefined);
          return {
            success: false,
            project: mapRemoteProjectToLocal(createdProject.project ?? {
              code: createdProject.code,
              name: createdProject.name,
              projectRootPath: null,
              description: null,
              versionTag: createdProject.versionTag,
              layoutTag: createdProject.layoutTag,
              isArchived: false,
              rowVersion: 1,
              createdAtUtc: new Date().toISOString(),
              updatedAtUtc: new Date().toISOString(),
            }),
            initialEpisode: createdProject.initialEpisode ? mapRemoteEpisodeToLocal(createdProject.initialEpisode) : null,
            workspace,
            initResult: mergedInitResult,
            message: mergedInitResult?.message,
            error: message,
          };
        }

        const lensFolderPlans = buildLensFolderPlans(syncedLenses, localLensRoots);
        const { versionTag, layoutTag } = inferEpisodeTagsFromLenses(syncedLenses, createdProject.project?.versionTag ?? 'ANI', createdProject.project?.layoutTag ?? 'LAY');
        localInitialization = await this.applyInitialization({
          projectId: localProjectId,
          episodeId: localEpisodeId,
          episodeCode: createdProject.initialEpisode?.code ?? request.initialEpisodeCode ?? localEpisodeId,
          episodeName: createdProject.initialEpisode?.name ?? request.initialEpisodeName ?? request.initialEpisodeCode ?? localEpisodeId,
          versionTag,
          layoutTag,
          pendingClientActions: ['refresh_local_episode_workspace'],
          lensRoots: structuredLensRoots,
          layoutRoots: structuredLayoutRoots,
          lensFolderPlans,
          lensSyncItems: syncedLenses.map(mapRemoteLensToProjectLensSyncRequest),
        });
      }

      const mergedInitResult = mergeFinalInitializationResults(
        createdProject.initResult,
        prepareResult,
        syncedLenses.length,
        localInitialization,
      );

      const overallSuccess = mergedInitResult ? mergedInitResult.status !== 'failed' : true;

      return {
        success: overallSuccess,
        project: mapRemoteProjectToLocal(createdProject.project ?? {
          code: createdProject.code,
          name: createdProject.name,
          projectRootPath: null,
          description: null,
          versionTag: createdProject.versionTag,
          layoutTag: createdProject.layoutTag,
          isArchived: false,
          rowVersion: 1,
          createdAtUtc: new Date().toISOString(),
          updatedAtUtc: new Date().toISOString(),
        }),
        initialEpisode: createdProject.initialEpisode ? mapRemoteEpisodeToLocal(createdProject.initialEpisode) : null,
        workspace,
        initResult: mergedInitResult,
        message: mergedInitResult?.message,
        error: mergedInitResult?.status === 'failed' ? mergedInitResult.message : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '创建项目失败',
      };
    }
  }

  async applyInitialization(request: ApplyProjectInitializationRequest): Promise<ApplyProjectInitializationResponse> {
    try {
      const sanitizedRequest: ApplyProjectInitializationRequest = {
        ...request,
        lensRoots: sanitizeScanRoots(request.lensRoots),
        layoutRoots: sanitizeScanRoots(request.layoutRoots),
        lensSyncItems: sanitizeLensSyncItems(request.lensSyncItems ?? []),
      };
      return await window.movtools.project.applyInitialization(sanitizedRequest as Parameters<typeof window.movtools.project.applyInitialization>[0]);
    } catch (error) {
      return {
        success: false,
        initResult: {
          status: 'failed',
          message: error instanceof Error ? error.message : '本地初始化失败',
          excelImportAttempted: false,
          excelImportSuccess: false,
          lensFoldersCreated: 0,
          lensFoldersPlanned: 0,
          createdLensCount: 0,
          pendingClientActions: [],
          errors: [error instanceof Error ? error.message : '本地初始化失败'],
        },
        error: error instanceof Error ? error.message : '本地初始化失败',
      };
    }
  }

  async openProject(projectRootPath: string): Promise<{ success: boolean; project?: ProjectSummary; workspace?: ProjectWorkspace; error?: string }> {
    return {
      success: false,
      error: '协同模式下不支持打开本地项目。',
    };
  }

  async setActiveProject(
    projectCode: string,
    options?: { projectRootPath?: string; lensFolderRootPath?: string; layoutCheckPath?: string },
  ): Promise<{ success: boolean; project?: ProjectSummary; workspace?: ProjectWorkspace; error?: string }> {
    try {
      suppressAutoInitializedLensSync(10000);
      const workspace = await this.getWorkspace();
      const project = workspace.projects.find((entry) => entry.projectId === projectCode) ?? await this.getProject(projectCode);
      if (!project) {
        return { success: false, error: '未找到对应项目。' };
      }

      const episodes = await this.listEpisodes(projectCode);
      const preferredEpisode = episodes.episodes.find((entry) => entry.episodeId === (episodes.activeEpisodeId ?? this.activeEpisodeId)) ?? episodes.episodes[0] ?? null;
      const activationPaths = await resolveProjectActivationPaths(project, preferredEpisode, pathExists);
      const resolvedProjectRootPath = activationPaths.projectRootPath;
      const manualProjectRootPath = options?.projectRootPath?.trim() || undefined;
      if (resolvedProjectRootPath.missingServicePath && !manualProjectRootPath) {
        return {
          success: false,
          error: `${buildActivationPathError('项目根目录', resolvedProjectRootPath)}｜${collectActivationTrace(project, preferredEpisode)}`,
        };
      }

      const resolvedLensFolderRootPath = activationPaths.lensFolderRootPath;
      if (resolvedLensFolderRootPath.missingServicePath && !manualProjectRootPath) {
        return {
          success: false,
          error: `${buildActivationPathError('镜头根目录', resolvedLensFolderRootPath, preferredEpisode?.lensRoots ?? project.lensRoots)}｜${collectActivationTrace(project, preferredEpisode)}`,
        };
      }

      const resolvedLayoutCheckPath = activationPaths.layoutCheckPath;
      if (resolvedLayoutCheckPath.missingServicePath && !manualProjectRootPath) {
        return {
          success: false,
          error: `${buildActivationPathError('Layout 根目录', resolvedLayoutCheckPath, preferredEpisode?.layoutRoots ?? project.layoutRoots)}｜${collectActivationTrace(project, preferredEpisode)}`,
        };
      }

      if (resolvedLensFolderRootPath.localMismatch && !manualProjectRootPath) {
        return {
          success: false,
          error: `${buildActivationPathError('镜头根目录', resolvedLensFolderRootPath, preferredEpisode?.lensRoots ?? project.lensRoots)}｜${collectActivationTrace(project, preferredEpisode)}`,
        };
      }

      if (resolvedLayoutCheckPath.localMismatch && !manualProjectRootPath) {
        return {
          success: false,
          error: `${buildActivationPathError('Layout 根目录', resolvedLayoutCheckPath, preferredEpisode?.layoutRoots ?? project.layoutRoots)}｜${collectActivationTrace(project, preferredEpisode)}`,
        };
      }

      if (resolvedProjectRootPath.localMismatch && !manualProjectRootPath) {
        return {
          success: false,
          error: `${buildActivationPathError('项目根目录', resolvedProjectRootPath)}｜${collectActivationTrace(project, preferredEpisode)}`,
        };
      }

      const resolvedProjectRoot = manualProjectRootPath ?? resolvedProjectRootPath.resolvedPath ?? resolvedProjectRootPath.configuredPath ?? project.projectRootPath;
      const targetDriveLetter = getWindowsDriveLetter(resolvedProjectRoot);
      if (!targetDriveLetter) {
        return { success: false, error: `本机项目根目录不是有效的 Windows 盘符路径：${resolvedProjectRoot}｜${collectActivationTrace(project, preferredEpisode)}` };
      }

      const resolvedLensRoot = remapWindowsDriveLetter(resolvedLensFolderRootPath.resolvedPath ?? resolvedLensFolderRootPath.configuredPath ?? '', targetDriveLetter);
      const resolvedLayoutRoot = remapWindowsDriveLetter(resolvedLayoutCheckPath.resolvedPath ?? resolvedLayoutCheckPath.configuredPath ?? '', targetDriveLetter);
      const remappedLensRoots = remapScanRootsToDrive(preferredEpisode?.lensRoots ?? project.lensRoots, targetDriveLetter);
      const remappedLayoutRoots = remapScanRootsToDrive(preferredEpisode?.layoutRoots ?? project.layoutRoots, targetDriveLetter);

      if (!(await pathExists(resolvedProjectRoot))) {
        return { success: false, error: `本机找不到项目根目录：${resolvedProjectRoot}｜${collectActivationTrace(project, preferredEpisode)}` };
      }

      if (!resolvedLensRoot || !(await pathExists(resolvedLensRoot))) {
        return { success: false, error: `本机找不到镜头根目录：${resolvedLensRoot || '未配置'}｜${collectActivationTrace(project, preferredEpisode)}` };
      }

      if (!resolvedLayoutRoot || !(await pathExists(resolvedLayoutRoot))) {
        return { success: false, error: `本机找不到 Layout 根目录：${resolvedLayoutRoot || '未配置'}｜${collectActivationTrace(project, preferredEpisode)}` };
      }

      let localProjectId: string | null = null;
      let localEpisodeId: string | null = null;

      const localOpenResult = await window.movtools.project.open({ projectRootPath: resolvedProjectRoot });
      if (localOpenResult.success) {
        localProjectId = localOpenResult.project?.projectId ?? localOpenResult.workspace?.activeProjectId ?? null;
        localEpisodeId = localOpenResult.workspace?.activeEpisodeId ?? null;
      } else if (isUninitializedLocalProjectError(localOpenResult.error)) {
          const bootstrapResult = await window.movtools.project.create({
            projectName: project.projectName,
            projectRootPath: resolvedProjectRoot,
            initialEpisodeCode: preferredEpisode?.episodeCode ?? 'EP01',
            initialEpisodeName: preferredEpisode?.episodeName ?? preferredEpisode?.episodeCode ?? project.projectName,
            initExcelPath: preferredEpisode?.initExcelPath ?? undefined,
            lensFolderRootPath: resolvedLensRoot,
            layoutCheckPath: resolvedLayoutRoot,
          });

        if (!bootstrapResult.success) {
          return { success: false, error: `本地项目 bootstrap 失败：${bootstrapResult.error ?? bootstrapResult.initResult?.message ?? '初始化本地项目工作区失败。'}｜${collectActivationTrace(project, preferredEpisode)}` };
        }

        localProjectId = bootstrapResult.project?.projectId ?? bootstrapResult.workspace?.activeProjectId ?? null;
        localEpisodeId = bootstrapResult.initialEpisode?.episodeId ?? bootstrapResult.workspace?.activeEpisodeId ?? null;
      } else {
        return {
          success: false,
          error: localOpenResult.error ?? buildActivationPathError('项目根目录', resolvedProjectRootPath),
        };
      }

      if (!localProjectId || !localEpisodeId) {
        return { success: false, error: '未能建立本地项目工作区。' };
      }

      this.activeProjectId = projectCode;
      this.activeEpisodeId = episodes.activeEpisodeId ?? episodes.episodes[0]?.episodeId ?? null;
      if (this.activeEpisodeId) {
        const nextEpisode = episodes.episodes.find((episode) => episode.episodeId === this.activeEpisodeId);
        if (nextEpisode) {
          const remoteEpisodeLenses = await fetchRemoteEpisodeLenses(nextEpisode.episodeId);
          const inferredTags = inferEpisodeTagsFromLenses(remoteEpisodeLenses, project.versionTag ?? nextEpisode.versionTag ?? 'ANI', project.layoutTag ?? nextEpisode.layoutTag ?? 'LAY');
          const sanitizedLensSyncItems = sanitizeLensSyncItems(remoteEpisodeLenses.map(mapRemoteLensToProjectLensSyncRequest));
          const initResponse = await this.applyInitialization({
            projectId: localProjectId,
            episodeId: localEpisodeId,
            episodeCode: nextEpisode.episodeCode,
            episodeName: nextEpisode.episodeName,
            versionTag: nextEpisode.versionTag ?? project.versionTag ?? inferredTags.versionTag,
            layoutTag: nextEpisode.layoutTag ?? project.layoutTag ?? inferredTags.layoutTag,
            pendingClientActions: ['refresh_local_episode_workspace'],
            lensRoots: remappedLensRoots,
            layoutRoots: remappedLayoutRoots,
            lensSyncItems: sanitizedLensSyncItems,
          });
          if (!initResponse.success) {
            this.activeProjectId = null;
            this.activeEpisodeId = null;
            return {
              success: false,
              error: `本地项目 bootstrap 失败：${initResponse.error ?? initResponse.initResult?.message ?? '刷新本地项目工作区失败。'}｜${collectActivationTrace(project, nextEpisode)}`,
            };
          }
          suppressAutoInitializedLensSync();
        }
      }
      const refreshedWorkspace = await this.getWorkspace();
      refreshedWorkspace.activeEpisodeId = this.activeEpisodeId;
      return {
        success: true,
        project: refreshedWorkspace.projects.find((p) => p.projectId === projectCode),
        workspace: refreshedWorkspace,
      };
    } catch (error) {
      this.activeProjectId = null;
      this.activeEpisodeId = null;
      return {
        success: false,
        error: error instanceof Error ? error.message : '设置当前项目失败',
      };
    }
  }

  async createEpisode(request: {
    projectId: string;
    episodeCode: string;
    episodeName?: string;
    initExcelPath?: string;
    lensRoots?: unknown[];
    layoutRoots?: unknown[];
  }): Promise<{ success: boolean; episode?: EpisodeSummary; workspace?: ProjectWorkspace; episodes?: EpisodeSummary[]; initResult?: ProjectInitializationResult; message?: string; error?: string }> {
    try {
      const structuredLensRoots = toStructuredRoots(request.lensRoots as ScanRootConfigItem[] | undefined);
      const structuredLayoutRoots = toStructuredRoots(request.layoutRoots as ScanRootConfigItem[] | undefined);
      const prepareResult = await prepareLocalInitialization({
        initExcelPath: request.initExcelPath?.trim() || undefined,
        lensRoots: structuredLensRoots,
        layoutRoots: structuredLayoutRoots,
      });

      if (!prepareResult.success) {
        return {
          success: false,
          error: prepareResult.error ?? prepareResult.initResult.message,
          initResult: prepareResult.initResult,
        };
      }

      const remoteUsers = await fetchRemoteUsers();
      const autoProjectMembers = deriveAutoProjectMembers(prepareResult.preparedLensSyncItems, remoteUsers);
      const localLensRoots = await resolveScanRootsToLocal(structuredLensRoots);
      const localLayoutRoots = await resolveScanRootsToLocal(structuredLayoutRoots);

      const response = await apiClient.post<RemoteEpisodeResponse>(`/api/projects/${encodeURIComponent(request.projectId)}/episodes`, {
        code: request.episodeCode,
        name: request.episodeName ?? request.episodeCode,
        sequence: 1,
        lensRoots: structuredLensRoots,
        layoutRoots: structuredLayoutRoots,
      });
      this.activeProjectId = request.projectId;
      this.activeEpisodeId = response.id;
      const workspace = await this.getWorkspace();
      const episodes = await this.listEpisodes(request.projectId);
      let syncedLenses: RemoteLensResponse[] = [];
      let localInitialization: ApplyProjectInitializationResponse | undefined;

      try {
        await ensureProjectMembers(request.projectId, autoProjectMembers);
        const preparedLensSyncItems = await normalizePreparedLensSyncItemsWithFreshMembers(
          prepareResult.preparedLensSyncItems,
          request.projectId,
        );

        if (preparedLensSyncItems.length > 0) {
          syncedLenses = await syncRemoteLensBatch(request.projectId, response.id, preparedLensSyncItems);
          const lensFolderPlans = buildLensFolderPlans(syncedLenses, localLensRoots);
          const { versionTag, layoutTag } = inferEpisodeTagsFromLenses(syncedLenses);
          localInitialization = await this.applyInitialization({
            projectId: request.projectId,
            episodeId: response.id,
            episodeCode: request.episodeCode,
            episodeName: request.episodeName ?? request.episodeCode,
            versionTag,
            layoutTag,
            pendingClientActions: ['create_lens_folders', 'refresh_local_episode_workspace'],
            lensRoots: localLensRoots,
            layoutRoots: localLayoutRoots,
            lensFolderPlans,
            lensSyncItems: syncedLenses.map(mapRemoteLensToProjectLensSyncRequest),
          });
        }
        suppressAutoInitializedLensSync();
      } catch (error) {
        const message = error instanceof Error ? `服务端镜头同步失败：${error.message}` : '服务端镜头同步失败：未知错误。';
        const failedPrepare = {
          ...prepareResult,
          initResult: {
            ...prepareResult.initResult,
            status: 'failed' as const,
            message,
            errors: [message],
          },
        };
        const initResult = mergeFinalInitializationResults(undefined, failedPrepare, 0, undefined);
        return {
          success: false,
          episode: mapRemoteEpisodeToLocal(response),
          workspace,
          episodes: episodes.episodes,
          initResult,
          message: initResult?.message,
          error: message,
        };
      }

      const initResult = mergeFinalInitializationResults(undefined, prepareResult, syncedLenses.length, localInitialization);
      return {
        success: true,
        episode: mapRemoteEpisodeToLocal(response),
        workspace,
        episodes: episodes.episodes,
        initResult,
        message: initResult?.message,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '创建集失败',
      };
    }
  }

  async setActiveEpisode(episodeId: string): Promise<{ success: boolean; episode?: EpisodeSummary; workspace?: ProjectWorkspace; error?: string }> {
    try {
      suppressAutoInitializedLensSync(10000);
      const workspace = await this.getWorkspace();
      for (const project of workspace.projects) {
        const episodesResult = await this.listEpisodes(project.projectId);
        const episode = episodesResult.episodes.find((e) => e.episodeId === episodeId);
        if (episode) {
          const activationPaths = await resolveProjectActivationPaths(project, episode, pathExists);
          const localLensRoots = await resolveScanRootsToLocal(episode.lensRoots ?? project.lensRoots);
          const localLayoutRoots = await resolveScanRootsToLocal(episode.layoutRoots ?? project.layoutRoots);
          const resolvedProjectRootPath = activationPaths.projectRootPath;
          if (resolvedProjectRootPath.missingServicePath) {
            return {
              success: false,
              error: `${buildActivationPathError('项目根目录', resolvedProjectRootPath)}｜${collectActivationTrace(project, episode)}`,
            };
          }

          if (resolvedProjectRootPath.localMismatch) {
            return {
              success: false,
              error: `${buildActivationPathError('项目根目录', resolvedProjectRootPath)}｜${collectActivationTrace(project, episode)}`,
            };
          }

          const localOpenResult = await window.movtools.project.open({ projectRootPath: resolvedProjectRootPath.resolvedPath ?? resolvedProjectRootPath.configuredPath ?? project.projectRootPath });
          if (!localOpenResult.success) {
            return {
              success: false,
              error: localOpenResult.error ?? `${buildActivationPathError('项目根目录', resolvedProjectRootPath)}｜${collectActivationTrace(project, episode)}`,
            };
          }

          const localProjectId = localOpenResult.project?.projectId ?? localOpenResult.workspace?.activeProjectId ?? null;
          const localEpisodeId = localOpenResult.workspace?.activeEpisodeId ?? null;
          if (!localProjectId || !localEpisodeId) {
            return { success: false, error: '未能建立本地项目工作区。' };
          }

          this.activeProjectId = project.projectId;
          this.activeEpisodeId = episode.episodeId;
          try {
            const remoteEpisodeLenses = await fetchRemoteEpisodeLenses(episode.episodeId);
            const inferredTags = inferEpisodeTagsFromLenses(remoteEpisodeLenses, project.versionTag ?? episode.versionTag ?? 'ANI', project.layoutTag ?? episode.layoutTag ?? 'LAY');
            const resolvedLensFolderRootPath = activationPaths.lensFolderRootPath;
            if (resolvedLensFolderRootPath.missingServicePath) {
              return {
                success: false,
                error: `${buildActivationPathError('镜头根目录', resolvedLensFolderRootPath, episode.lensRoots ?? project.lensRoots)}｜${collectActivationTrace(project, episode)}`,
              };
            }

            if (resolvedLensFolderRootPath.localMismatch) {
              return {
                success: false,
                error: `${buildActivationPathError('镜头根目录', resolvedLensFolderRootPath, episode.lensRoots ?? project.lensRoots)}｜${collectActivationTrace(project, episode)}`,
              };
            }

            const resolvedLayoutCheckPath = activationPaths.layoutCheckPath;
            if (resolvedLayoutCheckPath.missingServicePath) {
              return {
                success: false,
                error: `${buildActivationPathError('Layout 根目录', resolvedLayoutCheckPath, episode.layoutRoots ?? project.layoutRoots)}｜${collectActivationTrace(project, episode)}`,
              };
            }

            if (resolvedLayoutCheckPath.localMismatch) {
              return {
                success: false,
                error: `${buildActivationPathError('Layout 根目录', resolvedLayoutCheckPath, episode.layoutRoots ?? project.layoutRoots)}｜${collectActivationTrace(project, episode)}`,
              };
            }

            const initResponse = await this.applyInitialization({
              projectId: localProjectId,
              episodeId: localEpisodeId,
              episodeCode: episode.episodeCode,
              episodeName: episode.episodeName,
              versionTag: episode.versionTag ?? project.versionTag ?? inferredTags.versionTag,
              layoutTag: episode.layoutTag ?? project.layoutTag ?? inferredTags.layoutTag,
              pendingClientActions: ['refresh_local_episode_workspace'],
              lensRoots: localLensRoots,
              layoutRoots: localLayoutRoots,
              lensSyncItems: remoteEpisodeLenses.map(mapRemoteLensToProjectLensSyncRequest),
            });
            if (!initResponse.success) {
              this.activeProjectId = null;
              this.activeEpisodeId = null;
              return {
                success: false,
                error: `本地项目 bootstrap 失败：${initResponse.error ?? initResponse.initResult?.message ?? '刷新本地集工作区失败。'}｜${collectActivationTrace(project, episode)}`,
              };
            }
          } catch (error) {
            this.activeProjectId = null;
            this.activeEpisodeId = null;
            return {
              success: false,
              error: error instanceof Error ? `刷新本地集工作区失败：${error.message}` : '刷新本地集工作区失败。',
            };
          }
          return {
            success: true,
            episode,
            workspace: await this.getWorkspace(),
          };
        }
      }

      return { success: false, error: '未找到对应集' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '设置当前集失败',
      };
    }
  }

  async deleteProject(projectCode: string, _removeFiles?: boolean): Promise<{ success: boolean; workspace?: ProjectWorkspace; error?: string }> {
    try {
      await apiClient.request(`/api/projects/${encodeURIComponent(projectCode)}`, { method: 'DELETE' });
      if (this.activeProjectId === projectCode) {
        this.activeProjectId = null;
        this.activeEpisodeId = null;
      }
      const workspace = await this.getWorkspace();
      return {
        success: true,
        workspace,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除项目失败',
      };
    }
  }
}

export const remoteProjectRepository = new RemoteProjectRepository();
