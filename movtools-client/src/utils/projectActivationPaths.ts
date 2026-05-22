import type { EpisodeSummary, ProjectSummary } from '../types/project';
import type { ScanRootConfigItem } from '../types/fileCheck';

export type ActivationPathSource = 'main' | 'roots';

export type ActivationPathKind = '项目根目录' | '镜头根目录' | 'Layout 根目录';

export interface ActivationPathResolution {
  configuredPath?: string;
  resolvedPath?: string;
  source: ActivationPathSource | null;
  missingServicePath: boolean;
  localMismatch: boolean;
}

export interface ActivationPathCandidate {
  explicitPath?: string | null;
  roots?: ActivationRootLike[];
  source: ActivationPathSource;
}

export interface ActivationRootLike {
  absolutePath: string;
  label: string;
  priority: number;
  isEnabled: boolean;
}

type PathExistsChecker = (path: string) => Promise<boolean>;

function isEnabledRootLike(root: ActivationRootLike | undefined): root is ActivationRootLike {
  return Boolean(root && root.isEnabled && typeof root.absolutePath === 'string' && root.absolutePath.trim());
}

function getPreferredEnabledRootPath(roots?: ActivationPathCandidate['roots']): string | undefined {
  const enabledRoots = (roots ?? []).filter(isEnabledRootLike);
  if (enabledRoots.length === 0) {
    return undefined;
  }

  return enabledRoots
    .slice()
    .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, 'zh-CN'))[0]?.absolutePath?.trim() || undefined;
}

function splitWindowsDrivePath(value: string): { drivePath: string; relativePath: string } | null {
  const trimmed = value.trim().replace(/[\\/]+$/, '');
  const match = trimmed.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) {
    return null;
  }

  return {
    drivePath: `${match[1].toUpperCase()}:\\`,
    relativePath: match[2].replace(/[\\/]+/g, '\\'),
  };
}

