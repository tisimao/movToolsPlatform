import type { ProjectSummary } from '../types/project';

export const DEFAULT_PROJECT_PLAYBACK_FPS = 30;

export function normalizeProjectPlaybackFps(value?: number | null): number {
  return Number.isFinite(value ?? NaN) && (value ?? 0) > 0 ? Math.trunc(value as number) : DEFAULT_PROJECT_PLAYBACK_FPS;
}

export function resolveProjectPlaybackFps(project?: Pick<ProjectSummary, 'projectDefaultFps'> | null): number {
  return normalizeProjectPlaybackFps(project?.projectDefaultFps);
}
