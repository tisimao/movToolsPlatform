import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ClipboardEvent as ReactClipboardEvent } from 'react';
import { canUseLocalFileChecks as canUseLocalFileChecksPermission, getPrimaryRole } from '../auth/permissions';
import { useAuthStore } from '../auth/store';
import type { BindFileType } from '../types/fileCheck';
import type { LensDetailPayload, LensLifecycleAttachment, LensLifecycleEvent, LensRecentStatusAction, LensRecord, LensStatus, LensStatusAction, LensVersionBinding, LensVersionIssue, LensVersionMatchDebug, MakerMatchStatus } from '../types/lens';
import type { LensMutationResponse } from '../types/ipc';
import { getBaseName, arrayBufferToBase64, pickImageFiles, extractPastedImages } from '../lib/imageAttachment';
import { resolveImageUrl } from '../lib/imageUrl';
import { useLensStore } from '../stores/lensStore';
import { useDirectorNavigationStore } from '../stores/directorNavigationStore';
import { useProjectStore } from '../stores/projectStore';
import { useDataSourceStore } from '../stores/dataSourceStore';
import { getDataSource, lensService, pathMappingService, reviewService } from '../services/repositoryService';
import { refreshAndSyncLensBindings } from '../lib/lensBindingSync';
import { DirectorFeedbackPlayback } from '../components/lens/DirectorFeedbackPlayback';
import { resolvePlaybackSource } from '../lib/reviewPlayback';
import { buildVersionScopedShotFeedbackView, type ShotFeedbackView } from '../lib/reviewFrameFeedback';
import { syncAutoInitializedLensFrames } from '../services/repositoryService';
import { apiClient } from '../api/client';
import { canMarkFixUpdated, canMarkReadyForReview, canResubmitForReview, canSubmitLens, getInternalReviewStatusLabel, getSubmissionDisabledReason, INTERNAL_REVIEW_STATUS_LABELS, type InternalReviewStatusCode } from '../lib/internalReview';
import { filterDirectorVisibleReviewTasks } from '../lib/reviewTaskVisibility';
import { DEFAULT_REVIEW_PLAYBACK_FPS } from '../lib/reviewPlaybackFps';
import { resolveProjectPlaybackFps } from '../lib/projectPlaybackFps';

interface LensFormState {
  lensCode: string;
  sceneNo: string;
  lensName: string;
  singleFrame: string;
  makerUserId: string;
  makerNameRaw: string;
  keepMakerNameRaw: boolean;
  versionNum: string;
  lensStatus: LensStatus;
}

type LensStatusFilter = LensStatus | 'all';
type ReadinessFilter = 'all' | 'ready' | 'missing';
type MissingItemFilter = 'all' | 'any' | 'ma' | 'mov' | 'layout';
type LensSortField = 'sequence' | 'lensCode' | 'updateTime' | 'versionNum' | 'maker';
type SortDirection = 'asc' | 'desc';
type ProblemTypeFilter =
  | 'all'
  | 'layout-missing'
  | 'layout-unselected'
  | 'layout-selected-missing'
  | 'ma-unbound'
  | 'mov-unbound'
  | 'multi-candidate'
  | 'frame-mismatch';
type InternalReviewFilter = 'all' | InternalReviewStatusCode;
type RecentActionFilter = 'all' | LensRecentStatusAction;
type RecentTimeRangeFilter = 'all' | 'today' | 'last2days' | 'last7days' | 'custom';
type LensDetailTab = 'versions' | 'layout' | 'history' | 'director-feedback';
type PreviewTarget = 'production' | 'layout';
type PreviewErrorState = Partial<Record<PreviewTarget, string>>;

type LensColumnKey = 'lensCode' | 'sceneNo' | 'lensName' | 'maker' | 'lensStatus' | 'internalReviewStatus' | 'singleFrame' | 'versionNum' | 'currentVersionReady' | 'layout' | 'layoutVideo' | 'updateTime' | 'recentAction';

const LENS_COLUMN_LABELS: Record<LensColumnKey, string> = {
  lensCode: '镜头编号',
  sceneNo: '场次',
  lensName: '镜头名称',
  maker: '制作人员',
  lensStatus: '镜头状态',
  internalReviewStatus: '二级状态',
  singleFrame: '帧数',
  versionNum: '当前版本',
  currentVersionReady: '当前版本文件状态',
  layout: 'Layout 状态',
  layoutVideo: 'Layout 视频状态',
  updateTime: '最近更新时间',
  recentAction: '最近状态动作',
};

const LENS_COLUMN_ORDER: LensColumnKey[] = ['lensCode', 'sceneNo', 'lensName', 'maker', 'lensStatus', 'internalReviewStatus', 'singleFrame', 'versionNum', 'currentVersionReady', 'layout', 'layoutVideo', 'updateTime', 'recentAction'];

const DEFAULT_LENS_COLUMNS: Record<LensColumnKey, boolean> = {
  lensCode: true,
  sceneNo: true,
  lensName: true,
  maker: true,
  lensStatus: true,
  internalReviewStatus: true,
  singleFrame: true,
  versionNum: true,
  currentVersionReady: true,
  layout: true,
  layoutVideo: true,
  updateTime: true,
  recentAction: true,
};

interface ReworkDialogState {
  mode: 'single' | 'batch';
  lensId?: string;
  lensName?: string;
  lensCount?: number;
  imagePaths: string[];
}

interface LensEditorDialogState {
  mode: 'create' | 'edit';
  lensId?: string;
}

interface DetailModalSize {
  width: number;
  height: number;
}

interface ReworkRecordEditorState {
  lensId: string;
  eventId: string;
  title: string;
  note: string;
  attachments: LensLifecycleAttachment[];
  keptAttachmentIds: string[];
  newImagePaths: string[];
}

interface ReworkAttachmentPreviewState {
  attachments: LensLifecycleAttachment[];
  activeIndex: number;
}



const defaultForm: LensFormState = {
  lensCode: '',
  sceneNo: '',
  lensName: '',
  singleFrame: '',
  makerUserId: '',
  makerNameRaw: '',
  keepMakerNameRaw: false,
  versionNum: 'V01',
  lensStatus: '制作',
};

const DEFAULT_LENS_FPS = DEFAULT_REVIEW_PLAYBACK_FPS;

function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function normalizePathForComparison(value: string): string {
  return value.replace(/[\\/]+/g, '\\').replace(/[\\/]+$/g, '').toUpperCase();
}

function getDefaultSourceRoot(fileType: BindFileType): string {
  return 'lens-root-main';
}

function getLensMakerMatchStatus(lens: LensRecord): MakerMatchStatus {
  if (lens.makerMatchStatus) {
    return lens.makerMatchStatus;
  }

  if (lens.makerUserId?.trim()) {
    return 'matched';
  }

  if (lens.makerNameRaw?.trim() || lens.maker?.trim()) {
    return 'unmatched';
  }

  return 'unassigned';
}

function getLensMakerDisplayText(lens: LensRecord, projectMembers: Array<{ userId: string; userName: string; displayName: string }>): string {
  const status = getLensMakerMatchStatus(lens);
  const matchedMember = lens.makerUserId ? projectMembers.find((member) => member.userId === lens.makerUserId) : null;

  if (status === 'matched') {
    return matchedMember?.displayName?.trim() || matchedMember?.userName?.trim() || lens.makerDisplayName?.trim() || lens.makerNameRaw?.trim() || lens.maker?.trim() || '已匹配';
  }

  if (status === 'unmatched') {
    return lens.makerNameRaw?.trim() || lens.maker?.trim() || '未匹配';
  }

  return '未指派';
}

function getLensMakerStatusLabel(status: MakerMatchStatus): string {
  switch (status) {
    case 'matched':
      return '已匹配';
    case 'unmatched':
      return '未匹配';
    case 'unassigned':
    default:
      return '未指派';
  }
}

async function resolveSourceRoot(filePath: string, fileType: BindFileType): Promise<string> {
  const response = await pathMappingService.getClientPathMappings();
  if (response.success) {
    const normalizedFilePath = normalizePathForComparison(filePath);
    const matched = [...response.mappings]
      .sort((left, right) => right.localAbsolutePath.length - left.localAbsolutePath.length)
      .find((mapping) => {
        const normalizedRoot = normalizePathForComparison(mapping.localAbsolutePath);
        return normalizedFilePath === normalizedRoot || normalizedFilePath.startsWith(`${normalizedRoot}\\`);
      });

    if (matched) {
      return matched.rootCode;
    }
  }

  return getDefaultSourceRoot(fileType);
}

function emptyMutation(): LensMutationResponse {
  return { success: true };
}

interface LensPageProps {
  onNavigate?: (page: string) => void;
}

