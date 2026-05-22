export interface ActivationRootOverrides {
  projectRootPath?: string;
  lensFolderRootPath?: string;
  layoutCheckPath?: string;
  updatedAt: string;
}

const STORAGE_KEY = 'movtools.activation-root-overrides.v1';

function loadAllOverrides(): Record<string, ActivationRootOverrides> {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as Record<string, ActivationRootOverrides>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveAllOverrides(overrides: Record<string, ActivationRootOverrides>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function getActivationRootOverrides(projectId: string): ActivationRootOverrides | undefined {
  if (!projectId) {
    return undefined;
  }

  const overrides = loadAllOverrides();
  return overrides[projectId];
}

export function saveActivationRootOverrides(projectId: string, overrides: {
  projectRootPath?: string;
  lensFolderRootPath?: string;
  layoutCheckPath?: string;
}): ActivationRootOverrides {
  const next: ActivationRootOverrides = {
    projectRootPath: overrides.projectRootPath?.trim() || undefined,
    lensFolderRootPath: overrides.lensFolderRootPath?.trim() || undefined,
    layoutCheckPath: overrides.layoutCheckPath?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };

  const allOverrides = loadAllOverrides();
  allOverrides[projectId] = next;
  saveAllOverrides(allOverrides);
  return next;
}

export function clearActivationRootOverrides(projectId: string): void {
  if (!projectId) {
    return;
  }

  const allOverrides = loadAllOverrides();
  delete allOverrides[projectId];
  saveAllOverrides(allOverrides);
}
