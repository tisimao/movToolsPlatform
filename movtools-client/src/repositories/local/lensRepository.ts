/**
 * 本地镜头仓储实现
 * 
 * 通过 window.movtools API（preload 暴露）调用主进程服务。
 */
import type { ILensRepository } from '../types';
import type { LensDetailPayload, LensListResponse, LensRecord, LensStatus, LensStatusAction, MakerMatchStatus } from '../../types/lens';
import type { LensMutationResponse, UpdateReworkRecordRequest } from '../../types/ipc';
import type { InternalReviewStatusCode } from '../../lib/internalReview';

class LocalLensRepository implements ILensRepository {
  async listLenses(): Promise<LensListResponse> {
    return window.movtools.lens.list();
  }

  async getLensDetail(lensId: string): Promise<{ success: boolean; detail?: LensDetailPayload; error?: string }> {
    return window.movtools.lens.detail({ lensId });
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
    return window.movtools.lens.create(request as Parameters<typeof window.movtools.lens.create>[0]);
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
    return window.movtools.lens.update({ lensId, ...request } as Parameters<typeof window.movtools.lens.update>[0]);
  }

  async updateLensStatus(lensId: string, action: LensStatusAction, note?: string, imagePaths?: string[]): Promise<LensMutationResponse> {
    return window.movtools.lens.updateStatus({ lensId, action, note, imagePaths } as Parameters<typeof window.movtools.lens.updateStatus>[0]);
  }

  async updateInternalReviewStatus(lensId: string, targetStatusCode: InternalReviewStatusCode, note?: string): Promise<LensMutationResponse> {
    return window.movtools.lens.updateInternalReviewStatus({ lensId, targetStatusCode, note } as Parameters<typeof window.movtools.lens.updateInternalReviewStatus>[0]);
  }

  async batchUpdateLensStatus(lensIds: string[], action: LensStatusAction, note?: string, imagePaths?: string[]): Promise<LensMutationResponse> {
    return window.movtools.lens.batchUpdateStatus({ lensIds, action, note, imagePaths } as Parameters<typeof window.movtools.lens.batchUpdateStatus>[0]);
  }

  async updateReworkRecord(request: UpdateReworkRecordRequest): Promise<LensMutationResponse> {
    return window.movtools.lens.updateReworkRecord(request as Parameters<typeof window.movtools.lens.updateReworkRecord>[0]);
  }

  async uploadRepairAttachment(_lensId: string, _filePath: string, _sortOrder: number, _lensStatusHistoryId?: string | null): Promise<LensMutationResponse> {
    return { success: false, error: '本地模式不需要上传返修附件。' };
  }

  async deleteLens(lensId: string): Promise<LensMutationResponse> {
    return window.movtools.lens.delete({ lensId } as Parameters<typeof window.movtools.lens.delete>[0]);
  }

  async batchDeleteLenses(lensIds: string[]): Promise<LensMutationResponse> {
    return window.movtools.lens.batchDelete({ lensIds } as Parameters<typeof window.movtools.lens.batchDelete>[0]);
  }

  async importLenses(filePath: string): Promise<LensMutationResponse> {
    return window.movtools.lens.import({ filePath } as Parameters<typeof window.movtools.lens.import>[0]);
  }

  async exportIssueReport(lensIds: string[], mode?: 'all-issues' | 'missing-layout'): Promise<{ success: boolean; filePath?: string; exportedCount?: number; error?: string }> {
    return window.movtools.lens.exportIssues({ lensIds, mode } as Parameters<typeof window.movtools.lens.exportIssues>[0]);
  }

  async syncLensFileBinding(_lensId: string, _request: {
    bindingType: 'ma' | 'mov' | 'layout' | 'layoutVideo';
    relativePath: string;
    sourceRoot?: string | null;
    versionNum?: string | null;
    fileName?: string | null;
  }): Promise<LensMutationResponse> {
    return { success: false, error: '本地模式不需要同步镜头文件绑定。' };
  }

  async deleteLensFileBinding(_lensId: string, _bindingType: 'ma' | 'mov' | 'layout' | 'layoutVideo', _versionNum?: string | null): Promise<LensMutationResponse> {
    return { success: false, error: '本地模式不需要删除镜头文件绑定。' };
  }
}

export const localLensRepository = new LocalLensRepository();