export function LensPage({ onNavigate }: LensPageProps) {
  const { user } = useAuthStore();
  const currentRole = getPrimaryRole(user);
  const isMaker = currentRole === 'maker';
  const isProducer = currentRole === 'producer';
  const canOpenProducerReviewTask = currentRole === 'producer';
  const canCompleteFeedbackFix = currentRole === 'maker' || currentRole === 'producer' || currentRole === 'admin' || currentRole === 'system-admin';
  const columnStorageKey = `movtools.lens.columns.v1:${currentRole}`;
  const {
    activeProjectId: workspaceActiveProjectId,
    activeEpisodeId: workspaceActiveEpisodeId,
    projects,
    currentProjectMembers,
    setCurrentProjectMembers,
  } = useProjectStore();
  const { dataSource } = useDataSourceStore();
  const { activeProjectId, activeProjectName, activeEpisodeId, activeEpisodeName, activeEpisodeCode, lenses, setLensList } = useLensStore();
  const { pendingLensId, clearPendingLensId, setPendingReviewTaskId } = useDirectorNavigationStore();
  const [form, setForm] = useState<LensFormState>(defaultForm);
  const [editingLensId, setEditingLensId] = useState<string | null>(null);
  const [result, setResult] = useState<LensMutationResponse>(emptyMutation);
  const [isLoading, setIsLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<LensStatusFilter>('all');
  const [makerFilter, setMakerFilter] = useState('all');
  const [showClosedLenses, setShowClosedLenses] = useState(false);
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>('all');
  const [missingItemFilter, setMissingItemFilter] = useState<MissingItemFilter>('all');
  const [problemTypeFilter, setProblemTypeFilter] = useState<ProblemTypeFilter>('all');
  const [recentActionFilter, setRecentActionFilter] = useState<RecentActionFilter>('all');
  const [recentTimeRangeFilter, setRecentTimeRangeFilter] = useState<RecentTimeRangeFilter>('all');
  const [internalReviewFilter, setInternalReviewFilter] = useState<InternalReviewFilter>('all');
  const [recentStartDate, setRecentStartDate] = useState('');
  const [recentEndDate, setRecentEndDate] = useState('');
  const [selectedLensIds, setSelectedLensIds] = useState<string[]>([]);
  const [activeDetail, setActiveDetail] = useState<LensDetailPayload | null>(null);
  const [detailSearch, setDetailSearch] = useState('');
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [reworkDialog, setReworkDialog] = useState<ReworkDialogState | null>(null);
  const [reworkNote, setReworkNote] = useState('');
  const [reworkRecordEditor, setReworkRecordEditor] = useState<ReworkRecordEditorState | null>(null);
  const [isSavingReworkRecord, setIsSavingReworkRecord] = useState(false);
  const [previewingReworkAttachment, setPreviewingReworkAttachment] = useState<ReworkAttachmentPreviewState | null>(null);
  const [editorDialog, setEditorDialog] = useState<LensEditorDialogState | null>(null);
  const [activeReviewTaskId, setActiveReviewTaskId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<LensSortField>('lensCode');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [pendingBatchAction, setPendingBatchAction] = useState<'refresh' | 'submit' | 'approve' | 'rework' | 'close' | 'delete' | null>(null);
  const [draftTasks, setDraftTasks] = useState<import('../types/review').ReviewTaskSummary[]>([]);
  const [pendingStatusLensId, setPendingStatusLensId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<LensDetailTab>('versions');
  const [directorFeedbackView, setDirectorFeedbackView] = useState<ShotFeedbackView | null>(null);
  const [directorFeedbackSeekTarget, setDirectorFeedbackSeekTarget] = useState<{ frameNumber: number; requestId: number } | null>(null);
  const directorFeedbackSeekRequestRef = useRef(0);
  const [detailModalSize, setDetailModalSize] = useState<DetailModalSize | null>(null);
  const [isDetailModalMaximized, setIsDetailModalMaximized] = useState(false);
  const listRequestSeqRef = useRef(0);
  const detailResizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);
  const detailRequestSeqRef = useRef(0);
  const productionVideoRef = useRef<HTMLVideoElement | null>(null);
  const layoutVideoRef = useRef<HTMLVideoElement | null>(null);
  const [previewErrors, setPreviewErrors] = useState<PreviewErrorState>({});
  const [previewLoadStates, setPreviewLoadStates] = useState<Partial<Record<PreviewTarget, boolean>>>({});
  const [visibleColumns, setVisibleColumns] = useState<Record<LensColumnKey, boolean>>(DEFAULT_LENS_COLUMNS);
  const columnPanelStorageKey = `movtools.lens.columns.panel-collapsed.v1:${currentRole}`;
  const [isColumnSettingsCollapsed, setIsColumnSettingsCollapsed] = useState(true);
  const canEditLens = currentRole === 'producer' || currentRole === 'admin' || currentRole === 'system-admin';
  const canModifyLensList = canEditLens;
  const canUseLensMaintenance = true;
  const canUseBulkActions = !isMaker;
  const canUseLocalFileChecks = canUseLocalFileChecksPermission(user);
  const canUseInternalReviewActions = currentRole === 'producer' || currentRole === 'maker' || currentRole === 'admin' || currentRole === 'system-admin';

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(columnStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Record<LensColumnKey, boolean>>;
        setVisibleColumns({ ...DEFAULT_LENS_COLUMNS, ...parsed });
      } else {
        setVisibleColumns(DEFAULT_LENS_COLUMNS);
      }
    } catch {
      setVisibleColumns(DEFAULT_LENS_COLUMNS);
    }
  }, [columnStorageKey]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(columnPanelStorageKey);
      if (stored === null) {
        setIsColumnSettingsCollapsed(true);
        return;
      }

      setIsColumnSettingsCollapsed(stored === '1');
    } catch {
      setIsColumnSettingsCollapsed(true);
    }
  }, [columnPanelStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(columnStorageKey, JSON.stringify(visibleColumns));
  }, [columnStorageKey, visibleColumns]);

  useEffect(() => {
    try {
      window.localStorage.setItem(columnPanelStorageKey, isColumnSettingsCollapsed ? '1' : '0');
    } catch {
      // ignore local storage write failures
    }
  }, [columnPanelStorageKey, isColumnSettingsCollapsed]);

  useEffect(() => {
    if (!pendingLensId) {
      return;
    }

    if (activeDetail?.lens.lensId === pendingLensId) {
      clearPendingLensId();
      return;
    }

    void openLensDetail(pendingLensId).finally(() => {
      clearPendingLensId();
    });
  }, [activeDetail?.lens.lensId, clearPendingLensId, pendingLensId]);

  const visibleLensColumns = useMemo(() => LENS_COLUMN_ORDER.filter((column) => visibleColumns[column]), [visibleColumns]);

  function updateLensColumn(column: LensColumnKey, nextValue: boolean): void {
    if ((column === 'lensCode' || column === 'lensStatus') && !nextValue) {
      return;
    }

    setVisibleColumns((current) => ({ ...current, [column]: nextValue }));
  }

  function resetLensColumns(): void {
    setVisibleColumns(DEFAULT_LENS_COLUMNS);
  }

  function toggleColumnSettings(): void {
    setIsColumnSettingsCollapsed((current) => !current);
  }

  function denyLensWrite(): boolean {
    if (canEditLens) {
      return false;
    }

    setResult({ success: false, error: '当前角色仅可查看镜头。' });
    return true;
  }

  function renderVisibleTableHeaders(): ReactElement[] {
    return visibleLensColumns.map((column) => <th key={column}>{LENS_COLUMN_LABELS[column]}</th>);
  }

  function renderVisibleTableCell(lens: LensRecord, column: LensColumnKey): ReactElement | string | number {
    switch (column) {
      case 'lensCode':
        return (
          <button className="table-link-button" onClick={() => void openLensDetail(lens.lensId)} type="button">
            {lens.lensCode}
          </button>
        );
      case 'sceneNo':
        return lens.sceneNo || '-';
      case 'lensName':
        return lens.lensName || '-';
      case 'maker': {
        const makerText = getLensMakerDisplayText(lens, currentProjectMembers);
        const makerStatus = getLensMakerMatchStatus(lens);
        return (
          <div className="lens-issue-stack">
            <strong>{makerText}</strong>
            <small className={makerStatus === 'matched' ? 'success-copy' : makerStatus === 'unmatched' ? 'warning-copy' : 'muted'}>
              {getLensMakerStatusLabel(makerStatus)}
            </small>
          </div>
        );
      }
      case 'lensStatus':
        return <span className={statusClassName(lens.lensStatus)}>{lens.lensStatus}</span>;
      case 'internalReviewStatus':
        return (
          <div className="lens-issue-stack">
            <span className={internalReviewStatusClassName(lens.internalReviewStatusCode)}>{getInternalReviewStatusLabel(lens.internalReviewStatusCode, lens.internalReviewStatusName)}</span>
            <small className="muted">{lens.pendingDirectorFeedbackCount ?? 0} 条反馈</small>
          </div>
        );
      case 'singleFrame':
        return lens.singleFrame;
      case 'versionNum':
        return lens.versionNum || '-';
      case 'currentVersionReady':
        return (
          <div className={`lens-issue-stack lens-issue-stack--${getLensReminderSeverity(lens)}`}>
            <div className="lens-status-meta-row">
              {lens.currentVersionReady ? (
                <span className="environment-pill ready">版本完整</span>
              ) : (
                <span className={getLensReminderPillClassName(lens)}>{getLensReminderPillLabel(lens)}</span>
              )}
              <small className={lens.currentVersionReady ? 'muted' : getLensReminderTextClassName(lens)}>
                {getLensReminderTextLabel(lens)}
              </small>
            </div>
            {renderLensVersionMatchedFileNames(lens)}
          </div>
        );
      case 'layout':
        return (
          <div className="lens-issue-stack lens-layout-summary-cell">
            <div className="lens-status-meta-row">
              <span className={getLayoutSummaryPillClassName(lens)}>{getLayoutSummaryPillLabel(lens)}</span>
              <small className={getLayoutSummaryTextClassName(lens)}>{getLayoutIssueTypeLabel(lens)}</small>
            </div>
            <small className="muted">候选 {lens.layoutCandidateCount} · {lens.layoutReady ? '可用' : '待处理'}</small>
          </div>
        );
      case 'layoutVideo':
        return (
          <div className="lens-issue-stack lens-layout-summary-cell">
            <small className={lens.layoutVideoReady ? 'success-copy' : 'danger-copy'}>
              {lens.layoutVideoReady ? `视频：${lens.layoutVideoFileName || '已匹配'}` : '视频：未匹配'}
            </small>
            <small className="muted">{lens.layoutVideoRelativePath || '—'}</small>
          </div>
        );
      case 'updateTime':
        return formatLensDateTime(lens.updateTime);
      case 'recentAction':
        return (
          <div className="lens-issue-stack">
            <small className={lens.recentStatusActionLabel ? 'success-copy' : 'muted'}>{lens.recentStatusActionLabel || '暂无状态流转'}</small>
            <small className="muted">{lens.recentStatusActionTime || '—'}</small>
          </div>
        );
      default:
        return '-';
    }
  }

  function renderLensRowActions(lens: LensRecord): ReactElement {
    if (!canModifyLensList) {
      return (
        <div className="lens-row-actions">
          <button className="secondary-button lens-row-action-utility" onClick={() => void openLensDetail(lens.lensId)} type="button">查看详情</button>
          {canUseLocalFileChecks ? <button className="secondary-button lens-row-action-utility" onClick={() => void handleSingleLensCheck(lens.lensId)} type="button">检查文件</button> : null}
        </div>
      );
    }

    return (
      <div className="lens-row-actions">
        <div className="lens-row-action-group lens-row-action-group--status">
          <span className="lens-row-action-group-label">状态</span>
          <div className="lens-row-actions-grid">
            {lens.lensStatus === '制作' || lens.lensStatus === '返修' ? (
              <button className="secondary-button lens-row-action-primary" disabled={!canSubmitLens(lens.internalReviewStatusCode, lens.submissionAllowed) || pendingStatusLensId === lens.lensId} onClick={() => void handleStatusChange(lens.lensId, 'submit')} title={!canSubmitLens(lens.internalReviewStatusCode, lens.submissionAllowed) ? getSubmissionDisabledReason(lens) : undefined} type="button">
                {pendingStatusLensId === lens.lensId ? '处理中…' : '提交'}
              </button>
            ) : null}
            {lens.lensStatus === '提交' ? (
              <>
                <button className="secondary-button lens-row-action-primary" disabled={pendingStatusLensId === lens.lensId} onClick={() => void handleStatusChange(lens.lensId, 'approve')} type="button">
                  {pendingStatusLensId === lens.lensId ? '处理中…' : '通过'}
                </button>
                <button className="secondary-button lens-row-action-warning" disabled={pendingStatusLensId === lens.lensId} onClick={() => openSingleReworkDialog(lens)} type="button">
                  返修
                </button>
                <button className="secondary-button lens-row-action-neutral" disabled={pendingStatusLensId === lens.lensId} onClick={() => void handleCloseLens(lens)} type="button">
                  关闭
                </button>
              </>
            ) : null}
            {lens.lensStatus === '通过' ? (
              <button className="secondary-button lens-row-action-warning" disabled={pendingStatusLensId === lens.lensId} onClick={() => openSingleReworkDialog(lens)} type="button">
                返修
              </button>
            ) : null}
          </div>
        </div>
        {renderInternalReviewActions(lens)}
        <div className="lens-row-action-group lens-row-action-group--utility">
          <span className="lens-row-action-group-label">维护</span>
          <div className="lens-row-actions-grid">
            <button className="secondary-button lens-row-action-utility" onClick={() => void handleSingleLensCheck(lens.lensId)} type="button">
              检查文件
            </button>
            <button className="secondary-button lens-row-action-utility" onClick={() => openEditDialog(lens)} type="button">
              编辑
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderInternalReviewActions(lens: LensRecord): ReactElement {
    return (
      <div className="lens-row-action-group lens-row-action-group--review">
        <span className="lens-row-action-group-label">审片</span>
        <div className="lens-row-actions-grid">
          {canMarkReadyForReview(currentRole, lens.internalReviewStatusCode) ? (
            <button className="secondary-button lens-row-action-primary" disabled={pendingStatusLensId === lens.lensId} onClick={() => void updateInternalReviewStatus(lens.lensId, 'READY_FOR_REVIEW')} type="button">标记待提审</button>
          ) : null}
          {canResubmitForReview(currentRole, lens.internalReviewStatusCode) ? (
            <button className="secondary-button lens-row-action-primary" disabled={pendingStatusLensId === lens.lensId} onClick={() => void updateInternalReviewStatus(lens.lensId, 'READY_FOR_REVIEW')} type="button">重新提审</button>
          ) : null}
          {canMarkFixUpdated(currentRole, lens.internalReviewStatusCode) ? (
            <button className="secondary-button lens-row-action-primary" disabled={pendingStatusLensId === lens.lensId} onClick={() => void updateInternalReviewStatus(lens.lensId, 'FIX_UPDATED')} type="button">确认本轮反馈已处理完成</button>
          ) : null}
          {lens.latestReviewTaskId ? (
            <span className="muted" style={{ fontSize: '0.75rem' }}>任务: {lens.latestReviewTaskId.slice(0, 8)}</span>
          ) : null}
        </div>
      </div>
    );
  }

  async function refreshLenses(): Promise<void> {
    const requestSeq = listRequestSeqRef.current + 1;
    listRequestSeqRef.current = requestSeq;
    setIsLoading(true);
    try {
      const response = await lensService.listLenses();
      if (requestSeq !== listRequestSeqRef.current) {
        return;
      }

      setLensList({
        lenses: response.lenses,
        activeProjectId: response.activeProjectId,
        activeProjectName: response.activeProjectName,
        activeEpisodeId: response.activeEpisodeId,
        activeEpisodeName: response.activeEpisodeName,
        activeEpisodeCode: response.activeEpisodeCode,
        episodeVersionTag: response.episodeVersionTag,
        episodeLayoutTag: response.episodeLayoutTag,
      });

      if (!response.success) {
        setResult({ success: false, error: response.error });
      }
    } finally {
      if (requestSeq === listRequestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }

  function closeActiveDetail(): void {
    detailRequestSeqRef.current += 1;
    setActiveDetail(null);
    setActiveReviewTaskId(null);
    setDirectorFeedbackView(null);
    setDirectorFeedbackSeekTarget(null);
    setReworkRecordEditor(null);
    setPreviewingReworkAttachment(null);
    setIsDetailLoading(false);
  }

  async function openLensDetail(lensId: string): Promise<void> {
    const requestSeq = detailRequestSeqRef.current + 1;
    detailRequestSeqRef.current = requestSeq;
    setIsDetailLoading(true);
    try {
      const response = await lensService.getLensDetail(lensId);
      if (requestSeq !== detailRequestSeqRef.current) {
        return;
      }

      if (!response.success || !response.detail) {
        setResult({ success: false, error: response.error ?? '读取镜头详情失败。' });
        return;
      }

      setDetailSearch('');
      setDetailTab('versions');
      setDetailModalSize(getDefaultDetailModalSize());
      setIsDetailModalMaximized(false);
      setActiveDetail(response.detail);
      setActiveReviewTaskId(response.detail.lens.latestReviewTaskId ?? null);
      await refreshDirectorFeedbacks(lensId, response.detail.lens.versionNum);
      setReworkRecordEditor(null);
      setPreviewingReworkAttachment(null);
    } catch (error) {
      if (requestSeq === detailRequestSeqRef.current) {
        setResult({ success: false, error: error instanceof Error ? error.message : '读取镜头详情失败。' });
      }
    } finally {
      if (requestSeq === detailRequestSeqRef.current) {
        setIsDetailLoading(false);
      }
    }
  }

  async function refreshActiveDetail(options?: { silent?: boolean }): Promise<void> {
    if (!activeDetail) {
      return;
    }

    const lensId = activeDetail.lens.lensId;
    const requestSeq = detailRequestSeqRef.current + 1;
    detailRequestSeqRef.current = requestSeq;

    if (!options?.silent) {
      setIsDetailLoading(true);
    }

    try {
      const response = await lensService.getLensDetail(lensId);
      if (requestSeq !== detailRequestSeqRef.current) {
        return;
      }

      if (response.success && response.detail && response.detail.lens.lensId === lensId) {
        setActiveDetail(response.detail);
        setActiveReviewTaskId(response.detail.lens.latestReviewTaskId ?? null);
        await refreshDirectorFeedbacks(lensId, response.detail.lens.versionNum);
      }
    } finally {
      if (!options?.silent && requestSeq === detailRequestSeqRef.current) {
        setIsDetailLoading(false);
      }
    }
  }

  async function refreshDirectorFeedbacks(lensId: string, currentVersionNum?: string | null): Promise<void> {
    const response = await reviewService.listReviewFeedbacks(lensId);
    if (response.success) {
      setDirectorFeedbackView(buildVersionScopedShotFeedbackView(lensId, response, currentVersionNum, { shotId: lensId }));
    }
  }

  async function handleOpenReviewTaskFromLens(taskId: string): Promise<void> {
    if (currentRole !== 'director' && currentRole !== 'producer') {
      setResult({ success: false, error: '当前角色没有任务级审片入口。' });
      return;
    }

    const response = await reviewService.getTaskDetail(taskId);
    if (!response.success || !response.detail) {
      setResult({ success: false, error: response.error ?? '读取审片任务失败。' });
      return;
    }

    const taskVisibleToDirector = filterDirectorVisibleReviewTasks([
      {
        status: response.detail.status,
        producerStatus: response.detail.producerStatus,
      },
    ]).length > 0;

    setPendingReviewTaskId(taskId);
    onNavigate?.(taskVisibleToDirector ? 'review' : 'producer-review');
  }

  async function updateInternalReviewStatus(lensId: string, targetStatusCode: InternalReviewStatusCode): Promise<void> {
    if (!canUseInternalReviewActions) {
      setResult({ success: false, error: '当前角色无权操作二级状态。' });
      return;
    }

    if (pendingStatusLensId === lensId) {
      return;
    }

    const actionHint = targetStatusCode === 'FIX_UPDATED'
      ? '确认本轮导演反馈已全部处理完成？镜头将进入"已按反馈修改"状态，等待制片安排下一轮提审。'
      : targetStatusCode === 'READY_FOR_REVIEW'
        ? '确认该镜头已具备进入审片条件？制片将可将其加入审片任务。'
        : `确认将该镜头二级状态更新为「${INTERNAL_REVIEW_STATUS_LABELS[targetStatusCode]}」？`;
    const confirmed = window.confirm(actionHint);
    if (!confirmed) {
      return;
    }

    setPendingStatusLensId(lensId);
    try {
      const response = await lensService.updateInternalReviewStatus(lensId, targetStatusCode);
      if (response.success) {
        await refreshLenses();
        if (activeDetail?.lens.lensId === lensId) {
          await refreshActiveDetail();
        }
        setResult(response);
      } else {
        setResult(response);
      }
    } finally {
      setPendingStatusLensId(null);
    }
  }



  useEffect(() => {
    void refreshLenses();
  }, [workspaceActiveEpisodeId, workspaceActiveProjectId]);

  useEffect(() => {
    setSelectedLensIds((current) => current.filter((lensId) => lenses.some((lens) => lens.lensId === lensId)));
  }, [lenses]);

  useEffect(() => {
    const hasModalOpen = Boolean(activeDetail || editorDialog || reworkDialog || reworkRecordEditor || previewingReworkAttachment);
    if (!hasModalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      if (activeDetail) {
        closeActiveDetail();
        return;
      }

      if (editorDialog) {
        closeEditorDialog();
        return;
      }

      if (reworkDialog) {
        closeReworkDialog();
        return;
      }

      if (reworkRecordEditor) {
        closeReworkRecordEditor();
        return;
      }

      if (previewingReworkAttachment) {
        closeReworkAttachmentPreview();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [activeDetail, editorDialog, reworkDialog, reworkRecordEditor, previewingReworkAttachment]);

  useEffect(() => {
    if (!activeDetail || !detailModalSize) {
      return;
    }

    const handleWindowResize = () => {
      setDetailModalSize((current) => {
        if (isDetailModalMaximized) {
          return getMaximizedDetailModalSize();
        }

        return current ? clampDetailModalSize(current) : current;
      });
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [activeDetail, detailModalSize, isDetailModalMaximized]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = detailResizeRef.current;
      if (!resizeState) {
        return;
      }

      const nextWidth = resizeState.startWidth + (event.clientX - resizeState.startX);
      const nextHeight = resizeState.startHeight + (event.clientY - resizeState.startY);
      setDetailModalSize(clampDetailModalSize({ width: nextWidth, height: nextHeight }));
    };

    const handleMouseUp = () => {
      detailResizeRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Load draft tasks for producer batch operations
  useEffect(() => {
    if (!isProducer || !workspaceActiveProjectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await reviewService.listProducerTasks({ status: 'draft', projectId: workspaceActiveProjectId ?? undefined });
        if (!cancelled && response.success) setDraftTasks(response.tasks);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [isProducer, workspaceActiveProjectId]);

  async function handleBatchAddToDraft(): Promise<void> {
    if (selectedLensIds.length === 0 || draftTasks.length === 0) return;
    const taskNames = draftTasks.map((t, i) => `${i + 1}. ${t.taskName || t.taskId.slice(0, 8)}`).join('\n');
    const choice = window.prompt(`选择要加入的草稿任务（输入编号 1-${draftTasks.length}）：\n${taskNames}`);
    if (!choice) return;
    const index = Number(choice) - 1;
    if (index < 0 || index >= draftTasks.length) {
      setResult({ success: false, error: '无效选择。' });
      return;
    }
    const targetTask = draftTasks[index];
    const response = await reviewService.addTaskShots({ taskId: targetTask.taskId, shotIds: selectedLensIds });
    setResult(response);
    if (response.success) {
      setSelectedLensIds([]);
      await refreshLenses();
    }
  }

  async function handleBatchRemoveFromDraft(): Promise<void> {
    if (selectedLensIds.length === 0 || draftTasks.length === 0) return;
    const selectedSet = new Set(selectedLensIds);
    for (const task of draftTasks) {
      try {
        const detail = await reviewService.getTaskDetail(task.taskId);
        if (!detail.success || !detail.detail) continue;
        const shotsToRemove = detail.detail.shots.filter((s) => selectedSet.has(s.shotId));
        for (const shot of shotsToRemove) {
          await reviewService.removeTaskShot({ taskId: task.taskId, taskShotId: shot.taskShotId });
        }
      } catch { /* continue */ }
    }
    setResult({ success: true });
    setSelectedLensIds([]);
    await refreshLenses();
  }

  useEffect(() => {
    const projectCode = workspaceActiveProjectId ?? '';
    if (dataSource !== 'remote' || !projectCode) {
      setCurrentProjectMembers([]);
      return;
    }

    let cancelled = false;
    async function loadProjectMembers(): Promise<void> {
      try {
        const response = await apiClient.request<Array<{ userId: string; userName: string; displayName: string; projectRoleCode: string; isActive: boolean }>>(
          `/api/project-members?projectCode=${encodeURIComponent(projectCode)}`,
          { method: 'GET' },
        );
        if (!cancelled) {
          setCurrentProjectMembers(Array.isArray(response) ? response : []);
        }
      } catch {
        if (!cancelled) {
          setCurrentProjectMembers([]);
        }
      }
    }

    void loadProjectMembers();
    return () => {
      cancelled = true;
    };
  }, [dataSource, setCurrentProjectMembers, workspaceActiveProjectId]);

  const totalFrames = useMemo(() => lenses.reduce((sum, lens) => sum + lens.singleFrame, 0), [lenses]);
  const makerOptions = useMemo(() => [...new Set(lenses.map((lens) => getLensMakerDisplayText(lens, currentProjectMembers)).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN')), [currentProjectMembers, lenses]);
  const selectedLensIdSet = useMemo(() => new Set(selectedLensIds), [selectedLensIds]);
  const hasActiveCrossFilter = Boolean(
    searchKeyword.trim()
    || statusFilter !== 'all'
    || makerFilter !== 'all'
    || showClosedLenses
    || readinessFilter !== 'all'
    || missingItemFilter !== 'all'
    || problemTypeFilter !== 'all'
    || recentActionFilter !== 'all'
    || recentTimeRangeFilter !== 'all'
    || internalReviewFilter !== 'all'
    || recentStartDate
    || recentEndDate,
  );
  const scopedLenses = useMemo(() => {
    if (selectedLensIdSet.size === 0 || !hasActiveCrossFilter) {
      return lenses;
    }

    return lenses.filter((lens) => selectedLensIdSet.has(lens.lensId));
  }, [hasActiveCrossFilter, lenses, selectedLensIdSet]);

  const filteredLenses = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();

    const matched = scopedLenses.filter((lens) => {
      const makerText = getLensMakerDisplayText(lens, currentProjectMembers);
      const makerStatusText = getLensMakerStatusLabel(getLensMakerMatchStatus(lens));
        const matchesVisibility = showClosedLenses || statusFilter === '关闭' ? true : lens.lensStatus !== '关闭';
        const matchesKeyword = keyword
          ? [lens.lensCode, lens.lensName, makerText, makerStatusText, lens.makerNameRaw, lens.versionNum, lens.fileName, lens.currentVersionIssues.map((issue) => issue.message).join(' '), lens.currentVersionMatchedFileNames.join(' ')]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLowerCase().includes(keyword))
        : true;
      const matchesStatus = statusFilter === 'all' ? true : lens.lensStatus === statusFilter;
      const matchesMaker = makerFilter === 'all' ? true : makerText === makerFilter;
      const matchesRecentAction = recentActionFilter === 'all' ? true : lens.recentStatusAction === recentActionFilter;
      const matchesRecentTime = matchesRecentStatusTimeFilter(lens, recentTimeRangeFilter, recentStartDate, recentEndDate);
      const matchesReadiness = readinessFilter === 'all'
        ? true
        : readinessFilter === 'ready'
          ? lens.currentVersionReady
          : !lens.currentVersionReady;
      const matchesMissingItem = matchesLensMissingFilter(lens, missingItemFilter);
      const matchesProblemType = matchesProblemTypeFilter(lens, problemTypeFilter);
      const matchesInternalReview = internalReviewFilter === 'all' ? true : lens.internalReviewStatusCode === internalReviewFilter;
      return matchesVisibility && matchesKeyword && matchesStatus && matchesMaker && matchesRecentAction && matchesRecentTime && matchesReadiness && matchesMissingItem && matchesProblemType && matchesInternalReview;
    });

    return matched.sort((left, right) => compareLenses(left, right, sortField, sortDirection));
  }, [currentProjectMembers, makerFilter, missingItemFilter, problemTypeFilter, readinessFilter, recentActionFilter, recentEndDate, recentStartDate, recentTimeRangeFilter, scopedLenses, searchKeyword, showClosedLenses, sortDirection, sortField, statusFilter]);

  const filteredIssueLenses = useMemo(() => filteredLenses.filter(hasAnyLensIssue), [filteredLenses]);
  const filteredFrameCount = useMemo(() => filteredLenses.reduce((sum, lens) => sum + lens.singleFrame, 0), [filteredLenses]);
  const filteredMakingCount = useMemo(() => filteredLenses.filter((lens) => lens.lensStatus === '制作').length, [filteredLenses]);
  const filteredSubmittedCount = useMemo(() => filteredLenses.filter((lens) => lens.lensStatus === '提交').length, [filteredLenses]);
  const filteredReworkCount = useMemo(() => filteredLenses.filter((lens) => lens.lensStatus === '返修').length, [filteredLenses]);
  const filteredApprovedCount = useMemo(() => filteredLenses.filter((lens) => lens.lensStatus === '通过').length, [filteredLenses]);
  const filteredClosedCount = useMemo(() => filteredLenses.filter((lens) => lens.lensStatus === '关闭').length, [filteredLenses]);
  const filteredFrameRatio = totalFrames > 0 ? filteredFrameCount / totalFrames : 0;

  const selectedCount = selectedLensIds.length;
  const selectedFrameCount = useMemo(
    () => lenses.filter((lens) => selectedLensIdSet.has(lens.lensId)).reduce((sum, lens) => sum + lens.singleFrame, 0),
    [lenses, selectedLensIdSet],
  );

  const detailKeyword = detailSearch.trim().toLowerCase();
  const filteredDetailVersions = useMemo(() => {
    if (!activeDetail) {
      return [];
    }

    if (!detailKeyword) {
      return activeDetail.versions;
    }

    return activeDetail.versions.filter((version) => (
      [version.versionNum, version.fileName, version.issues.map((issue) => issue.message).join(' '), version.bindings.map((binding) => binding.relativePath).join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(detailKeyword)
    ));
  }, [activeDetail, detailKeyword]);

  const filteredDetailHistory = useMemo(() => {
    if (!activeDetail) {
      return [];
    }

    if (!detailKeyword) {
      return activeDetail.history;
    }

    return activeDetail.history.filter((event) => (
      [
        event.title,
        event.detail,
        event.reworkNote,
        event.versionNum,
        event.fileName,
        event.eventTime,
        event.attachments.map((attachment) => attachment.fileName).join(' '),
      ].join(' ').toLowerCase().includes(detailKeyword)
    ));
  }, [activeDetail, detailKeyword]);

  const currentDetailVersion = useMemo(() => {
    if (!activeDetail) {
      return null;
    }

    return activeDetail.versions.find((version) => version.versionNum === activeDetail.lens.versionNum) ?? activeDetail.versions[0] ?? null;
  }, [activeDetail]);

  const currentMovBinding = useMemo(() => currentDetailVersion?.bindings.find((binding) => binding.fileType === 'mov') ?? null, [currentDetailVersion]);
  const currentMovDebug = useMemo(() => currentDetailVersion?.matchDebug.mov ?? null, [currentDetailVersion]);
  const selectedLayoutCandidate = useMemo(
    () => activeDetail?.layoutCandidates.find((candidate) => candidate.isSelected) ?? activeDetail?.layoutCandidates[0] ?? null,
    [activeDetail],
  );
  const currentDirectorFeedbacks = useMemo(() => {
    return directorFeedbackView?.feedbacks ?? [];
  }, [directorFeedbackView]);

  const currentDirectorFeedbackRoundTimeline = useMemo(
    () => directorFeedbackView?.latestRoundDrawingTimeline ?? directorFeedbackView?.latestRoundDrawingFrames ?? [],
    [directorFeedbackView],
  );

  const currentProject = useMemo(
    () => (workspaceActiveProjectId ? projects.find((project) => project.projectId === workspaceActiveProjectId) ?? null : null),
    [projects, workspaceActiveProjectId],
  );
  const playbackFps = useMemo(() => resolveProjectPlaybackFps(currentProject), [currentProject]);

  const directorFeedbackPlaybackSource = useMemo(() => {
    if (!activeDetail) {
      return null;
    }

    const versionNum = activeDetail.lens.versionNum || activeDetail.versions[0]?.versionNum || null;
    return resolvePlaybackSource({
      shotId: activeDetail.lens.lensId,
      taskShotId: activeDetail.lens.lensId,
      lensCode: activeDetail.lens.lensCode,
      sortOrder: 0,
      submitVersionNum: versionNum,
      actualVersionNum: versionNum,
      feedbackCount: currentDirectorFeedbacks.length,
    }, activeDetail);
    }, [activeDetail, currentDirectorFeedbacks.length]);

  const directorFeedbackPlaybackNotice = useMemo(() => {
    if (!directorFeedbackPlaybackSource) {
      return '当前镜头没有可回放素材。';
    }

    if (!directorFeedbackPlaybackSource.isPlayable) {
      return '版本视频与 Layout 视频均未解析到可播放地址。';
    }

    if (directorFeedbackPlaybackSource.resolvedSourceType === 'layout') {
      return '当前使用 Layout 补位回放，正式版本视频缺失。';
    }

    if (directorFeedbackPlaybackSource.resolvedSourceType === 'fallback-version') {
      return '未命中当前版本，已自动切换到可播放版本。';
    }

    return '当前使用版本视频回放。';
  }, [directorFeedbackPlaybackSource]);

  function handleDirectorFeedbackCardClick(feedback: import('../types/review').ReviewFeedback): void {
    const frameNumber = feedback.frameNumber ?? 1;
    directorFeedbackSeekRequestRef.current += 1;
    setDirectorFeedbackSeekTarget({ frameNumber, requestId: directorFeedbackSeekRequestRef.current });
  }

  const hasPendingPreviewProxy = Boolean(currentMovBinding?.mediaPreviewMode === 'pending' || activeDetail?.lens.layoutVideoPreviewMode === 'pending');

  useEffect(() => {
    setPreviewErrors({});
    setPreviewLoadStates({
      production: Boolean(currentMovBinding?.mediaPreviewUrl),
      layout: Boolean(activeDetail?.lens.layoutVideoPreviewUrl),
    });
  }, [activeDetail?.lens.lensId, currentMovBinding?.mediaPreviewUrl, activeDetail?.lens.layoutVideoPreviewUrl]);

  useEffect(() => {
    if (!activeDetail || !hasPendingPreviewProxy) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshActiveDetail({ silent: true });
    }, 1500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeDetail, hasPendingPreviewProxy]);

  const detailRecommendations = useMemo(() => {
    if (!activeDetail) {
      return [] as string[];
    }

    const recommendations: string[] = [];
    if (!activeDetail.lens.currentVersionReady) {
      const missingSummary = getLensMissingFileTypeSummary(activeDetail.lens.currentVersionIssues);
      recommendations.push(`当前版本文件待补齐：${missingSummary || getVersionIssueTypeSummary(activeDetail.lens.currentVersionIssues)}`);
    }
    if (!activeDetail.lens.layoutReady) {
      recommendations.push(getLayoutIssueTypeLabel(activeDetail.lens));
    }
    if (activeDetail.lens.layoutReady && activeDetail.lens.layoutReferenceStatus !== '正常') {
      recommendations.push(activeDetail.lens.layoutReferenceStatus === '未检查' ? '建议执行当前采用 Layout 的引用排查' : `Layout 引用存在 ${activeDetail.lens.layoutReferenceIssueCount} 项问题`);
    }
    if (!currentMovBinding?.mediaPreviewUrl && activeDetail.lens.layoutVideoPreviewUrl) {
      recommendations.push('当前可先用 Layout 视频确认镜头节奏，制作视频补齐后再复核');
    }
    if (recommendations.length === 0) {
      recommendations.push('当前镜头文件与 Layout 状态稳定，可继续做状态流转或复核历史记录');
    }

    return recommendations;
  }, [activeDetail, currentMovBinding]);
  const hasDualPreview = Boolean(currentMovBinding?.mediaPreviewUrl && activeDetail?.lens.layoutVideoPreviewUrl);
  const detailModalClassName = useMemo(() => {
    const width = detailModalSize?.width ?? getDefaultDetailModalSize().width;
    const baseClassName = isDetailModalMaximized ? 'lens-detail-modal panel stack-gap is-maximized' : 'lens-detail-modal panel stack-gap';
    if (width < 980) {
      return `${baseClassName} is-narrow`;
    }
    if (width < 1220) {
      return `${baseClassName} is-compact`;
    }

    return baseClassName;
  }, [detailModalSize, isDetailModalMaximized]);

  function setPreviewError(target: PreviewTarget, message?: string): void {
    setPreviewErrors((current) => {
      if (!message) {
        if (!current[target]) {
          return current;
        }

        const next = { ...current };
        delete next[target];
        return next;
      }

      if (current[target] === message) {
        return current;
      }

      return {
        ...current,
        [target]: message,
      };
    });
  }

  function handleVideoPreviewError(target: PreviewTarget, event: React.SyntheticEvent<HTMLVideoElement>): void {
    setPreviewLoadStates((current) => ({ ...current, [target]: false }));
    const mediaError = event.currentTarget.error;
    const detail = mediaError ? `${mediaError.code}` : 'unknown';
    setPreviewError(target, `${getVideoElementErrorMessage(mediaError)}（code: ${detail}）`);
  }

  function handleVideoPreviewLoaded(target: PreviewTarget): void {
    setPreviewLoadStates((current) => ({ ...current, [target]: false }));
    setPreviewError(target);
  }

  function handleVideoPreviewLoadStart(target: PreviewTarget): void {
    setPreviewLoadStates((current) => ({ ...current, [target]: true }));
  }

  function handlePlaySinglePreview(target: PreviewTarget): void {
    const video = target === 'production' ? productionVideoRef.current : layoutVideoRef.current;
    if (!video) {
      return;
    }

    void video.play().then(() => {
      setPreviewError(target);
    }).catch((error: unknown) => {
      setPreviewError(target, getPlaybackFailureMessage(error));
    });
  }

  function handlePauseSinglePreview(target: 'production' | 'layout'): void {
    const video = target === 'production' ? productionVideoRef.current : layoutVideoRef.current;
    video?.pause();
  }

  function handlePlayBothPreviews(): void {
    const primary = productionVideoRef.current;
    const layout = layoutVideoRef.current;
    if (!primary || !layout) {
      return;
    }

    const startTime = Math.min(primary.currentTime || 0, layout.currentTime || 0);
    primary.currentTime = startTime;
    layout.currentTime = startTime;
    void Promise.allSettled([primary.play(), layout.play()]).then((results) => {
      const [productionResult, layoutResult] = results;
      setPreviewError('production', productionResult.status === 'rejected' ? getPlaybackFailureMessage(productionResult.reason) : undefined);
      setPreviewError('layout', layoutResult.status === 'rejected' ? getPlaybackFailureMessage(layoutResult.reason) : undefined);
    });
  }

  function handlePauseBothPreviews(): void {
    productionVideoRef.current?.pause();
    layoutVideoRef.current?.pause();
  }

  function handleResetBothPreviews(): void {
    [productionVideoRef.current, layoutVideoRef.current].forEach((video) => {
      if (!video) {
        return;
      }
      video.pause();
      video.currentTime = 0;
    });
  }

  function handleStartDetailResize(event: React.MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();

    const current = detailModalSize ?? getDefaultDetailModalSize();
    setIsDetailModalMaximized(false);
    detailResizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: current.width,
      startHeight: current.height,
    };
  }

  function toggleDetailModalMaximize(): void {
    if (isDetailModalMaximized) {
      setDetailModalSize(getDefaultDetailModalSize());
      setIsDetailModalMaximized(false);
      return;
    }

    setDetailModalSize(getMaximizedDetailModalSize());
    setIsDetailModalMaximized(true);
  }

  function fillForm(lens: LensRecord): void {
    const makerMatchStatus = getLensMakerMatchStatus(lens);
    const makerNameRaw = lens.makerNameRaw?.trim() || (makerMatchStatus !== 'matched' ? lens.maker?.trim() : '');
    setEditingLensId(lens.lensId);
    setForm({
      lensCode: lens.lensCode ?? '',
      sceneNo: String(lens.sceneNo ?? 0),
      lensName: lens.lensName ?? '',
      singleFrame: String(lens.singleFrame ?? ''),
      makerUserId: lens.makerUserId?.trim() || '',
      makerNameRaw,
      keepMakerNameRaw: Boolean(makerNameRaw),
      versionNum: lens.versionNum ?? '',
      lensStatus: lens.lensStatus ?? '制作',
    });
  }

  function openCreateDialog(): void {
    if (denyLensWrite()) return;
    resetForm();
    setEditorDialog({ mode: 'create' });
  }

  function openEditDialog(lens: LensRecord): void {
    if (denyLensWrite()) return;
    fillForm(lens);
    setEditorDialog({ mode: 'edit', lensId: lens.lensId });
  }

  function closeEditorDialog(): void {
    resetForm();
    setEditorDialog(null);
  }

  function resetForm(): void {
    setEditingLensId(null);
    setForm(defaultForm);
  }

  function toggleLensSelection(lensId: string): void {
    setSelectedLensIds((current) => (current.includes(lensId) ? current.filter((item) => item !== lensId) : [...current, lensId]));
  }

  function toggleSelectAllVisible(): void {
    const visibleIds = filteredLenses.map((lens) => lens.lensId);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((lensId) => selectedLensIds.includes(lensId));
    if (allVisibleSelected) {
      setSelectedLensIds((current) => current.filter((lensId) => !visibleIds.includes(lensId)));
      return;
    }

    setSelectedLensIds((current) => [...new Set([...current, ...visibleIds])]);
  }

  async function handleSubmit(): Promise<void> {
    if (denyLensWrite()) return;
    const editingLens = editingLensId ? lenses.find((lens) => lens.lensId === editingLensId) : null;
    const selectedMember = currentProjectMembers.find((member) => member.userId === form.makerUserId);
    const makerNameRaw = form.keepMakerNameRaw ? form.makerNameRaw.trim() : '';
    const makerMatchStatus: MakerMatchStatus = selectedMember ? 'matched' : makerNameRaw ? 'unmatched' : 'unassigned';
    const payload = {
      lensCode: form.lensCode.trim(),
      sceneNo: Number(form.sceneNo) || 0,
      lensName: form.lensName.trim() || form.lensCode.trim(),
      singleFrame: Number(form.singleFrame),
      maker: selectedMember?.displayName?.trim() || selectedMember?.userName?.trim() || makerNameRaw,
      makerUserId: selectedMember?.userId ?? null,
      makerNameRaw: makerNameRaw || null,
      makerMatchStatus,
      versionNum: form.versionNum.trim(),
      lensStatus: editingLens?.lensStatus ?? '制作',
      fileName: editingLens?.fileName ?? '',
    };

    try {
      const response = editingLensId
        ? await lensService.updateLens(editingLensId, payload)
        : await lensService.createLens(payload);

      setResult(response);
      if (response.success) {
        resetForm();
        setEditorDialog(null);
        await refreshLenses();
        await refreshActiveDetail();
      }
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : '镜头保存失败。',
      });
    }
  }

  async function handleDelete(lensId: string): Promise<void> {
    if (denyLensWrite()) return;
    const lens = lenses.find((item) => item.lensId === lensId);
    const confirmed = window.confirm(`删除镜头后，系统会尝试同步删除同名镜头文件夹（仅当文件夹为空时才允许删除）。${lens ? `\n\n镜头：${lens.lensName || lens.lensCode}` : ''}\n\n是否继续？`);
    if (!confirmed) {
      return;
    }

    const response = await lensService.deleteLens(lensId);
    setResult(response);
    if (response.success) {
      if (editingLensId === lensId) {
        resetForm();
      }
      if (activeDetail?.lens.lensId === lensId) {
        closeActiveDetail();
      }
      await refreshLenses();
    }
  }

  async function handleSingleLensCheck(lensId: string): Promise<void> {
    const response = await window.movtools.fileCheck.scanLens({ lensId });
    setResult(response);
    if (response.success) {
      await refreshLenses();
      if (activeDetail?.lens.lensId === lensId) {
        await refreshActiveDetail();
      }
    }
  }

  async function handleSingleLensLayoutReferenceCheck(lensId: string): Promise<void> {
    const response = await window.movtools.fileCheck.scanLensLayoutReferences({ lensId });
    setResult(response);
    if (!response.success || activeDetail?.lens.lensId !== lensId) {
      return;
    }

    const localState = await window.movtools.fileCheck.getState();
    if (localState.success) {
      const localCheck = localState.layoutReferenceChecks.find((check) => check.lensCode === activeDetail.lens.lensCode);
      if (localCheck) {
        setActiveDetail((current) => current ? {
          ...current,
          lens: {
            ...current.lens,
            layoutReferenceStatus: localCheck.status,
            layoutReferenceIssueCount: localCheck.issueCount,
            layoutReferenceLastCheckTime: localCheck.lastCheckTime,
          },
        } : current);
        return;
      }
    }

    await refreshActiveDetail({ silent: true });
  }

  async function autoRefreshLensBindings(lensIds: string[]): Promise<{ success: boolean; error?: string }> {
    const lensById = new Map(lenses.map((lens) => [lens.lensId, lens] as const));
    if (activeDetail?.lens.lensId) {
      lensById.set(activeDetail.lens.lensId, activeDetail.lens);
    }

    return refreshAndSyncLensBindings({
      lensIds,
      resolveLens: (lensId) => lensById.get(lensId),
      resolveLensDetail: async (lensId) => {
        const response = await lensService.getLensDetail(lensId);
        return response.success && response.detail ? response.detail : null;
      },
    });
  }

  async function refreshLocalLensBindings(lensIds: string[]): Promise<{ success: boolean; error?: string }> {
    const refreshResponse = await window.movtools.fileCheck.refreshLensBindings({ lensIds });
    if (!refreshResponse.success) {
      return { success: false, error: refreshResponse.error ?? '自动文件匹配失败。' };
    }

    const layoutRefreshResponse = await window.movtools.fileCheck.scanLayout();
    if (!layoutRefreshResponse.success) {
      return { success: false, error: layoutRefreshResponse.error ?? 'Layout 文件匹配失败。' };
    }

    return { success: true };
  }

  async function autoRefreshLayoutReferences(lensId: string): Promise<{ success: boolean; error?: string }> {
    const response = await window.movtools.fileCheck.scanLensLayoutReferences({ lensId });
    if (response.success) {
      return { success: true };
    }

    return { success: false, error: response.error ?? '自动 layout 引用排查失败。' };
  }

  async function handleStatusChange(lensId: string, action: LensStatusAction, note?: string, imagePaths?: string[]): Promise<void> {
    if (denyLensWrite()) return;
    if (pendingStatusLensId === lensId) {
      return;
    }

    if (action === 'submit') {
      const confirmed = window.confirm('确认要提交该镜头吗？提交后将进入“提交”状态。');
      if (!confirmed) {
        return;
      }
    }

    setPendingStatusLensId(lensId);
    try {
      const response = await lensService.updateLensStatus(lensId, action, note, imagePaths);
      if (response.success) {
        await refreshLenses();
        if (activeDetail?.lens.lensId === lensId) {
          await refreshActiveDetail();
        }
        const refreshResponse = await autoRefreshLensBindings([lensId]);
        setResult(refreshResponse.success ? response : { success: false, error: `状态已更新，但自动文件匹配失败：${refreshResponse.error}` });
        return;
      }

      setResult(response);
    } finally {
      setPendingStatusLensId(null);
    }
  }

  async function handleBatchStatusChange(action: LensStatusAction, note?: string, imagePaths?: string[]): Promise<void> {
    if (denyLensWrite()) return;
    if (selectedLensIds.length === 0) {
      setResult({ success: false, error: '请先选择要批量处理的镜头。' });
      return;
    }

    const actionLabel = action === 'submit'
      ? '批量提交'
      : action === 'approve'
        ? '批量通过'
        : action === 'rework'
          ? '批量返修'
          : '批量关闭';
    const confirmed = window.confirm(`将对 ${selectedLensIds.length} 条镜头执行“${actionLabel}”。\n\n是否继续？`);
    if (!confirmed) {
      return;
    }

    setPendingBatchAction(action);
    try {
      const response = await lensService.batchUpdateLensStatus(selectedLensIds, action, note, imagePaths);
      if (response.success) {
        await refreshLenses();
        await refreshActiveDetail();
        const refreshResponse = await autoRefreshLensBindings(selectedLensIds);
        setResult(refreshResponse.success ? { ...response, error: undefined } : { success: false, error: `批量状态已更新，但自动文件匹配失败：${refreshResponse.error}` });
      } else {
        setResult(response);
      }
    } finally {
      setPendingBatchAction(null);
    }
  }

  function openSingleReworkDialog(lens: LensRecord): void {
    setReworkNote('');
    setReworkDialog({ mode: 'single', lensId: lens.lensId, lensName: lens.lensName || lens.lensCode, imagePaths: [] });
  }

  function openBatchReworkDialog(): void {
    if (selectedLensIds.length === 0) {
      setResult({ success: false, error: '请先选择要批量处理的镜头。' });
      return;
    }

    setReworkNote('');
    setReworkDialog({ mode: 'batch', lensCount: selectedLensIds.length, imagePaths: [] });
  }

  function closeReworkDialog(): void {
    setReworkDialog(null);
    setReworkNote('');
  }

  async function handlePickReworkDialogImages(): Promise<void> {
    if (!reworkDialog) {
      return;
    }

    const filePaths = await pickImageFiles();
    if (filePaths.length === 0) {
      return;
    }

    setReworkDialog((current) => current ? {
      ...current,
      imagePaths: Array.from(new Set([...current.imagePaths, ...filePaths])),
    } : current);
  }

  async function extractPastedImagePaths(event: ReactClipboardEvent<HTMLElement>): Promise<string[]> {
    return extractPastedImages(event.clipboardData.items);
  }

  async function handlePasteReworkDialogImages(event: ReactClipboardEvent<HTMLElement>): Promise<void> {
    if (!reworkDialog) {
      return;
    }

    const filePaths = await extractPastedImagePaths(event);
    if (filePaths.length === 0) {
      return;
    }

    setReworkDialog((current) => current ? {
      ...current,
      imagePaths: Array.from(new Set([...current.imagePaths, ...filePaths])),
    } : current);
  }

  function removeReworkDialogImage(filePath: string): void {
    const confirmed = window.confirm(`确认移除待插入图片「${getBaseName(filePath)}」吗？`);
    if (!confirmed) {
      return;
    }

    setReworkDialog((current) => current ? {
      ...current,
      imagePaths: current.imagePaths.filter((item) => item !== filePath),
    } : current);
  }

  function moveReworkDialogImage(filePath: string, direction: 'up' | 'down'): void {
    setReworkDialog((current) => {
      if (!current) {
        return current;
      }

      const index = current.imagePaths.findIndex((item) => item === filePath);
      if (index === -1) {
        return current;
      }

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.imagePaths.length) {
        return current;
      }

      const nextImagePaths = [...current.imagePaths];
      const [moved] = nextImagePaths.splice(index, 1);
      nextImagePaths.splice(targetIndex, 0, moved);
      return { ...current, imagePaths: nextImagePaths };
    });
  }

  function openReworkRecordEditor(event: LensLifecycleEvent): void {
    setReworkRecordEditor({
      lensId: event.lensId,
      eventId: event.eventId,
      title: event.title,
      note: event.reworkNote ?? '',
      attachments: event.attachments,
      keptAttachmentIds: event.attachments.map((attachment) => attachment.attachmentId),
      newImagePaths: [],
    });
  }

  function closeReworkRecordEditor(): void {
    if (isSavingReworkRecord) {
      return;
    }

    setReworkRecordEditor(null);
  }

  function openReworkAttachmentPreview(attachments: LensLifecycleAttachment[], attachmentId: string): void {
    const activeIndex = attachments.findIndex((attachment) => attachment.attachmentId === attachmentId);
    if (activeIndex === -1) {
      return;
    }

    setPreviewingReworkAttachment({ attachments, activeIndex });
  }

  function closeReworkAttachmentPreview(): void {
    setPreviewingReworkAttachment(null);
  }

  function movePreviewingReworkAttachment(direction: 'prev' | 'next'): void {
    setPreviewingReworkAttachment((current) => {
      if (!current || current.attachments.length <= 1) {
        return current;
      }

      const delta = direction === 'prev' ? -1 : 1;
      const nextIndex = (current.activeIndex + delta + current.attachments.length) % current.attachments.length;
      return { ...current, activeIndex: nextIndex };
    });
  }

  async function handlePickReworkRecordImages(): Promise<void> {
    if (!reworkRecordEditor) {
      return;
    }

    const filePaths = await pickImageFiles();
    if (filePaths.length === 0) {
      return;
    }

    setReworkRecordEditor((current) => current ? {
      ...current,
      newImagePaths: Array.from(new Set([...current.newImagePaths, ...filePaths])),
    } : current);
  }

  async function handlePasteReworkRecordImages(event: ReactClipboardEvent<HTMLElement>): Promise<void> {
    if (!reworkRecordEditor) {
      return;
    }

    const filePaths = await extractPastedImagePaths(event);
    if (filePaths.length === 0) {
      return;
    }

    setReworkRecordEditor((current) => current ? {
      ...current,
      newImagePaths: Array.from(new Set([...current.newImagePaths, ...filePaths])),
    } : current);
  }

  function toggleReworkAttachment(attachmentId: string): void {
    setReworkRecordEditor((current) => {
      if (!current) {
        return current;
      }

      const attachment = current.attachments.find((item) => item.attachmentId === attachmentId);
      const isKept = current.keptAttachmentIds.includes(attachmentId);
      if (isKept) {
        const confirmed = window.confirm(`确认移除已保存图片「${attachment?.fileName ?? '未命名图片'}」吗？保存后将从返修记录中删除。`);
        if (!confirmed) {
          return current;
        }
      }

      const nextKeptIds = current.keptAttachmentIds.includes(attachmentId)
        ? current.keptAttachmentIds.filter((id) => id !== attachmentId)
        : [...current.keptAttachmentIds, attachmentId];
      return { ...current, keptAttachmentIds: nextKeptIds };
    });
  }

  function removePendingReworkImage(filePath: string): void {
    const confirmed = window.confirm(`确认移除待插入图片「${getBaseName(filePath)}」吗？`);
    if (!confirmed) {
      return;
    }

    setReworkRecordEditor((current) => current ? {
      ...current,
      newImagePaths: current.newImagePaths.filter((item) => item !== filePath),
    } : current);
  }

  function moveSavedReworkAttachment(attachmentId: string, direction: 'up' | 'down'): void {
    setReworkRecordEditor((current) => {
      if (!current) {
        return current;
      }

      const index = current.attachments.findIndex((attachment) => attachment.attachmentId === attachmentId);
      if (index === -1) {
        return current;
      }

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.attachments.length) {
        return current;
      }

      const nextAttachments = [...current.attachments];
      const [moved] = nextAttachments.splice(index, 1);
      nextAttachments.splice(targetIndex, 0, moved);
      const nextKeptAttachmentIds = nextAttachments
        .map((attachment) => attachment.attachmentId)
        .filter((id) => current.keptAttachmentIds.includes(id));
      return { ...current, attachments: nextAttachments, keptAttachmentIds: nextKeptAttachmentIds };
    });
  }

  function movePendingReworkImage(filePath: string, direction: 'up' | 'down'): void {
    setReworkRecordEditor((current) => {
      if (!current) {
        return current;
      }

      const index = current.newImagePaths.findIndex((item) => item === filePath);
      if (index === -1) {
        return current;
      }

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.newImagePaths.length) {
        return current;
      }

      const nextImagePaths = [...current.newImagePaths];
      const [moved] = nextImagePaths.splice(index, 1);
      nextImagePaths.splice(targetIndex, 0, moved);
      return { ...current, newImagePaths: nextImagePaths };
    });
  }

  async function submitReworkRecordEditor(): Promise<void> {
    if (!reworkRecordEditor || isSavingReworkRecord) {
      return;
    }

    setIsSavingReworkRecord(true);
    try {
      const response = await lensService.updateReworkRecord({
        lensId: reworkRecordEditor.lensId,
        eventId: reworkRecordEditor.eventId,
        note: reworkRecordEditor.note.trim() || undefined,
        keepAttachmentIds: reworkRecordEditor.keptAttachmentIds,
        newImagePaths: reworkRecordEditor.newImagePaths,
      });
      setResult(response);
      if (response.success) {
        await refreshActiveDetail();
        setReworkRecordEditor(null);
      }
    } finally {
      setIsSavingReworkRecord(false);
    }
  }

  async function submitReworkDialog(): Promise<void> {
    if (!reworkDialog) {
      return;
    }

    if (reworkDialog.mode === 'single' && reworkDialog.lensId) {
      await handleStatusChange(reworkDialog.lensId, 'rework', reworkNote.trim() || undefined, reworkDialog.imagePaths);
    }

    if (reworkDialog.mode === 'batch') {
      await handleBatchStatusChange('rework', reworkNote.trim() || undefined, reworkDialog.imagePaths);
    }

    closeReworkDialog();
  }

  async function handleBatchDelete(): Promise<void> {
    if (selectedLensIds.length === 0) {
      setResult({ success: false, error: '请先选择要删除的镜头。' });
      return;
    }

    const confirmed = window.confirm(`将批量删除 ${selectedLensIds.length} 条镜头记录。系统会同步检查并删除对应镜头文件夹，但只允许删除空文件夹；若任一文件夹内已有文件，本次删除会整体中止。\n\n是否继续？`);
    if (!confirmed) {
      return;
    }

    setPendingBatchAction('delete');
    try {
      const response = await lensService.batchDeleteLenses(selectedLensIds);
      setResult(response);
      if (response.success) {
        if (editingLensId && selectedLensIds.includes(editingLensId)) {
          resetForm();
        }
      if (activeDetail && selectedLensIds.includes(activeDetail.lens.lensId)) {
          closeActiveDetail();
        }
        setSelectedLensIds([]);
        await refreshLenses();
      }
    } finally {
      setPendingBatchAction(null);
    }
  }

  async function handleCloseLens(lens: LensRecord): Promise<void> {
    const confirmed = window.confirm(`关闭后镜头会保留在系统中，但默认不会显示在镜头列表。\n\n镜头：${lens.lensName || lens.lensCode}\n\n是否继续？`);
    if (!confirmed) {
      return;
    }

    await handleStatusChange(lens.lensId, 'close');
  }

  async function handleBatchRefreshBindings(): Promise<void> {
    if (lenses.length === 0) {
      setResult({ success: false, error: '当前没有可刷新的镜头。' });
      return;
    }

    setPendingBatchAction('refresh');
    try {
      const lensIds = lenses.map((lens) => lens.lensId);
      const response = isMaker
        ? await refreshLocalLensBindings(lensIds)
        : await autoRefreshLensBindings(lensIds);
      setResult(response.success ? { success: true } : response);
      if (response.success) {
        await refreshLenses();
        if (activeDetail) {
          await refreshActiveDetail();
        }

        if (isProducer) {
          const serverLensResponse = await lensService.listLenses();
          if (serverLensResponse.success) {
            await syncAutoInitializedLensFrames(serverLensResponse);
          }
        }
      }
    } finally {
      setPendingBatchAction(null);
    }
  }

  async function handleImport(): Promise<void> {
    if (denyLensWrite()) return;
    const filePath = await window.movtools.dialog.pickFile({
      title: '选择镜头导入 Excel',
      filters: [{ name: 'Excel Files', extensions: ['xls', 'xlsx'] }],
    });
    if (!filePath) {
      return;
    }

    const response = await lensService.importLenses(filePath);
    setResult(response);
    if (response.success) {
      await refreshLenses();
    }
  }

  async function handleExportIssueReport(): Promise<void> {
    if (denyLensWrite()) return;
    if (filteredIssueLenses.length === 0) {
      setResult({ success: false, error: '当前筛选结果中没有缺项镜头可导出。' });
      window.alert('当前筛选结果中没有缺项镜头可导出。');
      return;
    }

    const response = await lensService.exportIssueReport(filteredIssueLenses.map((lens) => lens.lensId), 'all-issues');
    setResult({
      success: response.success,
      error: response.success ? `已导出 ${response.exportedCount ?? filteredIssueLenses.length} 条缺项到：${response.filePath}` : response.error,
    });
    window.alert(response.success ? `缺项表已导出：${response.filePath}` : response.error ?? '导出缺项表失败。');
  }

  async function handleBindDetailFile(fileType: BindFileType): Promise<void> {
    if (!activeDetail) {
      return;
    }

    const currentVersion = activeDetail.versions.find((version) => version.versionNum === activeDetail.lens.versionNum);
    const preferredBinding = currentVersion?.bindings.find((binding) => binding.fileType === fileType);
    let defaultPath = preferredBinding?.absolutePath;

    if (getDataSource() === 'remote' && preferredBinding) {
      const sourceRoot = preferredBinding.sourceRoot?.trim() || getDefaultSourceRoot(fileType);
      const resolveResponse = await pathMappingService.resolveLogicalPath(sourceRoot, preferredBinding.relativePath);
      if (resolveResponse.success && resolveResponse.localPath) {
        defaultPath = resolveResponse.localPath;
      }
    }

    const filePath = await window.movtools.dialog.pickFile({
      title: fileType === 'ma' ? '选择当前版本 ma 文件' : '选择当前版本 mov（拍屏）文件',
      filters: [{ name: fileType.toUpperCase(), extensions: [fileType] }],
      defaultPath,
    });
    if (!filePath) {
      return;
    }

    const response = await window.movtools.fileCheck.bindFile({
      lensCode: activeDetail.lens.lensCode,
      versionNum: activeDetail.lens.versionNum,
      fileType,
      filePath,
    });
    if (!response.success) {
      setResult(response);
      return;
    }

    if (!response.binding) {
      setResult({ success: false, error: '文件已绑定，但未返回可同步的绑定元数据。' });
      return;
    }

    if (getDataSource() === 'remote') {
      const sourceRoot = await resolveSourceRoot(filePath, fileType);
      const syncResponse = await lensService.syncLensFileBinding(activeDetail.lens.lensId, {
        bindingType: fileType,
        relativePath: response.binding.relativePath,
        sourceRoot,
        versionNum: response.binding.versionNum ?? activeDetail.lens.versionNum,
        fileName: response.binding.fileName ?? getFileNameFromPath(filePath),
      });

      if (!syncResponse.success) {
        setResult(syncResponse);
        return;
      }

      setResult(syncResponse);
      await refreshLenses();
      await refreshActiveDetail();
      return;
    }

    const refreshResponse = await autoRefreshLensBindings([activeDetail.lens.lensId]);
    setResult(refreshResponse.success ? response : { success: false, error: `文件已绑定，但自动文件匹配失败：${refreshResponse.error}` });
    await refreshLenses();
    await refreshActiveDetail();
  }

  async function handleOpenBoundFile(binding: LensVersionBinding): Promise<void> {
    if (getDataSource() === 'remote') {
      const sourceRoot = binding.sourceRoot?.trim() || getDefaultSourceRoot(binding.fileType);
      const resolveResponse = await pathMappingService.resolveLogicalPath(sourceRoot, binding.relativePath);
      if (!resolveResponse.success || !resolveResponse.localPath) {
        setResult({ success: false, error: resolveResponse.error ?? '无法解析绑定文件的本地路径。' });
        return;
      }

      const response = await window.movtools.dialog.openPath(resolveResponse.localPath);
      setResult(response);
      return;
    }

    const response = await window.movtools.fileCheck.openBoundFile(binding.fileId);
    setResult(response);
  }

  async function handleSelectLayoutCandidate(lensCode: string, candidateId: string): Promise<void> {
    const response = await window.movtools.fileCheck.selectLayoutCandidate({ lensCode, candidateId });
    if (response.success) {
      await refreshStateAfterLayoutChange(response);
      return;
    }

    setResult(response);
  }

  async function handleAddLayoutCandidate(lensCode: string): Promise<void> {
    const filePath = await window.movtools.dialog.pickFile({
      title: '选择Layout Maya 文件',
      filters: [{ name: 'Maya ASCII', extensions: ['ma'] }],
    });
    if (!filePath) {
      return;
    }

    const response = await window.movtools.fileCheck.addLayoutCandidate({ lensCode, filePath, selectAfterAdd: true });
    if (response.success) {
      await refreshStateAfterLayoutChange(response);
      return;
    }

    setResult(response);
  }

  async function handleAddLayoutVideoBinding(lensCode: string, candidateId?: string): Promise<void> {
    if (!activeDetail) {
      return;
    }

    let resolvedCandidateId = candidateId;
    if (!resolvedCandidateId) {
      const layoutFilePath = await window.movtools.dialog.pickFile({
        title: '先选择当前对应的Layout Maya 文件',
        filters: [{ name: 'Maya ASCII', extensions: ['ma'] }],
      });
      if (!layoutFilePath) {
        return;
      }

      const addCandidateResponse = await window.movtools.fileCheck.addLayoutCandidate({
        lensCode,
        filePath: layoutFilePath,
        selectAfterAdd: true,
      });
      if (!addCandidateResponse.success) {
        setResult(addCandidateResponse);
        return;
      }

      await refreshStateAfterLayoutChange(addCandidateResponse);

      const detailResponse = await lensService.getLensDetail(activeDetail.lens.lensId);
      if (!detailResponse.success || !detailResponse.detail) {
        setResult({ success: false, error: detailResponse.error ?? '读取新增 Layout 候选后的镜头详情失败。' });
        return;
      }

      setActiveDetail(detailResponse.detail);
      resolvedCandidateId = detailResponse.detail.layoutCandidates.find((candidate) => candidate.isSelected)?.candidateId
        ?? detailResponse.detail.layoutCandidates[0]?.candidateId;
      if (!resolvedCandidateId) {
        setResult({ success: false, error: '已补充Layout Maya，但仍未找到可绑定视频的候选。' });
        return;
      }
    }

    const filePath = await window.movtools.dialog.pickFile({
      title: '选择Layout视频文件',
      filters: [{ name: '视频文件', extensions: ['mov', 'mp4', 'm4v', 'avi', 'mxf', 'mpg', 'mpeg', 'wmv'] }],
      defaultPath: activeDetail.lens.layoutVideoAbsolutePath || selectedLayoutCandidate?.absolutePath,
    });
    if (!filePath) {
      return;
    }

    const response = await window.movtools.fileCheck.addLayoutVideoBinding({ lensCode, candidateId: resolvedCandidateId, filePath });
    if (response.success) {
      await refreshStateAfterLayoutChange(response);
      return;
    }

    setResult(response);
  }

  async function refreshStateAfterLayoutChange(baseResponse?: { success: boolean; error?: string }): Promise<void> {
    if (activeDetail) {
      const [bindingRefresh, referenceRefresh] = await Promise.all([
        autoRefreshLensBindings([activeDetail.lens.lensId]),
        autoRefreshLayoutReferences(activeDetail.lens.lensId),
      ]);

      if (!bindingRefresh.success || !referenceRefresh.success) {
        const errors = [bindingRefresh.error, referenceRefresh.error].filter(Boolean).join('；');
        setResult({ success: false, error: `${baseResponse?.error ?? 'layout 已更新'}，但后续自动处理失败：${errors}` });
      } else if (baseResponse) {
        setResult(baseResponse);
      }
    } else if (baseResponse) {
      setResult(baseResponse);
    }

    await refreshLenses();
    await refreshActiveDetail();
  }

  const allVisibleSelected = filteredLenses.length > 0 && filteredLenses.every((lens) => selectedLensIds.includes(lens.lensId));

  return (
    <section className="page-layout">
      <header className="page-header lens-page-header">
        <div>
          <p className="eyebrow">镜头</p>
          <h2>镜头管理中心</h2>
          <div className="page-header-tags">
            <span className="page-header-tag">镜头生命周期</span>
            <span className="page-header-tag">文件绑定</span>
            <span className="page-header-tag">Layout协作</span>
          </div>
        </div>
        <div className="page-header-actions lens-header-actions">
          <p className="muted">当前项目：{activeProjectName || '未选择项目'}；当前集：{activeEpisodeCode ? `${activeEpisodeCode} / ${activeEpisodeName || activeEpisodeCode}` : '未选择集'}。现已按“制作 / 提交 / 返修 / 通过 / 关闭”生命周期管理当前集镜头。</p>
        </div>
      </header>

      <div className="lens-summary-grid">
        <article className="lens-summary-card">
          <span className="lens-summary-label">当前镜头数</span>
          <strong>{filteredLenses.length}</strong>
          <small className="muted">全项目 {lenses.length} 条</small>
          <small className="muted">当前范围：{selectedCount > 0 ? `已选 ${selectedCount} 条镜头优先交叉筛选` : '全部镜头'}{makerFilter === 'all' ? '' : ` · 制作人员 ${makerFilter}`}</small>
        </article>
        <article className="lens-summary-card">
          <span className="lens-summary-label">累计帧数</span>
          <strong>{filteredFrameCount}</strong>
          <small className="muted">{filteredFrameCount} 帧 / {formatFrameDuration(filteredFrameCount)} / {formatPercentage(filteredFrameRatio)}</small>
          <small className="muted">全项目 {totalFrames} 帧（{formatFrameDuration(totalFrames)}） · 已选 {selectedFrameCount} 帧 / {formatFrameDuration(selectedFrameCount)}</small>
        </article>
        <article className="lens-summary-card lens-summary-split">
          <div><span className="lens-summary-label">制作</span><strong>{filteredMakingCount}</strong></div>
          <div><span className="lens-summary-label">提交</span><strong>{filteredSubmittedCount}</strong></div>
          <div><span className="lens-summary-label">返修</span><strong>{filteredReworkCount}</strong></div>
          <div><span className="lens-summary-label">通过</span><strong>{filteredApprovedCount}</strong></div>
          <div><span className="lens-summary-label">关闭</span><strong>{filteredClosedCount}</strong></div>
        </article>
      </div>

      <div className="panel stack-gap lens-table-panel lens-management-panel">
            <div className="section-heading lens-toolbar-heading lens-toolbar-header">
            <div>
              <h3>镜头列表</h3>
              <div className="section-heading-tags">
                <span className="section-heading-tag">复杂筛选</span>
                <span className="section-heading-tag">批量流转</span>
                <span className="section-heading-tag">详情直达</span>
              </div>
              <p className="muted">支持排序、批量操作、单镜头文件检查；点击镜头编号可直接打开镜头详情，列表内仅保留高频操作。</p>
            </div>
              <div className="lens-selection-meta lens-selection-summary">
              <strong>已选 {selectedCount}</strong>
              <small className="muted">合计 {selectedFrameCount} 帧 / {formatFrameDuration(selectedFrameCount)} · 当前缺项 {filteredIssueLenses.length} 条</small>
            </div>
          </div>

          <div className="lens-filter-grid lens-filter-grid-wide lens-filter-toolbar">
            <label className="field">
              <span>搜索</span>
              <input onChange={(event) => setSearchKeyword(event.target.value)} placeholder="搜索镜头编号 / 名称 / 制作人员 / 版本 / 缺项提示" value={searchKeyword} />
            </label>

            <label className="field">
              <span>状态筛选</span>
              <select onChange={(event) => setStatusFilter(event.target.value as LensStatusFilter)} value={statusFilter}>
                <option value="all">全部状态</option>
                <option value="制作">制作</option>
                <option value="提交">提交</option>
                <option value="返修">返修</option>
                <option value="通过">通过</option>
                <option value="关闭">关闭</option>
              </select>
            </label>

            <label className="checkbox-field">
              <input checked={showClosedLenses} onChange={(event) => setShowClosedLenses(event.target.checked)} type="checkbox" />
              <span>显示已关闭镜头</span>
            </label>

            <label className="field">
              <span>制作人员</span>
              <select onChange={(event) => setMakerFilter(event.target.value)} value={makerFilter}>
                <option value="all">全部人员</option>
                {makerOptions.map((maker) => (
                  <option key={maker} value={maker}>{maker}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>近期操作</span>
              <select onChange={(event) => setRecentActionFilter(event.target.value as RecentActionFilter)} value={recentActionFilter}>
                <option value="all">全部操作</option>
                <option value="submit">最近提交</option>
                <option value="rework">最近返修</option>
                <option value="approve">最近通过</option>
                <option value="close">最近关闭</option>
              </select>
            </label>

            <label className="field">
              <span>时间范围</span>
              <select onChange={(event) => setRecentTimeRangeFilter(event.target.value as RecentTimeRangeFilter)} value={recentTimeRangeFilter}>
                <option value="all">全部时间</option>
                <option value="today">今天</option>
                <option value="last2days">近 2 天</option>
                <option value="last7days">近 7 天</option>
                <option value="custom">自定义日期</option>
              </select>
            </label>

            {recentTimeRangeFilter === 'custom' ? (
              <>
                <label className="field">
                  <span>开始日期</span>
                  <input onChange={(event) => setRecentStartDate(event.target.value)} type="date" value={recentStartDate} />
                </label>
                <label className="field">
                  <span>结束日期</span>
                  <input onChange={(event) => setRecentEndDate(event.target.value)} type="date" value={recentEndDate} />
                </label>
              </>
            ) : null}

            <label className="field">
              <span>版本文件</span>
              <select onChange={(event) => setReadinessFilter(event.target.value as ReadinessFilter)} value={readinessFilter}>
                <option value="all">全部</option>
                <option value="ready">当前版本完整</option>
                <option value="missing">当前版本缺项</option>
              </select>
            </label>

            <label className="field">
              <span>缺项筛选</span>
              <select onChange={(event) => setMissingItemFilter(event.target.value as MissingItemFilter)} value={missingItemFilter}>
                <option value="all">全部镜头</option>
                <option value="any">任意缺项</option>
                <option value="ma">缺 ma</option>
                <option value="mov">缺 mov</option>
                <option value="layout">缺 layout</option>
              </select>
            </label>

            <label className="field">
              <span>问题类型</span>
              <select onChange={(event) => setProblemTypeFilter(event.target.value as ProblemTypeFilter)} value={problemTypeFilter}>
                <option value="all">全部问题</option>
                <option value="layout-missing">Layout未发现候选</option>
                <option value="layout-unselected">Layout候选未确认</option>
                <option value="layout-selected-missing">Layout当前采用项缺失</option>
                <option value="ma-unbound">MA 未绑定/缺失</option>
                <option value="mov-unbound">MOV 未绑定/缺失</option>
                <option value="multi-candidate">多候选待确认</option>
                <option value="frame-mismatch">帧数不匹配</option>
              </select>
            </label>

            <label className="field">
              <span>二级状态</span>
              <select onChange={(event) => setInternalReviewFilter(event.target.value as InternalReviewFilter)} value={internalReviewFilter}>
                <option value="all">全部二级状态</option>
                <option value="NOT_IN_REVIEW">未进入审片</option>
                <option value="READY_FOR_REVIEW">待提审</option>
                <option value="IN_DIRECTOR_REVIEW">审片中</option>
                <option value="PENDING_FEEDBACK_FIX">待处理反馈</option>
                <option value="FIX_UPDATED">已按反馈修改</option>
                <option value="DIRECTOR_APPROVED">内部通过</option>
              </select>
            </label>

            <label className="field">
              <span>排序字段</span>
              <select onChange={(event) => setSortField(event.target.value as LensSortField)} value={sortField}>
                <option value="sequence">镜头序号</option>
                <option value="lensCode">镜头编号</option>
                <option value="updateTime">更新时间</option>
                <option value="versionNum">版本号</option>
                <option value="maker">制作人员</option>
              </select>
            </label>

            <label className="field">
              <span>排序方向</span>
              <select onChange={(event) => setSortDirection(event.target.value as SortDirection)} value={sortDirection}>
                <option value="asc">升序</option>
                <option value="desc">降序</option>
              </select>
            </label>
          </div>

            <div className="lens-column-settings panel stack-gap">
                <div className="section-heading">
                  <div>
                    <h4>列表列显示</h4>
                    <p className="muted">可单独控制镜头列表列的显示状态，并可本机保存；默认折叠。</p>
                  </div>
                  <div className="actions-row compact-actions wrap-actions">
                    <button className="secondary-button" onClick={toggleColumnSettings} type="button">
                      {isColumnSettingsCollapsed ? '展开设置' : '折叠设置'}
                    </button>
                    <button className="secondary-button" onClick={resetLensColumns} type="button">恢复默认</button>
                  </div>
                </div>
              {!isColumnSettingsCollapsed ? (
                <div className="lens-column-toggle-grid">
                  {LENS_COLUMN_ORDER.map((column) => (
                    <label className="checkbox-field" key={column}>
                      <input checked={visibleColumns[column]} disabled={(column === 'lensCode' || column === 'lensStatus') && !visibleColumns[column]} onChange={(event) => updateLensColumn(column, event.target.checked)} type="checkbox" />
                      <span>{LENS_COLUMN_LABELS[column]}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="lens-bulk-actions lens-bulk-actions-grid lens-bulk-zone">
            <div className="lens-bulk-group lens-bulk-group--utility">
              <div className="lens-bulk-group-heading">
                <strong>常规功能</strong>
                <small className="muted">新增、导入、导出与列表刷新。</small>
              </div>
              <div className="lens-bulk-group-buttons lens-bulk-group-buttons--utility">
                <button className="secondary-button lens-feedback-button" disabled={!activeProjectId || !activeEpisodeId || isLoading} onClick={() => void refreshLenses()} type="button">
                  {isLoading ? '刷新中…' : '刷新列表'}
                </button>
                {canUseLocalFileChecks ? (
                  <button className="secondary-button lens-feedback-button" disabled={lenses.length === 0 || pendingBatchAction !== null} onClick={() => void handleBatchRefreshBindings()} type="button">
                    {pendingBatchAction === 'refresh' ? '全量刷新中…' : isProducer ? `刷新全部文件匹配并同步服务器（${lenses.length}）` : `刷新全部文件匹配（${lenses.length}）`}
                  </button>
                ) : null}
                <button className="secondary-button lens-feedback-button" disabled={filteredIssueLenses.length === 0} onClick={() => void handleExportIssueReport()} type="button">
                  导出缺项 Excel（{filteredIssueLenses.length}）
                </button>
                {canModifyLensList ? (
                  <>
                    <button className="primary-button lens-feedback-button" disabled={!activeProjectId || !activeEpisodeId} onClick={openCreateDialog} type="button">
                      新增镜头
                    </button>
                    <button className="secondary-button lens-feedback-button" disabled={!activeProjectId || !activeEpisodeId} onClick={() => void handleImport()} type="button">
                      Excel 批量导入
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {isProducer ? (
              <div className="lens-bulk-group lens-bulk-group--utility">
                <div className="lens-bulk-group-heading">
                  <strong>审片任务批量操作</strong>
                  <small className="muted">将已选镜头加入审片任务或从草稿任务中移除。</small>
                </div>
                <div className="lens-bulk-group-buttons lens-bulk-group-buttons--utility">
                  <button className="secondary-button lens-feedback-button" disabled={selectedCount === 0} onClick={() => onNavigate?.('producer-review')} type="button">
                    加入新任务（{selectedCount}）
                  </button>
                  <button className="secondary-button lens-feedback-button" disabled={selectedCount === 0 || draftTasks.length === 0} onClick={() => void handleBatchAddToDraft()} type="button">
                    加入草稿任务（{selectedCount}）
                  </button>
                  <button className="secondary-button lens-feedback-button" disabled={selectedCount === 0 || draftTasks.length === 0} onClick={() => void handleBatchRemoveFromDraft()} type="button">
                    从草稿任务移除（{selectedCount}）
                  </button>
                </div>
              </div>
            ) : null}

            {canModifyLensList ? (
            <div className="lens-bulk-group lens-bulk-group--danger">
              <div className="lens-bulk-group-heading">
                <strong>⚠ 批量高风险操作区</strong>
                <small className="muted">仅处理当前已选镜头；执行前都会二次确认，请再次核对选中数量与镜头范围。</small>
              </div>
              <div className="lens-bulk-danger-banner">
                <strong>当前已选 {selectedCount} 条镜头</strong>
                <span>建议先检查筛选条件与勾选状态，再执行批量流转或删除。</span>
              </div>
              <div className="lens-bulk-group-buttons lens-bulk-group-buttons--danger">
                <button className="secondary-button lens-feedback-button lens-bulk-caution-button" disabled={selectedCount === 0 || pendingBatchAction !== null} onClick={() => void handleBatchStatusChange('submit')} type="button">
                  {pendingBatchAction === 'submit' ? '提交中…' : '确认后批量提交'}
                </button>
                <button className="secondary-button lens-feedback-button lens-bulk-caution-button" disabled={selectedCount === 0 || pendingBatchAction !== null} onClick={() => void handleBatchStatusChange('approve')} type="button">
                  {pendingBatchAction === 'approve' ? '通过处理中…' : '确认后批量通过'}
                </button>
                <button className="secondary-button lens-feedback-button lens-bulk-caution-button" disabled={selectedCount === 0 || pendingBatchAction !== null} onClick={openBatchReworkDialog} type="button">
                  {pendingBatchAction === 'rework' ? '返修处理中…' : '确认后批量返修'}
                </button>
                <button className="secondary-button lens-feedback-button lens-bulk-caution-button" disabled={selectedCount === 0 || pendingBatchAction !== null} onClick={() => void handleBatchStatusChange('close')} type="button">
                  {pendingBatchAction === 'close' ? '关闭处理中…' : '确认后批量关闭'}
                </button>
                <button className="secondary-button lens-danger-button lens-feedback-button" disabled={selectedCount === 0 || pendingBatchAction !== null} onClick={() => void handleBatchDelete()} type="button">
                  {pendingBatchAction === 'delete' ? '删除中…' : '确认后批量删除'}
                </button>
              </div>
            </div>
            ) : null}
          </div>

          {filteredLenses.length > 0 ? (
            <div className="lens-table-shell">
              <table className="lens-table">
                <thead>
                  <tr>
                    <th>
                      <input checked={allVisibleSelected} onChange={() => toggleSelectAllVisible()} type="checkbox" />
                    </th>
                    {renderVisibleTableHeaders()}
                    {canModifyLensList ? <th className="lens-table-actions-col">操作</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredLenses.map((lens) => {
                    const isSelected = selectedLensIds.includes(lens.lensId);
                    return (
                      <tr className={isSelected ? 'is-selected' : ''} key={lens.lensId}>
                        <td>
                          <input checked={isSelected} onChange={() => toggleLensSelection(lens.lensId)} type="checkbox" />
                        </td>
                        {visibleLensColumns.map((column) => <td key={`${lens.lensId}-${column}`}>{renderVisibleTableCell(lens, column)}</td>)}
                        {canModifyLensList ? <td className="lens-table-actions-col">{renderLensRowActions(lens)}</td> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="lens-empty-state">
              <p className="muted">当前筛选条件下没有镜头记录。</p>
              <small className="muted">可以清空筛选、勾选“显示已关闭镜头”、手动创建镜头，或导入 Excel 批量创建。</small>
            </div>
          )}
      </div>

      {editorDialog ? (
        <div className="lens-detail-modal-overlay" onClick={closeEditorDialog} role="presentation">
          <div className="lens-editor-modal panel stack-gap lens-editor-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <div>
                <h3>{editorDialog.mode === 'edit' ? '编辑镜头基础信息' : '新增镜头'}</h3>
                <p className="muted">镜头创建后默认进入制作状态，版本自动从 V01 起步；提交后可继续流转为通过、返修或关闭。</p>
              </div>
              <button className="secondary-button" onClick={closeEditorDialog} type="button">关闭</button>
            </div>

            <div className="form-grid lens-form-grid">
              <label className="field">
                <span>镜头编号</span>
                <input onChange={(event) => setForm((current) => ({ ...current, lensCode: event.target.value }))} value={form.lensCode} />
              </label>
              <label className="field">
                <span>镜头名称</span>
                <input onChange={(event) => setForm((current) => ({ ...current, lensName: event.target.value }))} placeholder="留空则默认等于镜头编号" value={form.lensName} />
              </label>
              <label className="field">
                <span>场次</span>
                <input onChange={(event) => setForm((current) => ({ ...current, sceneNo: event.target.value }))} type="number" value={form.sceneNo} />
              </label>
              <label className="field">
                <span>单镜头帧数</span>
                <input onChange={(event) => setForm((current) => ({ ...current, singleFrame: event.target.value }))} type="number" value={form.singleFrame} />
              </label>
              <label className="field">
                <span>正式制作人员</span>
                <select onChange={(event) => setForm((current) => ({ ...current, makerUserId: event.target.value }))} value={form.makerUserId}>
                  <option value="">未指派</option>
                  {currentProjectMembers.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.displayName || member.userName} ({member.userName})
                    </option>
                  ))}
                </select>
                <small className="muted">
                  {currentProjectMembers.length > 0 ? '只能从当前项目成员中选择账号。' : '当前项目暂无成员，保存后将保持未指派。'}
                </small>
              </label>
              <label className="field">
                <span>原始姓名线索</span>
                <input disabled={!form.keepMakerNameRaw} onChange={(event) => setForm((current) => ({ ...current, makerNameRaw: event.target.value }))} placeholder="导入时的原始姓名" value={form.makerNameRaw} />
                <label className="checkbox-field" style={{ marginTop: 8 }}>
                  <input checked={form.keepMakerNameRaw} onChange={(event) => setForm((current) => ({ ...current, keepMakerNameRaw: event.target.checked }))} type="checkbox" />
                  <span>保留原始姓名线索</span>
                </label>
              </label>
              <label className="field">
                <span>版本号</span>
                <input
                  disabled={form.lensStatus !== '制作'}
                  onChange={(event) => setForm((current) => ({ ...current, versionNum: event.target.value.toUpperCase() }))}
                  placeholder="例如 V01"
                  value={form.versionNum}
                />
              <small className="muted">仅首次创建默认为制作；返修后状态保持为返修。提交 / 返修 / 通过 / 关闭状态下版本号均不支持手动跳版。</small>
              </label>
              <label className="field">
                <span>当前状态</span>
                <input disabled value={editingLensId ? form.lensStatus : '制作'} />
              </label>
            </div>

            <div className="actions-row wrap-actions lens-form-actions">
              <button className="primary-button" disabled={!activeProjectId || !activeEpisodeId} onClick={() => void handleSubmit()} type="button">
                {editorDialog.mode === 'edit' ? '保存镜头' : '创建镜头'}
              </button>
              <button className="secondary-button" onClick={closeEditorDialog} type="button">取消</button>
            </div>

            <div className="lens-form-feedback">
              <span className={result.success ? 'success-copy' : 'danger-copy'}>
                {result.success ? '镜头数据已同步到当前集。' : result.error ?? '准备就绪。'}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {activeDetail ? (
        <div className="lens-detail-modal-overlay" onClick={closeActiveDetail} onWheel={(event) => event.stopPropagation()} role="presentation">
          <div
            className={detailModalClassName}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            style={detailModalSize ? { width: detailModalSize.width, height: detailModalSize.height } : undefined}
          >
            <div className="section-heading">
              <div>
                <h3>{activeDetail.lens.lensCode} · 镜头详情</h3>
                 <p className="muted">状态 {activeDetail.lens.lensStatus} · 版本 {activeDetail.lens.versionNum} · 共 {activeDetail.history.length} 条记录 · 制作人 {getLensMakerDisplayText(activeDetail.lens, currentProjectMembers)} · {getLensMakerStatusLabel(getLensMakerMatchStatus(activeDetail.lens))}</p>
              </div>
                <div className="actions-row compact-actions lens-detail-window-actions">
                <button className="secondary-button" onClick={toggleDetailModalMaximize} type="button">
                  {isDetailModalMaximized ? '还原窗口' : '最大化'}
                </button>
                <button className="secondary-button" onClick={closeActiveDetail} type="button">
                  关闭
                </button>
              </div>
            </div>

            <div className="lens-detail-summary-shell">
              <div className="lens-detail-summary-grid">
                <article className="lens-summary-card">
                  <span className="lens-summary-label">当前版本</span>
                  <strong>{activeDetail.lens.versionNum}</strong>
                  <small className="muted">字段 {activeDetail.lens.versionTag} · {activeDetail.lens.fileName}</small>
                </article>
                <article className="lens-summary-card">
                  <span className="lens-summary-label">二级状态</span>
                  <strong className={internalReviewStatusClassName(activeDetail.lens.internalReviewStatusCode)}>{getInternalReviewStatusLabel(activeDetail.lens.internalReviewStatusCode, activeDetail.lens.internalReviewStatusName)}</strong>
                  <small className="muted">更新 {formatLensDateTime(activeDetail.lens.internalReviewUpdatedAtUtc || activeDetail.lens.updateTime)} · {activeDetail.lens.pendingDirectorFeedbackCount ?? 0} 条反馈</small>
                  {activeDetail.lens.latestDirectorFeedbackAtUtc ? <small className="muted">最近反馈 {formatLensDateTime(activeDetail.lens.latestDirectorFeedbackAtUtc)}</small> : null}
                </article>
                <article className="lens-summary-card">
                  <span className="lens-summary-label">所属审片任务</span>
                    {activeDetail.lens.latestReviewTaskId ? (
                      <>
                        <strong>{activeDetail.lens.latestReviewTaskId.slice(0, 8)}...</strong>
                        {currentRole === 'director' ? (
                          <button className="ghost-button" onClick={() => { if (activeDetail?.lens.latestReviewTaskId) { void handleOpenReviewTaskFromLens(activeDetail.lens.latestReviewTaskId); } }} style={{ fontSize: '0.75rem' }} type="button">进入导演审片</button>
                        ) : canOpenProducerReviewTask ? (
                          <button className="ghost-button" onClick={() => { if (activeDetail?.lens.latestReviewTaskId) { void handleOpenReviewTaskFromLens(activeDetail.lens.latestReviewTaskId); } }} style={{ fontSize: '0.75rem' }} type="button">定位到制片任务页</button>
                        ) : null}
                      </>
                    ) : (
                    <>
                      <strong className="muted">未加入任务</strong>
                      {isProducer ? <small className="muted">可勾选后从"审片任务批量操作"加入任务</small> : null}
                    </>
                  )}
                </article>
                <article className="lens-summary-card">
                  <span className="lens-summary-label">制作信息</span>
                  <strong>{getLensMakerDisplayText(activeDetail.lens, currentProjectMembers)}</strong>
                  <small className={getLensMakerMatchStatus(activeDetail.lens) === 'matched' ? 'success-copy' : getLensMakerMatchStatus(activeDetail.lens) === 'unmatched' ? 'warning-copy' : 'muted'}>
                    {getLensMakerStatusLabel(getLensMakerMatchStatus(activeDetail.lens))}
                  </small>
                  {activeDetail.lens.makerNameRaw ? <small className="muted">原始线索：{activeDetail.lens.makerNameRaw}</small> : null}
                  <small className="muted">场次 {activeDetail.lens.sceneNo || '—'} · {activeDetail.lens.singleFrame} 帧</small>
                </article>
                <article className="lens-summary-card">
                  <span className="lens-summary-label">版本文件</span>
                  <strong>{getLensReminderHeadline(activeDetail.lens)}</strong>
                  <small className={getLensReminderTextClassName(activeDetail.lens)}>{getLensReminderTextLabel(activeDetail.lens)}</small>
                  {renderLensVersionMatchedFileNames(activeDetail.lens)}
                </article>
                <article className="lens-summary-card">
                  <span className="lens-summary-label">Layout</span>
                  <strong>{getLayoutSummaryHeadline(activeDetail.lens)}</strong>
                  <small className="muted">{getLayoutIssueTypeLabel(activeDetail.lens)}</small>
                </article>
                <article className="lens-summary-card lens-summary-card--compact">
                  <span className="lens-summary-label">引用排查</span>
                  <strong>{activeDetail.lens.layoutReferenceStatus}</strong>
                  <small className="muted">{activeDetail.lens.layoutReferenceIssueCount > 0 ? `问题 ${activeDetail.lens.layoutReferenceIssueCount} 项` : activeDetail.lens.layoutReferenceLastCheckTime || '尚未检查'}</small>
                </article>
                <article className="lens-summary-card lens-summary-card--compact">
                  <span className="lens-summary-label">最近操作</span>
                  <strong>{activeDetail.lens.recentStatusActionLabel || '暂无'}</strong>
                  <small className="muted">{formatLensDateTime(activeDetail.lens.recentStatusActionTime || activeDetail.lens.updateTime)}</small>
                </article>
                <article className="lens-summary-card lens-summary-card--compact">
                  <span className="lens-summary-label">最近更新</span>
                  <strong>{formatLensDateTime(activeDetail.lens.updateTime)}</strong>
                  <small className={activeDetail.lens.currentVersionReady ? 'muted' : 'warning-copy'}>Layout视频 {activeDetail.lens.layoutVideoReady ? '已匹配' : '未匹配'}</small>
                </article>
              </div>

              <div className="lens-detail-overview-grid">
                <article className="lens-history-card lens-detail-quick-actions lens-detail-quick-actions--compact">
                  <div className="section-heading lens-version-header">
                    <div>
                      <h4>下一步建议</h4>
                      <p className="muted">收敛当前镜头最值得优先处理的动作，减少在各个区域来回找按钮。</p>
                    </div>
                  </div>
                  <ul className="lens-issue-list lens-detail-recommendation-list">
                    {detailRecommendations.map((recommendation) => (
                      <li className="muted" key={recommendation}>{recommendation}</li>
                    ))}
                  </ul>
                </article>

                <article className="lens-history-card lens-detail-quick-actions lens-detail-quick-actions--compact">
                  <div className="section-heading lens-version-header">
                    <div>
                      <h4>快捷操作</h4>
                        <p className="muted">把状态流转和少量全局操作收敛到这里；文件绑定与Layout维护放回各自分区里处理。</p>
                    </div>
                  </div>
                  <div className="actions-row compact-actions wrap-actions lens-detail-inline-actions lens-detail-inline-actions--summary lens-detail-primary-actions">
                    <button className="secondary-button" disabled={isDetailLoading} onClick={() => void refreshActiveDetail()} type="button">{isDetailLoading ? '刷新中…' : '刷新详情'}</button>
                    {canUseLocalFileChecks ? <button className="secondary-button" disabled={isDetailLoading} onClick={() => void handleSingleLensCheck(activeDetail.lens.lensId)} type="button">检查文件</button> : null}
                    {activeDetail.lens.latestReviewTaskId ? (
                      currentRole === 'director' ? (
                        <button className="secondary-button" onClick={() => { void handleOpenReviewTaskFromLens(activeDetail.lens.latestReviewTaskId!); }} type="button">到导演审片</button>
                      ) : canOpenProducerReviewTask ? (
                        <button className="secondary-button" onClick={() => { void handleOpenReviewTaskFromLens(activeDetail.lens.latestReviewTaskId!); }} type="button">到制片任务页</button>
                      ) : null
                    ) : null}
                    {canCompleteFeedbackFix && activeDetail.lens.internalReviewStatusCode === 'PENDING_FEEDBACK_FIX' ? (
                      <button className="secondary-button lens-row-action-primary" disabled={pendingStatusLensId === activeDetail.lens.lensId} onClick={() => void updateInternalReviewStatus(activeDetail.lens.lensId, 'FIX_UPDATED')} type="button">确认本轮反馈已处理完成</button>
                    ) : null}
                    {canModifyLensList ? (
                      <>
                        <button className="secondary-button" onClick={() => openEditDialog(activeDetail.lens)} type="button">编辑基础信息</button>
                        {!activeDetail.lens.currentVersionReady ? <button className="secondary-button" disabled={isDetailLoading} onClick={() => void handleBindDetailFile('ma')} type="button">绑定当前版 MA</button> : null}
                        {!currentMovBinding ? <button className="secondary-button" disabled={isDetailLoading} onClick={() => void handleBindDetailFile('mov')} type="button">绑定当前版视频</button> : null}
                        {!activeDetail.lens.layoutReady ? <button className="secondary-button" disabled={isDetailLoading} onClick={() => void handleAddLayoutCandidate(activeDetail.lens.lensCode)} type="button">补充Layout</button> : null}
                        {activeDetail.lens.layoutReady ? <button className="secondary-button" disabled={isDetailLoading || !selectedLayoutCandidate} onClick={() => void handleSingleLensLayoutReferenceCheck(activeDetail.lens.lensId)} type="button">检查当前Layout引用</button> : null}
                        <button className="secondary-button lens-row-action-primary" disabled={!canSubmitLens(activeDetail.lens.internalReviewStatusCode, activeDetail.lens.submissionAllowed) || pendingStatusLensId === activeDetail.lens.lensId} onClick={() => void handleStatusChange(activeDetail.lens.lensId, 'submit')} title={!canSubmitLens(activeDetail.lens.internalReviewStatusCode, activeDetail.lens.submissionAllowed) ? getSubmissionDisabledReason(activeDetail.lens) : undefined} type="button">{pendingStatusLensId === activeDetail.lens.lensId ? '处理中…' : '正式提交'}</button>
                        {activeDetail.lens.internalReviewStatusCode === 'IN_DIRECTOR_REVIEW' ? <button className="secondary-button lens-row-action-primary" disabled={pendingStatusLensId === activeDetail.lens.lensId} onClick={() => void updateInternalReviewStatus(activeDetail.lens.lensId, 'DIRECTOR_APPROVED')} type="button">内部通过</button> : null}
                        {activeDetail.lens.internalReviewStatusCode === 'IN_DIRECTOR_REVIEW' ? <button className="secondary-button lens-row-action-warning" disabled={pendingStatusLensId === activeDetail.lens.lensId} onClick={() => void updateInternalReviewStatus(activeDetail.lens.lensId, 'PENDING_FEEDBACK_FIX')} type="button">要求修改</button> : null}
                        {(activeDetail.lens.lensStatus === '提交' || activeDetail.lens.lensStatus === '通过') ? <button className="secondary-button lens-row-action-warning" disabled={pendingStatusLensId === activeDetail.lens.lensId} onClick={() => openSingleReworkDialog(activeDetail.lens)} type="button">返修</button> : null}
                        {activeDetail.lens.lensStatus === '提交' ? <button className="secondary-button lens-row-action-neutral" disabled={pendingStatusLensId === activeDetail.lens.lensId} onClick={() => void handleCloseLens(activeDetail.lens)} type="button">关闭</button> : null}
                      </>
                    ) : (
                      <span className="muted">当前角色仅可查看镜头详情。</span>
                    )}
                  </div>
                </article>
              </div>

              {/* Director feedback moved to dedicated tab below */}
            </div>

            <div className="lens-detail-stack lens-detail-columns lens-detail-columns-top">
              <section className="panel stack-gap lens-detail-subpanel lens-detail-feature-panel">
                <div className="section-heading lens-detail-header">
                  <div>
                      <h4>视频预览</h4>
                        <p className="muted">同时查看当前制作视频与Layout视频；双预览都存在时可联动播放，缺失时仍可单独预览已有视频。</p>
                    </div>
                    <span className={currentMovBinding ? 'environment-pill ready' : currentMovDebug?.candidateCount && currentMovDebug.candidateCount > 1 ? 'environment-pill warning' : 'environment-pill blocked'}>
                      {currentMovBinding ? '已匹配' : currentMovDebug?.candidateCount && currentMovDebug.candidateCount > 1 ? '待确认' : '未匹配'}
                    </span>
                  </div>

                  {hasDualPreview ? (
                    <div className="actions-row compact-actions wrap-actions lens-video-sync-actions">
                      <button className="secondary-button" onClick={handlePlayBothPreviews} type="button">同时播放</button>
                      <button className="secondary-button" onClick={handlePauseBothPreviews} type="button">同时暂停</button>
                      <button className="secondary-button" onClick={handleResetBothPreviews} type="button">回到开头</button>
                    </div>
                  ) : null}

                <div className="lens-video-compare-grid">
                  <article className="lens-history-card lens-video-preview-card">
                    <div className="lens-video-preview-card__header">
                      <div>
                        <h4>制作视频</h4>
                        <p className="muted">当前版本已绑定的制作视频预览。</p>
                      </div>
                      <span className={currentMovBinding ? 'environment-pill ready' : currentMovDebug?.candidateCount && currentMovDebug.candidateCount > 1 ? 'environment-pill warning' : 'environment-pill blocked'}>
                        {currentMovBinding ? '已匹配' : currentMovDebug?.candidateCount && currentMovDebug.candidateCount > 1 ? '待确认' : '未匹配'}
                      </span>
                    </div>
                    {currentMovBinding ? (
                      <>
                        <div className="lens-video-player-shell">
                          {currentMovBinding.mediaPreviewUrl ? (
                            <video
                              className="lens-video-player"
                              controls
                              onError={(event) => handleVideoPreviewError('production', event)}
                              onLoadedData={() => handleVideoPreviewLoaded('production')}
                              onLoadStart={() => handleVideoPreviewLoadStart('production')}
                              preload="metadata"
                              ref={productionVideoRef}
                              src={currentMovBinding.mediaPreviewUrl}
                            />
                          ) : (
                            <div className="lens-video-player lens-video-player--empty muted">{currentMovBinding.mediaPreviewMode === 'pending' ? '正在生成兼容预览副本…' : '当前制作视频无法预览'}</div>
                          )}
                          {previewLoadStates.production || currentMovBinding.mediaPreviewMode === 'pending' ? <small className="muted">正在准备制作视频预览；首次打开 4K 或高规格源时可能需要几秒生成兼容副本。</small> : null}
                          <small className="muted">预览源：{currentMovBinding.mediaPreviewMode ?? 'unknown'} · {currentMovBinding.mediaPreviewUrl ?? '无 URL'}{currentMovBinding.mediaPreviewNote ? ` · ${currentMovBinding.mediaPreviewNote}` : ''}</small>
                        </div>
                        <div className="lens-video-meta-grid">
                          <div className="lens-video-metric-pair-row">
                            <div>
                              <span className="lens-summary-label">预定帧数</span>
                              <strong>{activeDetail.lens.singleFrame}</strong>
                            </div>
                            <div>
                              <span className="lens-summary-label">总帧数</span>
                              <strong>{currentMovBinding.mediaFrameCount ?? '—'}</strong>
                            </div>
                          </div>
                          <div className="lens-video-metric-pair-row">
                            <div>
                              <span className="lens-summary-label">帧率</span>
                              <strong>{formatVideoFps(currentMovBinding.mediaFps)}</strong>
                            </div>
                            <div>
                              <span className="lens-summary-label">时长</span>
                              <strong>{formatDurationSeconds(currentMovBinding.mediaDurationSeconds)}</strong>
                            </div>
                          </div>
                        </div>
                        {previewErrors.production ? <p className="danger-copy">{previewErrors.production}</p> : null}
                        {currentMovBinding.mediaPreviewNote ? <small className={currentMovBinding.mediaPreviewNote.includes('失败') ? 'danger-copy' : 'muted'}>{currentMovBinding.mediaPreviewNote}</small> : null}
                        {currentMovBinding.mediaPreviewMode === 'pending' && typeof currentMovBinding.mediaPreviewProgressPercent === 'number' ? <small className="muted">兼容预览生成进度：{currentMovBinding.mediaPreviewProgressPercent}%</small> : null}
                        <small className="muted">编码诊断：{formatVideoDiagnosticSummary(currentMovBinding.mediaWidth, currentMovBinding.mediaHeight, currentMovBinding.mediaCodecName, currentMovBinding.mediaCodecProfile, currentMovBinding.mediaPixelFormat)}</small>
                        {getVideoCompatibilityHint(currentMovBinding.mediaCodecName, currentMovBinding.mediaPixelFormat) ? <small className="danger-copy">{getVideoCompatibilityHint(currentMovBinding.mediaCodecName, currentMovBinding.mediaPixelFormat)}</small> : null}
                        <small className="muted">{currentMovBinding.versionNum} · {currentMovBinding.relativePath}</small>
                        <div className="actions-row compact-actions wrap-actions lens-video-meta-actions">
                          <button className="secondary-button" onClick={() => void handleOpenBoundFile(currentMovBinding)} type="button">打开源文件</button>
                        </div>
                      </>
                    ) : (
                      <article className="lens-history-card">
                        <p className="danger-copy">当前版本还没有可播放的制作视频绑定。</p>
                        {currentMovDebug ? (
                          <>
                            <small className="muted">扫描根目录：{currentMovDebug.scanRoots.length > 0 ? currentMovDebug.scanRoots.join('；') : '未配置'} · 已扫文件 {currentMovDebug.scannedFileCount} · 相关文件 {currentMovDebug.relatedFileCount}</small>
                            {currentMovDebug.candidates.length > 0 ? <div className="muted">当前版候选：{formatMatchCandidates(currentMovDebug.candidates)}</div> : null}
                            {currentMovDebug.relatedFiles.length > 0 ? <div className="muted">相关文件：{formatMatchCandidates(currentMovDebug.relatedFiles)}</div> : null}
                          </>
                        ) : null}
                      </article>
                    )}
                  </article>

                  <article className="lens-history-card lens-video-preview-card">
                    <div className="lens-video-preview-card__header">
                      <div>
                        <h4>Layout视频</h4>
                        <p className="muted">基于当前采用的Layout Maya 自动匹配到的Layout视频预览。</p>
                      </div>
                      <span className={activeDetail.lens.layoutVideoReady ? 'environment-pill ready' : 'environment-pill blocked'}>
                        {activeDetail.lens.layoutVideoReady ? '已匹配' : '未匹配'}
                      </span>
                    </div>
                    {activeDetail.lens.layoutVideoReady ? (
                      <>
                        <div className="lens-video-player-shell">
                          {activeDetail.lens.layoutVideoPreviewUrl ? (
                            <video
                              className="lens-video-player"
                              controls
                              onError={(event) => handleVideoPreviewError('layout', event)}
                              onLoadedData={() => handleVideoPreviewLoaded('layout')}
                              onLoadStart={() => handleVideoPreviewLoadStart('layout')}
                              preload="metadata"
                              ref={layoutVideoRef}
                              src={activeDetail.lens.layoutVideoPreviewUrl}
                            />
                          ) : (
                            <div className="lens-video-player lens-video-player--empty muted">{activeDetail.lens.layoutVideoPreviewMode === 'pending' ? '正在生成兼容预览副本…' : '当前Layout视频无法预览'}</div>
                          )}
                          {previewLoadStates.layout || activeDetail.lens.layoutVideoPreviewMode === 'pending' ? <small className="muted">正在准备Layout视频预览；首次打开 4K 或高规格源时可能需要几秒生成兼容副本。</small> : null}
                          <small className="muted">预览源：{activeDetail.lens.layoutVideoPreviewMode ?? 'unknown'} · {activeDetail.lens.layoutVideoPreviewUrl ?? '无 URL'}{activeDetail.lens.layoutVideoPreviewNote ? ` · ${activeDetail.lens.layoutVideoPreviewNote}` : ''}</small>
                        </div>
                        <div className="lens-video-meta-grid">
                          <div className="lens-video-metric-pair-row">
                            <div>
                              <span className="lens-summary-label">Layout版本</span>
                              <strong>{activeDetail.lens.layoutVideoVersionNum || '—'}</strong>
                            </div>
                            <div>
                              <span className="lens-summary-label">总帧数</span>
                              <strong>{activeDetail.lens.layoutVideoFrameCount ?? '—'}</strong>
                            </div>
                          </div>
                          <div className="lens-video-metric-pair-row">
                            <div>
                              <span className="lens-summary-label">帧率</span>
                              <strong>{formatVideoFps(activeDetail.lens.layoutVideoFps)}</strong>
                            </div>
                            <div>
                              <span className="lens-summary-label">时长</span>
                              <strong>{formatDurationSeconds(activeDetail.lens.layoutVideoDurationSeconds)}</strong>
                            </div>
                          </div>
                        </div>
                        {previewErrors.layout ? <p className="danger-copy">{previewErrors.layout}</p> : null}
                        {activeDetail.lens.layoutVideoPreviewNote ? <small className={activeDetail.lens.layoutVideoPreviewNote.includes('失败') ? 'danger-copy' : 'muted'}>{activeDetail.lens.layoutVideoPreviewNote}</small> : null}
                        {activeDetail.lens.layoutVideoPreviewMode === 'pending' && typeof activeDetail.lens.layoutVideoPreviewProgressPercent === 'number' ? <small className="muted">兼容预览生成进度：{activeDetail.lens.layoutVideoPreviewProgressPercent}%</small> : null}
                        <small className="muted">编码诊断：{formatVideoDiagnosticSummary(activeDetail.lens.layoutVideoWidth, activeDetail.lens.layoutVideoHeight, activeDetail.lens.layoutVideoCodecName, activeDetail.lens.layoutVideoCodecProfile, activeDetail.lens.layoutVideoPixelFormat)}</small>
                        {getVideoCompatibilityHint(activeDetail.lens.layoutVideoCodecName, activeDetail.lens.layoutVideoPixelFormat) ? <small className="danger-copy">{getVideoCompatibilityHint(activeDetail.lens.layoutVideoCodecName, activeDetail.lens.layoutVideoPixelFormat)}</small> : null}
                        <small className="muted">{activeDetail.lens.layoutVideoRelativePath}</small>
                      </>
                    ) : (
                      <article className="lens-history-card">
                        <p className="danger-copy">当前采用的 layout 还没有匹配到可播放的视频。</p>
                        <small className="muted">Layout Maya：{activeDetail.lens.selectedLayoutFileName || '未指定当前采用项'}</small>
                      </article>
                    )}
                  </article>
                </div>
              </section>
            </div>

            <div className="lens-detail-tabs tabs-row">
              <button className={detailTab === 'versions' ? 'tab-button active' : 'tab-button'} onClick={() => setDetailTab('versions')} type="button">
                版本
              </button>
              <button className={detailTab === 'layout' ? 'tab-button active' : 'tab-button'} onClick={() => setDetailTab('layout')} type="button">
                Layout
              </button>
              <button className={detailTab === 'history' ? 'tab-button active' : 'tab-button'} onClick={() => setDetailTab('history')} type="button">
                记录
              </button>
              <button className={detailTab === 'director-feedback' ? 'tab-button active' : 'tab-button'} onClick={() => setDetailTab('director-feedback')} type="button">
                导演反馈
              </button>
            </div>

            {detailTab === 'versions' ? (
              <section className="panel stack-gap lens-detail-subpanel lens-detail-tab-panel">
                <div className="section-heading">
                  <div>
                    <h4>版本资产</h4>
                    <p className="muted">按版本查看文件完整度、候选与已绑定结果。</p>
                  </div>
                  <div className="actions-row compact-actions wrap-actions">
                    <label className="field lens-detail-search-field">
                      <span>筛选版本内容</span>
                      <input onChange={(event) => setDetailSearch(event.target.value)} placeholder="搜索版本号 / 路径 / 缺项" value={detailSearch} />
                    </label>
                    <button className="secondary-button" disabled={isDetailLoading} onClick={() => void handleBindDetailFile('ma')} type="button">绑定当前版 MA</button>
                    <button className="secondary-button" disabled={isDetailLoading} onClick={() => void handleBindDetailFile('mov')} type="button">绑定当前版视频</button>
                  </div>
                </div>

                {filteredDetailVersions.length > 0 ? (
                  <div className="lens-detail-version-list">
                    {filteredDetailVersions.map((version) => (
                    <article className="lens-version-card" key={version.versionNum}>
                        <div className="section-heading lens-version-header">
                          <div>
                            <h4>{version.versionNum}</h4>
                            <p className="muted">{version.fileName}</p>
                          </div>
                          <span className={version.issues.length === 0 ? 'environment-pill ready' : 'environment-pill blocked'}>
                            {version.issues.length === 0 ? '完整' : `缺 ${version.issues.length} 项`}
                          </span>
                        </div>

                        {version.issues.length > 0 ? (
                          <ul className="lens-issue-list">
                            {version.issues.map((issue) => (
                              <li key={`${version.versionNum}-${issue.fileType}-${issue.reason}`} className="danger-copy">
                                <div>{issue.message}</div>
                                {issue.candidatePaths && issue.candidatePaths.length > 0 ? (
                                  <small className="muted">候选：{issue.candidatePaths.join('；')}</small>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        {(version.matchDebug.ma || version.matchDebug.mov) ? (
                          <details className="lens-detail-collapsible">
                            <summary className="lens-detail-collapsible-summary">查看当前版本匹配排查</summary>
                            <div className="lens-meta-grid">
                              {(['ma', 'mov'] as const).map((fileType) => {
                                const debug = version.matchDebug[fileType];
                                if (!debug) {
                                  return null;
                                }

                                return (
                                  <article className="lens-history-card lens-match-debug-card" key={`${version.versionNum}-${fileType}-debug`}>
                                    <div className="section-heading lens-version-header">
                                      <div>
                                        <h4>{fileType.toUpperCase()} 匹配排查</h4>
                                        <p className="muted">{debug.note}</p>
                                      </div>
                                      <span className={debug.candidateCount === 1 ? 'environment-pill ready' : debug.candidateCount > 1 ? 'environment-pill warning' : 'environment-pill blocked'}>
                                        {debug.candidateCount === 1 ? '唯一候选' : debug.candidateCount > 1 ? `${debug.candidateCount} 个候选` : '无候选'}
                                      </span>
                                    </div>
                                    <small className="muted">扫描根目录：{debug.scanRoots.length > 0 ? debug.scanRoots.join('；') : '未配置'} · 已扫文件 {debug.scannedFileCount} · 相关文件 {debug.relatedFileCount}</small>
                                    {debug.candidates.length > 0 ? <div className="muted">当前版候选：{formatMatchCandidates(debug.candidates)}</div> : null}
                                    {debug.relatedFiles.length > 0 ? <div className="muted">相关文件：{formatMatchCandidates(debug.relatedFiles)}</div> : null}
                                  </article>
                                );
                              })}
                            </div>
                          </details>
                        ) : null}

                        {version.bindings.length > 0 ? (
                          <div className="lens-meta-grid">
                            {sortVersionBindings(version.bindings).map((binding) => (
                                <div className="binding-row" key={binding.fileId}>
                                  <span className="muted">
                                    {binding.fileType} · {binding.relativePath} · {binding.exists ? '已找到' : '磁盘缺失'}
                                    {binding.fileType === 'mov' ? ` · ${binding.mediaFrameCount ?? '—'} 帧` : ''}
                                  </span>
                                  <button className="secondary-button" onClick={() => void handleOpenBoundFile(binding)} type="button">打开</button>
                                </div>
                              ))}
                            </div>
                        ) : (
                          <p className="muted">该版本还没有绑定文件。</p>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">没有匹配到版本资产记录。</p>
                )}
              </section>
            ) : null}

            {detailTab === 'layout' ? (
              <section className="panel stack-gap lens-detail-subpanel lens-detail-tab-panel">
                <div className="section-heading">
                  <div>
                    <h4>Layout Maya 候选</h4>
                    <p className="muted">查看候选、当前采用项与引用排查结果。</p>
                  </div>
                  <div className="actions-row compact-actions wrap-actions">
                    <button className="secondary-button" disabled={isDetailLoading} onClick={() => void handleAddLayoutCandidate(activeDetail.lens.lensCode)} type="button">补充Layout</button>
                    <button className="secondary-button" disabled={isDetailLoading} onClick={() => void handleAddLayoutVideoBinding(activeDetail.lens.lensCode, selectedLayoutCandidate?.candidateId)} type="button">补充Layout视频</button>
                    {canUseLocalFileChecks ? <button className="secondary-button" disabled={isDetailLoading || !selectedLayoutCandidate} onClick={() => void handleSingleLensLayoutReferenceCheck(activeDetail.lens.lensId)} type="button">检查当前Layout引用</button> : null}
                  </div>
                </div>

                <article className="lens-history-card lens-layout-mapping-card">
                  <div className="section-heading lens-version-header">
                    <div>
                      <h4>当前Layout映射关系</h4>
                      <p className="muted">把当前采用的Layout Maya 与对应视频放在一处确认，避免只看候选列表时不清楚当前映射到了哪支视频。</p>
                    </div>
                    <span className={selectedLayoutCandidate && activeDetail.lens.layoutVideoReady ? 'environment-pill ready' : selectedLayoutCandidate ? 'environment-pill warning' : 'environment-pill blocked'}>
                      {selectedLayoutCandidate && activeDetail.lens.layoutVideoReady ? '映射已完成' : selectedLayoutCandidate ? '缺少视频' : '缺少 Layout'}
                    </span>
                  </div>

                  <div className="lens-video-compare-grid lens-layout-mapping-grid">
                    <div className="lens-layout-mapping-block">
                      <span className="lens-summary-label">当前采用的Layout Maya</span>
                      <strong>{selectedLayoutCandidate?.fileName || '未指定当前采用项'}</strong>
                      <small className="muted">{selectedLayoutCandidate?.relativePath || '请先在下方候选中设定当前采用项。'}</small>
                    </div>
                    <div className="lens-layout-mapping-block">
                      <span className="lens-summary-label">映射到的Layout视频</span>
                      <strong>{activeDetail.lens.layoutVideoFileName || '未绑定 / 未匹配'}</strong>
                      <small className="muted">{activeDetail.lens.layoutVideoRelativePath || '当前可手动补充 Layout 视频，或继续使用自动匹配结果。'}</small>
                    </div>
                  </div>
                  <small className="muted">匹配依据：{getLayoutVideoMatchHint(Boolean(selectedLayoutCandidate), activeDetail.lens.layoutVideoReady)}</small>

                  <div className="actions-row compact-actions wrap-actions">
                    <button className="secondary-button" disabled={isDetailLoading} onClick={() => void handleAddLayoutVideoBinding(activeDetail.lens.lensCode, selectedLayoutCandidate?.candidateId)} type="button">补充 / 替换Layout视频</button>
                    <button className="secondary-button" disabled={!activeDetail.lens.layoutVideoReady || activeDetail.lens.layoutVideoPreviewMode === 'pending' || !activeDetail.lens.layoutVideoPreviewUrl} onClick={() => handlePlaySinglePreview('layout')} type="button">播放Layout视频</button>
                    <button className="secondary-button" disabled={!selectedLayoutCandidate || !activeDetail.lens.layoutVideoReady} onClick={() => setDetailTab('history')} type="button">查看近期变更记录</button>
                  </div>
                </article>

                {activeDetail.layoutCandidates.length > 0 ? (
                  <div className="lens-history-list">
                    {activeDetail.layoutCandidates.map((candidate) => (
                      <article className={`lens-history-card lens-layout-candidate-card${candidate.isSelected ? ' is-selected' : ''}`} key={candidate.candidateId}>
                        <div className="section-heading lens-version-header">
                          <div>
                            <h4>{candidate.fileName}</h4>
                            <p className="muted">{candidate.relativePath}</p>
                          </div>
                          <span className={candidate.isSelected ? 'environment-pill ready' : 'environment-pill warning'}>
                            {candidate.isSelected ? '当前采用' : candidate.source === 'manual' ? '手工添加' : '自动发现'}
                          </span>
                        </div>
                        <small className="muted">{candidate.exists ? '文件存在' : '磁盘缺失'} · {candidate.bindTime}{candidate.sourceRoot ? ` · 来源根目录 ${candidate.sourceRoot}` : ''}</small>
                        {candidate.isSelected ? <div className="lens-layout-selected-banner">当前采用中的Layout，引用检查和后续协作都基于这一项。</div> : null}
                        {candidate.isSelected ? <small className={activeDetail.lens.layoutVideoReady ? 'success-copy' : 'muted'}>Layout视频：{activeDetail.lens.layoutVideoReady ? activeDetail.lens.layoutVideoFileName : '未绑定/未匹配'}</small> : null}
                        <div className="actions-row compact-actions wrap-actions">
                          <button className="secondary-button" disabled={candidate.isSelected} onClick={() => void handleSelectLayoutCandidate(activeDetail.lens.lensCode, candidate.candidateId)} type="button">
                            {candidate.isSelected ? '已采用' : '设为当前'}
                          </button>
                          {candidate.isSelected ? <button className="secondary-button" disabled={isDetailLoading} onClick={() => void handleAddLayoutVideoBinding(activeDetail.lens.lensCode, candidate.candidateId)} type="button">绑定该 Layout 视频</button> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                          <p className="muted">当前没有发现Layout Maya 候选。可先去文件检查页执行筛查，或在这里手动补充。</p>
                )}

                {activeDetail.layoutReferenceCheck ? (
                  <article className="lens-history-card">
                    <div className="section-heading lens-version-header">
                      <div>
                        <h4>当前采用Layout的引用排查</h4>
                        <p className="muted">{activeDetail.layoutReferenceCheck.layoutFileName} · {activeDetail.layoutReferenceCheck.lastCheckTime}</p>
                      </div>
                      <span className={activeDetail.layoutReferenceCheck.status === '正常' ? 'environment-pill ready' : 'environment-pill blocked'}>
                        {activeDetail.layoutReferenceCheck.status}
                      </span>
                    </div>
                    <small className="muted">问题总数：{activeDetail.layoutReferenceCheck.issueCount} · 路径不存在 {activeDetail.layoutReferenceCheck.pathMissingCount} · 文件不存在 {activeDetail.layoutReferenceCheck.fileMissingCount} · 文件名不匹配 {activeDetail.layoutReferenceCheck.fileNameMismatchCount}</small>
                    {activeDetail.layoutReferenceCheck.errorMessage ? <p className="danger-copy">{activeDetail.layoutReferenceCheck.errorMessage}</p> : null}
                    {activeDetail.layoutReferenceCheck.issues.length > 0 ? (
                      <ul className="lens-issue-list">
                        {activeDetail.layoutReferenceCheck.issues.map((issue) => (
                          <li key={issue.issueId} className="danger-copy">{issue.issueType} · {issue.expectedFileName} · {issue.refOriginalPath}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ) : null}
              </section>
            ) : null}

            {detailTab === 'history' ? (
              <section className="panel stack-gap lens-detail-subpanel lens-detail-tab-panel lens-detail-history-panel">
              <div className="section-heading lens-rework-header">
                  <div>
                    <h4>生命周期记录</h4>
                    <p className="muted">只保留创建、流转和绑定等关键变更。</p>
                  </div>
                  <label className="field lens-detail-search-field">
                    <span>筛选记录</span>
                    <input onChange={(event) => setDetailSearch(event.target.value)} placeholder="搜索标题 / 说明 / 时间 / 版本" value={detailSearch} />
                  </label>
                </div>

                {filteredDetailHistory.length > 0 ? (
                  <div className="lens-history-list lens-history-timeline">
                    {filteredDetailHistory.map((event, index) => (
                      <article className="lens-history-card lens-history-timeline-card" key={event.eventId}>
                        <div className="lens-history-timeline-marker" aria-hidden="true">
                          <span className="lens-history-timeline-dot" />
                          {index < filteredDetailHistory.length - 1 ? <span className="lens-history-timeline-line" /> : null}
                        </div>
                        <div className="lens-history-timeline-content">
                          <div className="lens-history-timeline-header-row">
                            <h4>{event.title}</h4>
                            <div className="lens-history-timeline-header-actions">
                              {event.editable ? (
                                <button className="secondary-button" onClick={() => openReworkRecordEditor(event)} type="button">
                                  编辑返修记录
                                </button>
                              ) : null}
                              <span className={statusClassName(event.toStatus ?? activeDetail.lens.lensStatus)}>{event.toStatus ?? activeDetail.lens.lensStatus}</span>
                            </div>
                          </div>
                          <div className="lens-history-timeline-meta-row muted">
                            <span>{event.eventTime}</span>
                            <span>版本：{event.versionNum}</span>
                            <span className="lens-history-file-name">命名：{event.fileName}</span>
                          </div>
                          {event.detail || event.attachments.length > 0 ? (
                            <details className="lens-detail-collapsible lens-detail-collapsible--inline">
                              <summary className="lens-detail-collapsible-summary">查看详情说明{event.attachments.length > 0 ? `（含 ${event.attachments.length} 张图片）` : ''}</summary>
                              {event.detail ? <p>{event.detail}</p> : null}
                              {event.attachments.length > 0 ? (
                                <div className="lens-history-attachment-grid">
                                  {event.attachments.map((attachment) => (
                                    <figure className="lens-history-attachment-card" key={attachment.attachmentId}>
                                      <button className="lens-history-attachment-trigger" onClick={() => openReworkAttachmentPreview(event.attachments, attachment.attachmentId)} type="button">
                                        <img alt={attachment.fileName} className="lens-history-attachment-image" loading="lazy" src={attachment.previewUrl} />
                                      </button>
                                      <figcaption className="muted">{attachment.fileName}</figcaption>
                                    </figure>
                                  ))}
                                </div>
                              ) : null}
                            </details>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">没有匹配到生命周期记录。</p>
                )}
              </section>
            ) : null}

            {detailTab === 'director-feedback' ? (
              <section className="panel stack-gap lens-detail-subpanel lens-detail-tab-panel lens-director-feedback-panel">
                <div className="section-heading">
                  <div>
                    <h4>导演反馈</h4>
                    <p className="muted">点击反馈条目可直接定位到对应帧，默认显示当前轮正式绘制内容。</p>
                  </div>
                </div>

                <div className="lens-director-feedback-grid">
                  <DirectorFeedbackPlayback
                    currentVersionNum={activeDetail.lens.versionNum}
                    drawingTimeline={currentDirectorFeedbackRoundTimeline}
                    feedbacks={currentDirectorFeedbacks}
                    fps={playbackFps}
                    sourceDescription={directorFeedbackPlaybackNotice}
                    sourceLabel={directorFeedbackPlaybackSource?.sourceLabel ?? ''}
                    seekTarget={directorFeedbackSeekTarget}
                    videoSrc={directorFeedbackPlaybackSource?.resolvedVideoSrc ?? null}
                  />

                  <div className="director-feedback-card-list">
                    {currentDirectorFeedbacks.length === 0 ? (
                      <p className="muted">暂无导演反馈卡片。</p>
                    ) : (
                      currentDirectorFeedbacks.map((feedback) => (
                        <article className="director-feedback-card" key={feedback.feedbackId} onClick={() => handleDirectorFeedbackCardClick(feedback)} role="button" tabIndex={0}>
                          <div className="section-heading">
                            <div>
                              <strong>{feedback.decisionName ?? feedback.decisionCode ?? '反馈'}</strong>
                              <p className="muted">
                                V{feedback.versionNum || '—'} · 帧 {feedback.frameNumber ?? '—'} · {feedback.timecode || '—'}
                              </p>
                            </div>
                            <small className="muted">{formatLensDateTime(feedback.createdAtUtc)}</small>
                          </div>
                          <p>{feedback.commentText || '—'}</p>
                          <small className="muted">创建人：{feedback.createdByDisplayName || '—'} · 反馈编号：{feedback.feedbackId.slice(0, 8)}</small>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              </section>
            ) : null}

            <div aria-label="拖拽调整弹窗大小" className="lens-detail-resize-handle" onMouseDown={handleStartDetailResize} role="presentation" />
          </div>
        </div>
      ) : null}

      {reworkRecordEditor ? (
        <div className="lens-detail-modal-overlay" onClick={closeReworkRecordEditor} role="presentation">
          <div className="lens-rework-modal panel stack-gap" onClick={(event) => event.stopPropagation()} onPaste={(event) => void handlePasteReworkRecordImages(event)}>
            <div className="section-heading">
              <div>
                <h3>编辑返修记录</h3>
                <p className="muted">{reworkRecordEditor.title}</p>
              </div>
              <button className="secondary-button" disabled={isSavingReworkRecord} onClick={closeReworkRecordEditor} type="button">
                取消
              </button>
            </div>

            <label className="field">
              <span>返修说明</span>
              <textarea
                autoFocus
                className="lens-rework-textarea"
                onChange={(event) => setReworkRecordEditor((current) => current ? { ...current, note: event.target.value } : current)}
                placeholder="例如：补充导演意见、重做范围、需要确认的问题..."
                rows={5}
                value={reworkRecordEditor.note}
              />
            </label>

            <div className="field stack-gap">
              <div className="section-heading">
                <div>
                  <span>返修图片</span>
                  <p className="muted">已保存图片可取消保留；新增图片会在保存后插入当前返修记录。支持直接 Ctrl+V 粘贴截图。</p>
                </div>
                <button className="secondary-button" disabled={isSavingReworkRecord} onClick={() => void handlePickReworkRecordImages()} type="button">
                  选择图片
                </button>
              </div>

              {reworkRecordEditor.attachments.length > 0 ? (
                <div className="lens-history-attachment-grid">
                  {reworkRecordEditor.attachments.map((attachment, index) => {
                    const kept = reworkRecordEditor.keptAttachmentIds.includes(attachment.attachmentId);
                    return (
                      <label className={`lens-history-attachment-card lens-history-attachment-card--editable${kept ? '' : ' is-disabled'}`} key={attachment.attachmentId}>
                        <img alt={attachment.fileName} className="lens-history-attachment-image" loading="lazy" src={attachment.previewUrl} />
                        <span>{attachment.fileName}</span>
                        <span className="muted">{kept ? '保存后保留' : '保存后移除'}</span>
                        <div className="lens-attachment-sort-actions">
                          <button className="secondary-button" disabled={index === 0 || isSavingReworkRecord} onClick={() => moveSavedReworkAttachment(attachment.attachmentId, 'up')} type="button">上移</button>
                          <button className="secondary-button" disabled={index === reworkRecordEditor.attachments.length - 1 || isSavingReworkRecord} onClick={() => moveSavedReworkAttachment(attachment.attachmentId, 'down')} type="button">下移</button>
                        </div>
                        <label className="lens-attachment-keep-toggle">
                          <input checked={kept} onChange={() => toggleReworkAttachment(attachment.attachmentId)} type="checkbox" />
                          <span>{kept ? '保留' : '移除'}</span>
                        </label>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">当前返修记录还没有已保存图片。</p>
              )}

              {reworkRecordEditor.newImagePaths.length > 0 ? (
                <div className="lens-pending-image-list">
                  {reworkRecordEditor.newImagePaths.map((filePath, index) => (
                    <div className="lens-pending-image-item" key={filePath}>
                        <img alt={getBaseName(filePath)} className="lens-pending-image-thumb" src={resolveImageUrl(filePath) || filePath} />
                      <span>{getBaseName(filePath)}</span>
                      <div className="lens-attachment-sort-actions">
                        <button className="secondary-button" disabled={index === 0 || isSavingReworkRecord} onClick={() => movePendingReworkImage(filePath, 'up')} type="button">上移</button>
                        <button className="secondary-button" disabled={index === reworkRecordEditor.newImagePaths.length - 1 || isSavingReworkRecord} onClick={() => movePendingReworkImage(filePath, 'down')} type="button">下移</button>
                        <button className="secondary-button" disabled={isSavingReworkRecord} onClick={() => removePendingReworkImage(filePath)} type="button">移除</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="actions-row wrap-actions lens-form-actions">
              <button className="primary-button" disabled={isSavingReworkRecord} onClick={() => void submitReworkRecordEditor()} type="button">
                {isSavingReworkRecord ? '保存中…' : '保存返修记录'}
              </button>
              <button className="secondary-button" disabled={isSavingReworkRecord} onClick={closeReworkRecordEditor} type="button">
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewingReworkAttachment ? (
        <div className="lens-detail-modal-overlay" onClick={closeReworkAttachmentPreview} role="presentation">
          <div className="lens-image-preview-modal panel stack-gap" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <div>
                <h3>返修图片预览</h3>
                <p className="muted">
                  {previewingReworkAttachment.attachments[previewingReworkAttachment.activeIndex]?.fileName}
                  {` · ${previewingReworkAttachment.activeIndex + 1} / ${previewingReworkAttachment.attachments.length}`}
                </p>
              </div>
              <div className="lens-image-preview-actions">
                <button className="secondary-button" disabled={previewingReworkAttachment.attachments.length <= 1} onClick={() => movePreviewingReworkAttachment('prev')} type="button">上一张</button>
                <button className="secondary-button" disabled={previewingReworkAttachment.attachments.length <= 1} onClick={() => movePreviewingReworkAttachment('next')} type="button">下一张</button>
                <button className="secondary-button" onClick={closeReworkAttachmentPreview} type="button">关闭</button>
              </div>
            </div>

            <div className="lens-image-preview-frame">
              <img
                alt={previewingReworkAttachment.attachments[previewingReworkAttachment.activeIndex]?.fileName}
                className="lens-image-preview-image"
                src={previewingReworkAttachment.attachments[previewingReworkAttachment.activeIndex]?.previewUrl}
              />
            </div>
          </div>
        </div>
      ) : null}

      {reworkDialog ? (
        <div className="lens-detail-modal-overlay" onClick={closeReworkDialog} role="presentation">
          <div className="lens-rework-modal panel stack-gap" onClick={(event) => event.stopPropagation()} onPaste={(event) => void handlePasteReworkDialogImages(event)}>
            <div className="section-heading">
              <div>
                <h3>{reworkDialog.mode === 'single' ? '填写返修记录' : '批量返修记录'}</h3>
                <p className="muted">
                  {reworkDialog.mode === 'single'
                    ? `镜头：${reworkDialog.lensName ?? '-'}`
                    : `本次将对 ${reworkDialog.lensCount ?? 0} 条镜头执行返修并自动升版。`}
                </p>
              </div>
              <button className="secondary-button" onClick={closeReworkDialog} type="button">
                取消
              </button>
            </div>

            <label className="field">
              <span>返修记录（可留空）</span>
              <textarea
                autoFocus
                className="lens-rework-textarea"
                onChange={(event) => setReworkNote(event.target.value)}
                placeholder="例如：表演需调整、镜头节奏需重做、导演反馈..."
                rows={5}
                value={reworkNote}
              />
            </label>

            <div className="field stack-gap">
              <div className="section-heading">
                <div>
                  <span>返修图片</span>
                  <p className="muted">这里选择的图片会随本次返修记录一起创建。支持直接 Ctrl+V 粘贴截图。</p>
                </div>
                <button className="secondary-button" onClick={() => void handlePickReworkDialogImages()} type="button">
                  选择图片
                </button>
              </div>

              {reworkDialog.imagePaths.length > 0 ? (
                <div className="lens-pending-image-list">
                  {reworkDialog.imagePaths.map((filePath, index) => (
                    <div className="lens-pending-image-item" key={filePath}>
                      <span>{getBaseName(filePath)}</span>
                      <div className="lens-attachment-sort-actions">
                        <button className="secondary-button" disabled={index === 0} onClick={() => moveReworkDialogImage(filePath, 'up')} type="button">上移</button>
                        <button className="secondary-button" disabled={index === reworkDialog.imagePaths.length - 1} onClick={() => moveReworkDialogImage(filePath, 'down')} type="button">下移</button>
                        <button className="secondary-button" onClick={() => removeReworkDialogImage(filePath)} type="button">移除</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">当前未选择返修图片。</p>
              )}
            </div>

            <div className="actions-row wrap-actions lens-form-actions">
              <button className="primary-button" disabled={(reworkDialog.mode === 'single' && pendingStatusLensId === reworkDialog.lensId) || pendingBatchAction === 'rework'} onClick={() => void submitReworkDialog()} type="button">
                确认返修
              </button>
              <button className="secondary-button" onClick={closeReworkDialog} type="button">
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function statusClassName(status: LensStatus): string {
  if (status === '关闭') {
    return 'environment-pill blocked';
  }

  if (status === '通过') {
    return 'environment-pill ready';
  }

  return status === '提交' ? 'environment-pill info' : 'environment-pill warning';
}

function internalReviewStatusClassName(status?: InternalReviewStatusCode | null): string {
  if (status === 'DIRECTOR_APPROVED') {
    return 'environment-pill ready';
  }

  if (status === 'PENDING_FEEDBACK_FIX' || status === 'IN_DIRECTOR_REVIEW') {
    return 'environment-pill warning';
  }

  if (status === 'READY_FOR_REVIEW') {
    return 'environment-pill info';
  }

  return 'environment-pill blocked';
}

// Delegated to shared module. These wrappers exist for backward compat.
// function getBaseName same as import
// function arrayBufferToBase64 same as import

function formatIssueSummary(issues: LensVersionIssue[]): string {
  return issues.map((issue) => issue.message).join('；');
}

function getLensReminderSeverity(lens: LensRecord): 'ready' | 'warning' | 'blocked' {
  if (lens.currentVersionReady) {
    return 'ready';
  }

  return lens.currentVersionMatchedFileNames.length === 0 ? 'blocked' : 'warning';
}

function getLensReminderPillClassName(lens: LensRecord): string {
  const severity = getLensReminderSeverity(lens);
  return severity === 'warning' ? 'environment-pill warning' : severity === 'blocked' ? 'environment-pill blocked' : 'environment-pill ready';
}

function getLensReminderPillLabel(lens: LensRecord): string {
  const severity = getLensReminderSeverity(lens);
  if (severity === 'warning') {
    return '未完全匹配';
  }

  if (severity === 'blocked') {
    return '文件缺失';
  }

  return '版本完整';
}

function getLensReminderTextClassName(lens: LensRecord): string {
  const severity = getLensReminderSeverity(lens);
  return severity === 'warning' ? 'warning-copy' : severity === 'blocked' ? 'danger-copy' : 'muted';
}

function getLensReminderHeadline(lens: LensRecord): string {
  const severity = getLensReminderSeverity(lens);
  return severity === 'ready' ? '完整' : severity === 'warning' ? '待处理' : '缺失';
}

function getLensReminderTextLabel(lens: LensRecord): string {
  const severity = getLensReminderSeverity(lens);
  if (severity === 'ready') {
    return 'MA / MOV 已就绪';
  }

  const missingSummary = getLensMissingFileTypeSummary(lens.currentVersionIssues);
  if (missingSummary) {
    return `缺失 ${missingSummary}`;
  }

  return severity === 'blocked' ? 'MA / MOV 文件缺失' : '当前版本未完全匹配';
}

function getLensMissingFileTypeSummary(issues: LensVersionIssue[]): string {
  const fileTypeLabels = issues.reduce<string[]>((labels, issue) => {
    if (issue.reason !== '未绑定' && issue.reason !== '文件缺失') {
      return labels;
    }

    const label = issue.fileType === 'ma' ? 'MA 文件' : '视频文件';
    if (!labels.includes(label)) {
      labels.push(label);
    }

    return labels;
  }, []);

  if (fileTypeLabels.length === 0) {
    return '';
  }

  return fileTypeLabels.join('、');
}

function renderLensVersionMatchedFileNames(lens: LensRecord): ReactElement | null {
  if (lens.currentVersionMatchedFileNames.length === 0) {
    return null;
  }

  return (
    <details className="lens-detail-collapsible lens-detail-collapsible--inline">
      <summary className="lens-detail-collapsible-summary">已匹配文件（{lens.currentVersionMatchedFileNames.length}）</summary>
      <div className="lens-issue-list">
        {lens.currentVersionMatchedFileNames.map((fileName) => (
          <small className="muted" key={fileName}>{fileName}</small>
        ))}
      </div>
    </details>
  );
}

function getDefaultDetailModalSize(): DetailModalSize {
  if (typeof window === 'undefined') {
    return { width: 1360, height: 980 };
  }

  return clampDetailModalSize({
    width: Math.min(1480, window.innerWidth - 16),
    height: Math.min(1040, window.innerHeight - 8),
  });
}

function getMaximizedDetailModalSize(): DetailModalSize {
  if (typeof window === 'undefined') {
    return { width: 1480, height: 1040 };
  }

  return clampDetailModalSize({
    width: window.innerWidth - 8,
    height: window.innerHeight - 8,
  });
}

function clampDetailModalSize(size: DetailModalSize): DetailModalSize {
  if (typeof window === 'undefined') {
    return size;
  }

  const minWidth = Math.min(920, window.innerWidth - 12);
  const minHeight = Math.min(680, window.innerHeight - 12);
  const maxWidth = Math.max(minWidth, window.innerWidth - 8);
  const maxHeight = Math.max(minHeight, window.innerHeight - 8);

  return {
    width: Math.min(maxWidth, Math.max(minWidth, size.width)),
    height: Math.min(maxHeight, Math.max(minHeight, size.height)),
  };
}

function getVersionIssueTypeSummary(issues: LensVersionIssue[]): string {
  const issueTypes = Array.from(new Set(issues.map((issue) => `${issue.fileType.toUpperCase()}-${issue.reason}`)));
  return issueTypes.join(' · ');
}

function getLayoutIssueTypeLabel(lens: LensRecord): string {
  if (lens.layoutReady && lens.layoutVideoReady) {
    return lens.layoutCandidateCount > 1 ? 'Maya 与视频已匹配，可继续确认最佳版本' : 'Maya 与视频均可用';
  }

  if (lens.layoutReady || lens.layoutVideoReady) {
    if (lens.layoutReady && !lens.layoutVideoReady) {
      return '已匹配Layout Maya，待补视频';
    }

    return '已匹配Layout视频，待补/确认 Maya';
  }

  if (lens.layoutReady) {
    return lens.layoutCandidateCount > 1 ? '已匹配候选，可继续确认最佳版本' : '当前采用项可用';
  }

  if (lens.layoutCandidateCount === 0) {
      return '未发现Layout候选';
  }

  return lens.selectedLayoutFileName ? '当前采用项磁盘缺失' : '已有候选但未确认采用项';
}

function getLayoutSummarySeverity(lens: LensRecord): 'ready' | 'warning' | 'blocked' {
  if (lens.layoutReady && lens.layoutVideoReady) {
    return 'ready';
  }

  if (lens.layoutReady || lens.layoutVideoReady) {
    return 'warning';
  }

  return 'blocked';
}

function getLayoutSummaryPillClassName(lens: LensRecord): string {
  const severity = getLayoutSummarySeverity(lens);
  return severity === 'ready' ? 'environment-pill ready' : severity === 'warning' ? 'environment-pill warning' : 'environment-pill blocked';
}

function getLayoutSummaryPillLabel(lens: LensRecord): string {
  const severity = getLayoutSummarySeverity(lens);
  return severity === 'ready' ? 'Layout就绪' : severity === 'warning' ? 'Layout待补全' : 'Layout缺失';
}

function getLayoutSummaryHeadline(lens: LensRecord): string {
  const severity = getLayoutSummarySeverity(lens);
  return severity === 'ready' ? '已就绪' : severity === 'warning' ? '待补全' : '待处理';
}

function getLayoutSummaryTextClassName(lens: LensRecord): string {
  const severity = getLayoutSummarySeverity(lens);
  return severity === 'ready' ? 'muted' : severity === 'warning' ? 'warning-copy' : 'danger-copy';
}

function getLayoutVideoMatchHint(hasSelectedLayout: boolean, hasMatchedVideo: boolean): string {
  if (!hasSelectedLayout) {
    return '自动匹配会优先基于当前采用的Layout Maya 进行；多候选时默认选择版本号更大、命名更标准的视频。';
  }

  if (!hasMatchedVideo) {
    return '当前仍未命中可用视频。自动匹配会优先基于当前采用的Layout Maya 进行；多候选时默认选择版本号更大、命名更标准的视频。';
  }

  return '当前视频来自自动匹配结果：优先基于当前采用的Layout Maya；多候选时默认选择版本号更大、命名更标准的视频。';
}

function formatMatchCandidates(candidates: LensVersionMatchDebug['candidates']): string {
  return candidates
    .map((candidate) => `${candidate.relativePath}${candidate.sourceRoot ? ` [${candidate.sourceRoot}]` : ''}（score:${candidate.score}${candidate.extractedVersion ? ` / V${String(candidate.extractedVersion).padStart(2, '0')}` : ''}）`)
    .join('；');
}

function sortVersionBindings<T extends { fileType: BindFileType }>(bindings: T[]): T[] {
  return [...bindings].sort((left, right) => {
    if (left.fileType === right.fileType) {
      return 0;
    }

    return left.fileType === 'mov' ? -1 : 1;
  });
}

function formatVideoFps(value?: number): string {
  if (!value || !Number.isFinite(value)) {
    return '—';
  }

  return `${value.toFixed(value >= 10 ? 2 : 3)} fps`;
}

function formatDurationSeconds(value?: number): string {
  if (!value || !Number.isFinite(value)) {
    return '—';
  }

  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getVideoMimeType(sourceUrl?: string): string {
  if (!sourceUrl) {
    return 'video/mp4';
  }

  const pathname = (() => {
    try {
      return new URL(sourceUrl).pathname.toLowerCase();
    } catch {
      return sourceUrl.toLowerCase();
    }
  })();

  if (pathname.endsWith('.mp4') || pathname.endsWith('.m4v')) {
    return 'video/mp4';
  }

  if (pathname.endsWith('.mov')) {
    return 'video/quicktime';
  }

  if (pathname.endsWith('.webm')) {
    return 'video/webm';
  }

  if (pathname.endsWith('.mkv')) {
    return 'video/x-matroska';
  }

  if (pathname.endsWith('.avi')) {
    return 'video/x-msvideo';
  }

  return 'video/mp4';
}

function formatVideoResolution(width?: number, height?: number): string {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) {
    return '分辨率未知';
  }

  return `${width}×${height}`;
}

function formatVideoDiagnosticSummary(
  width?: number,
  height?: number,
  codecName?: string,
  codecProfile?: string,
  pixelFormat?: string,
): string {
  const segments = [
    formatVideoResolution(width, height),
    codecName?.trim(),
    codecProfile?.trim(),
    pixelFormat?.trim(),
  ].filter((value): value is string => Boolean(value));

  return segments.length > 0 ? segments.join(' · ') : '未获取到视频编码信息';
}

function getVideoCompatibilityHint(codecName?: string, pixelFormat?: string): string | null {
  const normalizedCodec = codecName?.trim().toLowerCase() ?? '';
  const normalizedPixelFormat = pixelFormat?.trim().toLowerCase() ?? '';

  if (normalizedCodec.includes('hevc') || normalizedCodec.includes('h265')) {
    return '当前视频为 HEVC/H.265，Electron/Chromium 在部分 Windows 机器上可能无法直接解码播放。';
  }

  if (normalizedPixelFormat.includes('10')) {
    return '当前视频疑似 10-bit 规格，Electron/Chromium 对高位深本地预览的兼容性较弱。';
  }

  if (normalizedPixelFormat.includes('422') || normalizedPixelFormat.includes('444')) {
    return '当前视频像素格式不是常见的 4:2:0，Electron/Chromium 可能无法直接播放。';
  }

  return null;
}

function getPlaybackFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `播放失败：${error.message}`;
  }

  return '播放失败：Electron 视频解码器未能启动该文件，请重点检查编码格式兼容性。';
}

function getVideoElementErrorMessage(error: MediaError | null): string {
  if (!error) {
    return '视频加载失败：浏览器没有返回详细错误，请重点检查编码格式兼容性。';
  }

  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return '视频加载已中止。';
    case MediaError.MEDIA_ERR_NETWORK:
      return '视频加载失败：读取本地文件时发生网络层错误。';
    case MediaError.MEDIA_ERR_DECODE:
      return '视频解码失败：当前 Electron/Chromium 可能不支持该编码规格。';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return '视频源不受支持：请检查容器或编码格式是否可被 Electron/Chromium 直接播放。';
    default:
      return '视频加载失败：发生未知媒体错误。';
  }
}

function formatFrameDuration(frameCount: number, fps: number = DEFAULT_LENS_FPS): string {
  if (!Number.isFinite(frameCount) || frameCount <= 0 || !Number.isFinite(fps) || fps <= 0) {
    return '00:00';
  }

  return formatDurationSeconds(frameCount / fps);
}

function formatPercentage(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0%';
  }

  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function matchesRecentStatusTimeFilter(lens: LensRecord, filter: RecentTimeRangeFilter, startDate: string, endDate: string): boolean {
  if (filter === 'all') {
    return true;
  }

  const eventDate = parseDateTimeValue(lens.recentStatusActionTime);
  if (!eventDate) {
    return false;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === 'today') {
    return eventDate >= todayStart;
  }

  if (filter === 'last2days') {
    const rangeStart = new Date(todayStart);
    rangeStart.setDate(rangeStart.getDate() - 1);
    return eventDate >= rangeStart;
  }

  if (filter === 'last7days') {
    const rangeStart = new Date(todayStart);
    rangeStart.setDate(rangeStart.getDate() - 6);
    return eventDate >= rangeStart;
  }

  const customStart = parseDateInputValue(startDate, false);
  const customEnd = parseDateInputValue(endDate, true);
  if (!customStart && !customEnd) {
    return true;
  }

  if (customStart && eventDate < customStart) {
    return false;
  }

  if (customEnd && eventDate > customEnd) {
    return false;
  }

  return true;
}

function parseDateTimeValue(value: string): Date | null {
  if (!value.trim()) {
    return null;
  }

  const normalized = value.trim().replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatLensDateTime(value: string): string {
  const parsed = parseDateTimeValue(value);
  if (!parsed) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}

function parseDateInputValue(value: string, endOfDay: boolean): Date | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = new Date(`${value.trim()}T${endOfDay ? '23:59:59' : '00:00:00'}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasAnyLensIssue(lens: LensRecord): boolean {
  return lens.currentVersionIssues.length > 0 || !lens.layoutReady;
}

function matchesLensMissingFilter(lens: LensRecord, filter: MissingItemFilter): boolean {
  switch (filter) {
    case 'any':
      return hasAnyLensIssue(lens);
    case 'ma':
      return lens.currentVersionIssues.some((issue) => issue.fileType === 'ma');
    case 'mov':
      return lens.currentVersionIssues.some((issue) => issue.fileType === 'mov');
    case 'layout':
      return !lens.layoutReady;
    case 'all':
    default:
      return true;
  }
}

function matchesProblemTypeFilter(lens: LensRecord, filter: ProblemTypeFilter): boolean {
  switch (filter) {
    case 'layout-missing':
      return !lens.layoutReady && lens.layoutCandidateCount === 0;
    case 'layout-unselected':
      return !lens.layoutReady && lens.layoutCandidateCount > 0 && !lens.selectedLayoutFileName;
    case 'layout-selected-missing':
      return !lens.layoutReady && lens.layoutCandidateCount > 0 && Boolean(lens.selectedLayoutFileName);
    case 'ma-unbound':
      return lens.currentVersionIssues.some((issue) => issue.fileType === 'ma' && (issue.reason === '未绑定' || issue.reason === '文件缺失'));
    case 'mov-unbound':
      return lens.currentVersionIssues.some((issue) => issue.fileType === 'mov' && (issue.reason === '未绑定' || issue.reason === '文件缺失'));
    case 'multi-candidate':
      return lens.currentVersionIssues.some((issue) => issue.reason === '多候选待确认');
    case 'frame-mismatch':
      return lens.currentVersionIssues.some((issue) => issue.reason === '帧数不匹配');
    case 'all':
    default:
      return true;
  }
}

function compareLenses(left: LensRecord, right: LensRecord, field: LensSortField, direction: SortDirection): number {
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  const factor = direction === 'asc' ? 1 : -1;

  const compareText = (leftText: string, rightText: string) => collator.compare(leftText || '', rightText || '');
  const compareNumber = (leftValue: number, rightValue: number) => leftValue - rightValue;

  let result = 0;
  switch (field) {
    case 'lensCode':
      result = compareText(left.lensCode, right.lensCode);
      break;
    case 'updateTime':
      result = compareText(left.updateTime, right.updateTime);
      break;
    case 'versionNum':
      result = compareText(left.versionNum, right.versionNum);
      break;
    case 'maker':
      result = compareText(left.maker, right.maker);
      break;
    case 'sequence':
    default:
      result = compareNumber(left.sceneNo, right.sceneNo) || compareText(left.lensCode, right.lensCode);
      break;
  }

  return result * factor;
}