export async function resolveWindowsDriveVariantPath(sourcePath: string, exists: PathExistsChecker): Promise<string | null> {
  const targetPath = sourcePath.trim();
  if (!targetPath) {
    return null;
  }

  if (await exists(targetPath)) {
    return targetPath;
  }

  const split = splitWindowsDrivePath(targetPath);
  if (!split) {
    return null;
  }

  const candidateDrives = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
  for (const drive of candidateDrives) {
    if (`${drive}:\\` === split.drivePath) {
      continue;
    }

    const candidate = `${drive}:\\${split.relativePath}`;
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function resolveActivationPath(
  candidates: ActivationPathCandidate[],
  exists: PathExistsChecker,
): Promise<ActivationPathResolution> {
  let firstConfiguredPath: string | undefined;
  let firstSource: ActivationPathSource | null = null;

  for (const candidate of candidates) {
    const configuredPaths = [candidate.explicitPath?.trim(), getPreferredEnabledRootPath(candidate.roots)]
      .filter((value): value is string => Boolean(value));

    for (const configuredPath of configuredPaths) {
      if (!firstConfiguredPath) {
        firstConfiguredPath = configuredPath;
        firstSource = candidate.source;
      }

      const resolvedPath = await resolveWindowsDriveVariantPath(configuredPath, exists);
      if (resolvedPath) {
        return {
          configuredPath,
          resolvedPath,
          source: candidate.source,
          missingServicePath: false,
          localMismatch: false,
        };
      }
    }
  }

  if (firstConfiguredPath) {
    return {
      configuredPath: firstConfiguredPath,
      source: firstSource,
      missingServicePath: false,
      localMismatch: true,
    };
  }

  return {
    source: null,
    missingServicePath: true,
    localMismatch: false,
  };
}

export async function resolveProjectActivationPaths(
  project: ProjectSummary,
  episode: EpisodeSummary | null | undefined,
  exists: PathExistsChecker,
): Promise<{
  projectRootPath: ActivationPathResolution;
  lensFolderRootPath: ActivationPathResolution;
  layoutCheckPath: ActivationPathResolution;
}> {
  const projectLensRoots = getEnabledRootCandidates(project.lensRoots);
  const projectLayoutRoots = getEnabledRootCandidates(project.layoutRoots);
  const episodeLensRoots = getEnabledRootCandidates(episode?.lensRoots);
  const episodeLayoutRoots = getEnabledRootCandidates(episode?.layoutRoots);
  const projectLensExplicitPath = isDistinctComparablePath(project.lensFolderRootPath, project.projectRootPath)
    ? project.lensFolderRootPath
    : undefined;
  const projectLayoutExplicitPath = isDistinctComparablePath(project.layoutCheckPath, project.projectRootPath)
    ? project.layoutCheckPath
    : undefined;
  const episodeLensExplicitPath = isDistinctComparablePath(episode?.lensFolderRootPath, project.projectRootPath)
    ? episode?.lensFolderRootPath
    : undefined;
  const episodeLayoutExplicitPath = isDistinctComparablePath(episode?.layoutCheckPath, project.projectRootPath)
    ? episode?.layoutCheckPath
    : undefined;

  return {
    projectRootPath: await resolveActivationPath([
      { explicitPath: project.projectRootPath, source: 'main' },
    ], exists),
    lensFolderRootPath: await resolveActivationPath([
      { explicitPath: episodeLensExplicitPath, roots: episodeLensRoots.length > 0 ? episodeLensRoots : undefined, source: 'main' },
      { explicitPath: projectLensExplicitPath, roots: projectLensRoots.length > 0 ? projectLensRoots : undefined, source: 'roots' },
    ], exists),
    layoutCheckPath: await resolveActivationPath([
      { explicitPath: episodeLayoutExplicitPath, roots: episodeLayoutRoots.length > 0 ? episodeLayoutRoots : undefined, source: 'main' },
      { explicitPath: projectLayoutExplicitPath, roots: projectLayoutRoots.length > 0 ? projectLayoutRoots : undefined, source: 'roots' },
    ], exists),
  };
}

function getEnabledRootCandidates(roots: ActivationRootLike[] | undefined): ActivationRootLike[] {
  return (roots ?? []).filter(isEnabledRootLike);
}

function isDistinctComparablePath(candidate: string | null | undefined, reference: string | null | undefined): boolean {
  const normalizedCandidate = normalizeComparablePath(candidate ?? '');
  const normalizedReference = normalizeComparablePath(reference ?? '');
  return Boolean(normalizedCandidate) && normalizedCandidate !== normalizedReference;
}

export async function resolveConfiguredRootsToLocal<T extends ActivationRootLike>(
  roots: T[] | undefined,
  exists: PathExistsChecker,
): Promise<T[] | undefined> {
  const input = roots?.filter(isEnabledRootLike) ?? [];
  if (input.length === 0) {
    return undefined;
  }

  const output: T[] = [];
  for (const root of input) {
    const resolvedPath = await resolveWindowsDriveVariantPath(root.absolutePath, exists);
    output.push({
      ...root,
      absolutePath: resolvedPath ?? root.absolutePath,
    } as T);
  }

  return output;
}

export function getLensLayoutRootConflictMessageFromPaths(lensPaths: string[], layoutPaths: string[]): string | null {
  const conflicts = findLensLayoutRootConflicts(lensPaths, layoutPaths);
  if (conflicts.length === 0) {
    return null;
  }

  const details = conflicts
    .slice(0, 3)
    .map((conflict) => conflict.kind === 'same'
      ? `重复目录：${conflict.lensPath}`
      : `存在包含关系：镜头 ${conflict.lensPath} ↔ Layout ${conflict.layoutPath}`)
    .join('；');
  const suffix = conflicts.length > 3 ? `；另有 ${conflicts.length - 3} 处冲突` : '';

  return `镜头根目录与 Layout 根目录不能重复或互相包含，否则会交叉扫描版本文件与 Layout 文件。${details}${suffix}`;
}

function findLensLayoutRootConflicts(lensPaths: string[], layoutPaths: string[]): Array<{ lensPath: string; layoutPath: string; kind: 'same' | 'nested' }> {
  const conflicts = new Map<string, { lensPath: string; layoutPath: string; kind: 'same' | 'nested' }>();

  lensPaths.filter(Boolean).forEach((lensPath) => {
    layoutPaths.filter(Boolean).forEach((layoutPath) => {
      const normalizedLens = normalizeComparablePath(lensPath);
      const normalizedLayout = normalizeComparablePath(layoutPath);
      if (normalizedLens === normalizedLayout) {
        conflicts.set(`${normalizedLens}::${normalizedLayout}::same`, { lensPath, layoutPath, kind: 'same' });
        return;
      }

      if (isNestedComparablePath(normalizedLens, normalizedLayout) || isNestedComparablePath(normalizedLayout, normalizedLens)) {
        conflicts.set(`${normalizedLens}::${normalizedLayout}::nested`, { lensPath, layoutPath, kind: 'nested' });
      }
    });
  });

  return [...conflicts.values()];
}

function normalizeComparablePath(value: string): string {
  return value
    .replace(/[\\/]+/g, '\\')
    .replace(/[\\/]+$/, '')
    .toUpperCase();
}

function isNestedComparablePath(parentPath: string, childPath: string): boolean {
  return childPath.startsWith(`${parentPath}\\`);
}

export function collectActivationTrace(project?: ProjectSummary, episode?: EpisodeSummary | null): string {
  const parts = [
    `项目主字段=${project?.projectRootPath || '空'}`,
    `项目主镜头=${project?.lensFolderRootPath || '空'}`,
    `项目主Layout=${project?.layoutCheckPath || '空'}`,
    `项目roots镜头=${describeRootCandidates(project?.lensRoots)}`,
    `项目rootsLayout=${describeRootCandidates(project?.layoutRoots)}`,
    `集主字段镜头=${episode?.lensFolderRootPath || '空'}`,
    `集主字段layout=${episode?.layoutCheckPath || '空'}`,
    `集roots镜头=${describeRootCandidates(episode?.lensRoots)}`,
    `集rootsLayout=${describeRootCandidates(episode?.layoutRoots)}`,
  ];
  return parts.join('；');
}

export function describeRootCandidates(roots?: ActivationPathCandidate['roots']): string {
  const enabledRoots = (roots ?? []).filter(isEnabledRootLike);
  if (enabledRoots.length === 0) {
    return '无可用根目录';
  }

  return enabledRoots
    .slice()
    .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, 'zh-CN'))
    .map((root) => `${root.label}:${root.absolutePath}`)
    .join('；');
}

export function collectEnabledRootPaths(roots?: ActivationPathCandidate['roots']): string[] {
  return (roots ?? [])
    .filter(isEnabledRootLike)
    .map((root) => root.absolutePath.trim())
    .filter(Boolean);
}
