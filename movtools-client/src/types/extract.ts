import type { BindFileType } from './fileCheck';
import type { LensStatus } from './lens';

export type ExtractFileSelection = 'ma' | 'mov' | 'ma+mov';

export interface ExtractFilter {
  lensCode?: string;
  maker?: string;
  lensStatus?: LensStatus | '';
  versionNum?: string;
  fileSelection: ExtractFileSelection;
}

export interface ExtractPreviewItem {
  itemId: string;
  lensCode: string;
  maker: string;
  lensStatus: LensStatus;
  versionNum: string;
  fileName: string;
  fileType: BindFileType;
  sourcePath: string;
  sourceFileName: string;
  targetFileName: string;
}

export interface ExtractPreviewResponse {
  success: boolean;
  previewId?: string;
  items: ExtractPreviewItem[];
  error?: string;
}

export interface ExtractExecutionLogItem {
  itemId: string;
  lensCode: string;
  fileType: BindFileType;
  sourcePath: string;
  targetPath?: string;
  targetFileName: string;
  success: boolean;
  error?: string;
}

export interface ExtractRecordItem {
  recordId: string;
  extractTime: string;
  fileTotal: number;
  maFileNum: number;
  movFileNum: number;
  targetPath: string;
  isSuccess: '是' | '否';
  failReason: string;
}

export interface ExtractHistoryResponse {
  success: boolean;
  records: ExtractRecordItem[];
  error?: string;
}
