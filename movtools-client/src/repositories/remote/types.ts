import type { ScanRootFileKind } from '../../types/fileCheck';

export interface RemoteRootResponse {
  rootId?: string | null;
  fileKind?: ScanRootFileKind | null;
  label?: string | null;
  absolutePath?: string | null;
  initExcelPath?: string | null;
  priority?: number | null;
  isEnabled?: boolean | null;
}

export interface RemoteProjectResponse {
  code: string;
  name: string;
  description?: string | null;
  projectRootPath?: string | null;
  projectDefaultFps?: number | null;
  versionTag: string;
  layoutTag: string;
  lensRoots?: RemoteRootResponse[];
  layoutRoots?: RemoteRootResponse[];
  lensFolderRootPath?: string | null;
  maCheckPath?: string | null;
  movCheckPath?: string | null;
  layoutCheckPath?: string | null;
  isArchived: boolean;
  rowVersion: number;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface RemoteEpisodeResponse {
  id: string;
  code: string;
  name: string;
  sequence: number;
  description?: string | null;
  projectId: string;
  projectCode: string;
  versionTag?: string | null;
  layoutTag?: string | null;
  lensFolderRootPath?: string | null;
  layoutCheckPath?: string | null;
  initExcelPath?: string | null;
  lensRoots?: RemoteRootResponse[];
  layoutRoots?: RemoteRootResponse[];
  isArchived: boolean;
  rowVersion: number;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface RemoteLensResponse {
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
  makerMatchStatus?: 'matched' | 'unmatched' | 'unassigned';
  description?: string | null;
  rootCode?: string | null;
  logicalPath?: string | null;
  versionTag?: string | null;
  layoutTag?: string | null;
  internalReviewStatusCode?: 'NOT_IN_REVIEW' | 'READY_FOR_REVIEW' | 'IN_DIRECTOR_REVIEW' | 'PENDING_FEEDBACK_FIX' | 'FIX_UPDATED' | 'DIRECTOR_APPROVED' | null;
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

export interface RemoteProjectCreateResponse {
  code: string;
  name: string;
  description?: string | null;
  projectRootPath?: string | null;
  versionTag: string;
  layoutTag: string;
  project?: RemoteProjectResponse;
  initialEpisode?: RemoteEpisodeResponse | null;
  initResult?: import('../../types/ipc').ProjectInitializationResult;
  pendingClientActions?: import('../../types/ipc').ProjectClientAction[];
}
