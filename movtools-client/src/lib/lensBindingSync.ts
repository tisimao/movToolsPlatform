import { getDataSource, lensService } from '../services/repositoryService';
import type { LensDetailPayload, LensRecord, LensBindingType, ServerLensFileBindingResponse } from '../types/lens';

type LensBindingSyncResponse = {
  success: boolean;
  error?: string;
};

interface LensBindingSyncTarget {
  lensId: string;
  bindingType: LensBindingType;
  relativePath: string;
  sourceRoot?: string | null;
  versionNum?: string | null;
  fileName?: string | null;
}

interface LensBindingSyncOptions {
  lensIds: string[];
  resolveLens: (lensId: string) => LensRecord | undefined;
  resolveLensDetail?: (lensId: string) => Promise<LensDetailPayload | null>;
}

function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function normalizeVersionKey(versionNum?: string | null): string {
  return (versionNum ?? '').trim().toUpperCase();
}

function normalizePathForComparison(value: string): string {
  return value.replace(/[\\/]+/g, '\\').replace(/[\\/]+$/g, '').toUpperCase();
}

function buildBindingKey(binding: {
  bindingType: LensBindingType;
  relativePath: string;
  sourceRoot?: string | null;
  versionNum?: string | null;
  fileName?: string | null;
}): string {
  return [
    binding.bindingType,
    normalizeVersionKey(binding.versionNum),
    normalizePathForComparison(binding.relativePath),
    (binding.fileName ?? '').trim().toUpperCase(),
    (binding.sourceRoot ?? '').trim().toUpperCase(),
  ].join('::');
}

function buildLocalTargets(lens: LensRecord, state: Awaited<ReturnType<typeof window.movtools.fileCheck.getState>>): LensBindingSyncTarget[] {
  const lensCode = lens.lensCode;
  const versionKey = normalizeVersionKey(lens.versionNum);
  const targets: LensBindingSyncTarget[] = [];

  for (const binding of state.bindings[lensCode] ?? []) {
    if (binding.fileType !== 'ma' && binding.fileType !== 'mov') {
      continue;
    }

    if (normalizeVersionKey(binding.versionNum) !== versionKey) {
      continue;
    }

    targets.push({
      lensId: lens.lensId,
      bindingType: binding.fileType,
      relativePath: binding.relativePath,
      sourceRoot: binding.sourceRoot ?? null,
      versionNum: binding.versionNum,
      fileName: binding.fileName ?? getFileNameFromPath(binding.relativePath),
    });
  }

  const selectedLayout = (state.layoutCandidates[lensCode] ?? []).find((candidate) => candidate.isSelected)
    ?? (state.layoutCandidates[lensCode] ?? [])[0];
  if (selectedLayout) {
    targets.push({
      lensId: lens.lensId,
      bindingType: 'layout',
      relativePath: selectedLayout.relativePath,
      sourceRoot: selectedLayout.sourceRoot ?? null,
      fileName: selectedLayout.fileName,
    });

    const selectedLayoutVideo = (state.layoutVideoBindings[lensCode] ?? []).find((binding) => binding.candidateId === selectedLayout.candidateId);
    if (selectedLayoutVideo) {
      targets.push({
        lensId: lens.lensId,
        bindingType: 'layoutVideo',
        relativePath: selectedLayoutVideo.relativePath,
        sourceRoot: selectedLayoutVideo.sourceRoot ?? null,
        fileName: selectedLayoutVideo.fileName,
      });
    }
  }

  const uniqueTargets = new Map<string, LensBindingSyncTarget>();
  for (const target of targets) {
    const key = buildBindingKey(target);
    if (!uniqueTargets.has(key)) {
      uniqueTargets.set(key, target);
    }
  }

  return [...uniqueTargets.values()];
}

function buildRemoteBindings(detail: LensDetailPayload): ServerLensFileBindingResponse[] {
  if (detail.serverBindings) {
    return detail.serverBindings;
  }

  return detail.versions.flatMap((version) =>
    version.bindings.map((binding) => ({
      bindingId: binding.bindingId ?? binding.fileId,
      lensId: binding.lensId ?? detail.lens.lensId,
      lensCode: binding.lensCode,
      bindingType: binding.bindingType ?? binding.fileType,
      relativePath: binding.relativePath,
      sourceRoot: binding.sourceRoot ?? null,
      versionNum: binding.versionNum,
      fileName: binding.fileName ?? getFileNameFromPath(binding.relativePath),
      bindTime: binding.bindTime,
    })),
  );
}

export async function refreshAndSyncLensBindings(options: LensBindingSyncOptions): Promise<LensBindingSyncResponse> {
  const uniqueLensIds = [...new Set(options.lensIds.filter(Boolean))];
  if (uniqueLensIds.length === 0) {
    return { success: true };
  }

  const refreshResponse = await window.movtools.fileCheck.refreshLensBindings({ lensIds: uniqueLensIds });
  if (!refreshResponse.success) {
    return { success: false, error: refreshResponse.error ?? '自动文件匹配失败。' };
  }

  const layoutRefreshResponse = await window.movtools.fileCheck.scanLayout();
  if (!layoutRefreshResponse.success) {
    return { success: false, error: layoutRefreshResponse.error ?? 'Layout 文件匹配失败。' };
  }

  if (getDataSource() !== 'remote') {
    return { success: true };
  }

  const state = await window.movtools.fileCheck.getState();
  if (!state.success) {
    return { success: false, error: state.error ?? '读取本地刷新结果失败。' };
  }

  for (const lensId of uniqueLensIds) {
    const lens = options.resolveLens(lensId);
    if (!lens) {
      return { success: false, error: `未找到镜头 ${lensId} 的本地绑定信息。` };
    }

    const resolvedDetail = await options.resolveLensDetail?.(lensId);
    const detailResponse = resolvedDetail ?? (await lensService.getLensDetail(lensId)).detail ?? null;
    if (!detailResponse) {
      return { success: false, error: `未找到镜头 ${lens.lensCode} 的服务端绑定信息。` };
    }

    const localTargets = buildLocalTargets(lens, state);
    const localKeySet = new Set(localTargets.map((target) => buildBindingKey(target)));
    const remoteBindings = buildRemoteBindings(detailResponse);

    for (const binding of remoteBindings) {
      const key = buildBindingKey(binding);
      if (localKeySet.has(key)) {
        continue;
      }

      const deleteResponse = await lensService.deleteLensFileBinding(lensId, binding.bindingType as 'ma' | 'mov' | 'layout' | 'layoutVideo', binding.versionNum ?? null);
      if (!deleteResponse.success) {
        return { success: false, error: deleteResponse.error ?? '删除服务端旧文件绑定失败。' };
      }
    }

    for (const target of localTargets) {
      const syncResponse = await lensService.syncLensFileBinding(target.lensId, {
        bindingType: target.bindingType,
        relativePath: target.relativePath,
        sourceRoot: target.sourceRoot ?? null,
        versionNum: target.versionNum ?? null,
        fileName: target.fileName ?? null,
      });

      if (!syncResponse.success) {
        return { success: false, error: syncResponse.error ?? '同步文件绑定失败。' };
      }
    }
  }

  return { success: true };
}
