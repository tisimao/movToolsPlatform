export type FilePresenceStatus = '存在' | '缺失';
export type FileOverallStatus = '正常' | '缺失ma' | '缺失mov' | '缺失layout' | '缺失ma+mov' | '缺失ma+layout' | '缺失mov+layout' | '全部缺失';
export type BindFileType = 'ma' | 'mov';
export type LayoutReferenceCheckStatus = '未检查' | '正常' | '存在缺失' | 'layout文件缺失' | '读取失败';
export type LayoutReferenceIssueType = '路径不存在' | '路径存在但文件不存在' | '路径存在但文件名不匹配';
export type ScanRootFileKind = 'ma' | 'mov' | 'layout';

export interface ScanRootConfigItem {
  rootId: string;
  fileKind: ScanRootFileKind;
  label: string;
  absolutePath: string;
  initExcelPath?: string;
  priority: number;
  isEnabled: boolean;
}

export interface LensLayoutCandidate {
  candidateId: string;
  lensCode: string;
  fileName: string;
  relativePath: string;
  absolutePath: string;
  bindTime: string;
  exists: boolean;
  isSelected: boolean;
  source: 'auto-scan' | 'manual';
  sourceRoot?: string;
}

export interface LensLayoutVideoBinding {
  bindingId: string;
  candidateId?: string;
  lensCode: string;
  fileName: string;
  relativePath: string;
  absolutePath: string;
  bindTime: string;
  exists: boolean;
  sourceRoot?: string;
}

export interface LensBoundFile {
  bindingId?: string;
  lensId?: string;
  fileId: string;
  lensCode: string;
  versionNum: string;
  fileType: BindFileType;
  bindingType?: BindFileType | 'layout' | 'layoutVideo';
  fileName?: string;
  relativePath: string;
  bindTime: string;
  absolutePath: string;
  sourceRoot?: string | null;
  exists?: boolean;
}

export interface FileCheckRecord {
  checkId: string;
  episodeId: string;
  lensCode: string;
  maStatus: FilePresenceStatus;
  movStatus: FilePresenceStatus;
  layoutStatus: FilePresenceStatus;
  layoutCandidateCount: number;
  overallStatus: FileOverallStatus;
  lastCheckTime: string;
}

export interface LayoutReferenceIssue {
  issueId: string;
  issueType: LayoutReferenceIssueType;
  refOriginalPath: string;
  refAbsolutePath: string;
  refDirectory: string;
  expectedFileName: string;
  coreBasename: string;
  relatedFilesSameDir: string[];
  relatedFilesParentDirs: string[];
}

export interface LayoutReferenceCheckRecord {
  checkId: string;
  episodeId: string;
  lensCode: string;
  candidateId: string;
  layoutFileName: string;
  layoutRelativePath: string;
  layoutAbsolutePath: string;
  layoutExists: boolean;
  status: LayoutReferenceCheckStatus;
  issueCount: number;
  pathMissingCount: number;
  fileMissingCount: number;
  fileNameMismatchCount: number;
  checkedReferenceCount: number;
  lastCheckTime: string;
  errorMessage?: string;
  issues: LayoutReferenceIssue[];
}

export interface FileCheckConfig {
  versionTag: string;
  layoutTag: string;
  lensFolderRootPath: string;
  layoutCheckPath: string;
  lensRoots: ScanRootConfigItem[];
  layoutRoots: ScanRootConfigItem[];
}

export interface FileCheckSummary {
  totalLensCount: number;
  missingMaCount: number;
  missingMovCount: number;
  missingLayoutCount: number;
  allMissingCount: number;
  lastCheckTime?: string;
}

export interface LayoutReferenceSummary {
  selectedLayoutLensCount: number;
  checkedLensCount: number;
  issueLensCount: number;
  totalIssueCount: number;
  lastCheckTime?: string;
}

export interface FileCheckStatePayload {
  success: boolean;
  activeProjectId: string | null;
  activeProjectName?: string;
  activeEpisodeId?: string | null;
  activeEpisodeCode?: string;
  activeEpisodeName?: string;
  config: FileCheckConfig;
  records: FileCheckRecord[];
  bindings: Record<string, LensBoundFile[]>;
  layoutCandidates: Record<string, LensLayoutCandidate[]>;
  layoutVideoBindings: Record<string, LensLayoutVideoBinding[]>;
  summary: FileCheckSummary;
  layoutReferenceChecks: LayoutReferenceCheckRecord[];
  layoutReferenceSummary: LayoutReferenceSummary;
  error?: string;
}
