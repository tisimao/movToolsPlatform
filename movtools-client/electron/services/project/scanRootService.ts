import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type ScanRootFileKind = 'ma' | 'mov' | 'layout';

export interface ConfiguredScanRoot {
  rootId: string;
  fileKind: ScanRootFileKind;
  label: string;
  absolutePath: string;
  initExcelPath?: string;
  priority: number;
  isEnabled: boolean;
}

export interface GroupedConfiguredScanRoots {
  lens: ConfiguredScanRoot[];
  layout: ConfiguredScanRoot[];
}

interface ScanRootConflict {
  lensPath: string;
  layoutPath: string;
  kind: 'same' | 'nested';
}

interface ScanRootRow {
  root_id: string;
  scope_type: 'project' | 'episode';
  scope_id: string;
  file_kind: ScanRootFileKind;
  root_label: string;
  root_path: string;
  init_excel_path: string | null;
  priority: number | null;
  is_enabled: number;
  create_time: string;
  update_time: string;
}

interface ScopeIds {
  projectId: string;
  episodeId: string;
}

export function ensureScanRootTable(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS scan_root (
      root_id TEXT PRIMARY KEY NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      file_kind TEXT NOT NULL,
      root_label TEXT NOT NULL,
      root_path TEXT NOT NULL,
      init_excel_path TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      create_time TEXT NOT NULL,
      update_time TEXT NOT NULL
    );
  `);
}

export function readConfiguredScanRoots(database: DatabaseSync, scope: ScopeIds): Record<ScanRootFileKind, ConfiguredScanRoot[]> {
  ensureScanRootTable(database);
  const rows = database.prepare(`
    SELECT root_id, scope_type, scope_id, file_kind, root_label, root_path, init_excel_path, priority, is_enabled, create_time, update_time
    FROM scan_root
    WHERE (scope_type = 'project' AND scope_id = ?) OR (scope_type = 'episode' AND scope_id = ?)
    ORDER BY file_kind ASC, priority ASC, root_label ASC, root_path ASC
  `).all(scope.projectId, scope.episodeId) as unknown as ScanRootRow[];

  const result: Record<ScanRootFileKind, ConfiguredScanRoot[]> = { ma: [], mov: [], layout: [] };
  rows.forEach((row) => {
    result[row.file_kind].push({
      rootId: row.root_id,
        fileKind: row.file_kind,
        label: row.root_label,
        absolutePath: row.root_path,
        initExcelPath: row.init_excel_path ?? undefined,
        priority: row.priority ?? 100,
        isEnabled: row.is_enabled === 1,
      });
  });
  return result;
}

export function readGroupedConfiguredScanRoots(database: DatabaseSync, scope: ScopeIds): GroupedConfiguredScanRoots {
  const roots = readConfiguredScanRoots(database, scope);
  return {
    lens: mergeLensRoots(roots.ma, roots.mov),
    layout: roots.layout,
  };
}

export function replaceConfiguredScanRoots(
  database: DatabaseSync,
  scope: ScopeIds,
  roots: Record<ScanRootFileKind, ConfiguredScanRoot[]>,
  now: string,
): void {
  ensureScanRootTable(database);
  database.prepare('DELETE FROM scan_root WHERE scope_type = ? AND scope_id = ?').run('project', scope.projectId);
  database.prepare('DELETE FROM scan_root WHERE scope_type = ? AND scope_id = ?').run('episode', scope.episodeId);

  const insert = database.prepare(`
    INSERT INTO scan_root (root_id, scope_type, scope_id, file_kind, root_label, root_path, init_excel_path, priority, is_enabled, create_time, update_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  roots.ma.forEach((root, index) => {
    insert.run(root.rootId || createCompactId(), 'project', scope.projectId, 'ma', normalizeLabel(root.label, 'MA根目录', index), root.absolutePath, root.initExcelPath ?? null, root.priority, root.isEnabled ? 1 : 0, now, now);
  });
  roots.mov.forEach((root, index) => {
    insert.run(root.rootId || createCompactId(), 'project', scope.projectId, 'mov', normalizeLabel(root.label, '视频根目录', index), root.absolutePath, root.initExcelPath ?? null, root.priority, root.isEnabled ? 1 : 0, now, now);
  });
  roots.layout.forEach((root, index) => {
    insert.run(root.rootId || createCompactId(), 'episode', scope.episodeId, 'layout', normalizeLabel(root.label, 'Layout根目录', index), root.absolutePath, root.initExcelPath ?? null, root.priority, root.isEnabled ? 1 : 0, now, now);
  });
}

export function replaceLensScanRoots(database: DatabaseSync, scope: ScopeIds, roots: ConfiguredScanRoot[], now: string): void {
  ensureScanRootTable(database);
  database.prepare(`DELETE FROM scan_root WHERE scope_type = 'episode' AND scope_id = ? AND file_kind IN ('ma', 'mov')`).run(scope.episodeId);
  const insert = database.prepare(`
    INSERT INTO scan_root (root_id, scope_type, scope_id, file_kind, root_label, root_path, init_excel_path, priority, is_enabled, create_time, update_time)
    VALUES (?, 'episode', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  roots.forEach((root, index) => {
    const label = normalizeLabel(root.label, '镜头根目录', index);
    const rootId = root.rootId || createCompactId();
    insert.run(`${rootId}_ma`, scope.episodeId, 'ma', label, root.absolutePath, root.initExcelPath ?? null, root.priority, root.isEnabled ? 1 : 0, now, now);
    insert.run(`${rootId}_mov`, scope.episodeId, 'mov', label, root.absolutePath, root.initExcelPath ?? null, root.priority, root.isEnabled ? 1 : 0, now, now);
  });
}

export function replaceLayoutScanRoots(database: DatabaseSync, scope: ScopeIds, roots: ConfiguredScanRoot[], now: string): void {
  ensureScanRootTable(database);
  database.prepare(`DELETE FROM scan_root WHERE scope_type = 'episode' AND scope_id = ? AND file_kind = 'layout'`).run(scope.episodeId);
  const insert = database.prepare(`
    INSERT INTO scan_root (root_id, scope_type, scope_id, file_kind, root_label, root_path, init_excel_path, priority, is_enabled, create_time, update_time)
    VALUES (?, 'episode', ?, 'layout', ?, ?, ?, ?, ?, ?, ?)
  `);

  roots.forEach((root, index) => {
    insert.run(root.rootId || createCompactId(), scope.episodeId, normalizeLabel(root.label, 'Layout根目录', index), root.absolutePath, root.initExcelPath ?? null, root.priority, root.isEnabled ? 1 : 0, now, now);
  });
}

export function getEnabledScanRootPaths(roots: ConfiguredScanRoot[], fallbackPath?: string): string[] {
  const configured = roots
    .filter((root) => root.isEnabled && root.absolutePath.trim())
    .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, 'zh-CN'))
    .map((root) => root.absolutePath.trim());

  const fallback = fallbackPath?.trim() ? [fallbackPath.trim()] : [];
  return Array.from(new Set([...configured, ...fallback]));
}

export function getPrimaryScanRootPath(roots: ConfiguredScanRoot[]): string {
  return roots
    .filter((root) => root.isEnabled && root.absolutePath.trim())
    .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, 'zh-CN'))[0]?.absolutePath ?? '';
}

export function getLensLayoutRootConflictMessage(lensRoots: ConfiguredScanRoot[], layoutRoots: ConfiguredScanRoot[]): string | null {
  const conflicts = findLensLayoutRootConflicts(lensRoots, layoutRoots);
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

function normalizeLabel(value: string, fallbackPrefix: string, index: number): string {
  const normalized = value.trim();
  return normalized || `${fallbackPrefix}${index + 1}`;
}

function findLensLayoutRootConflicts(lensRoots: ConfiguredScanRoot[], layoutRoots: ConfiguredScanRoot[]): ScanRootConflict[] {
  const normalizedLensPaths = lensRoots
    .filter((root) => root.isEnabled && root.absolutePath.trim())
    .map((root) => root.absolutePath.trim());
  const normalizedLayoutPaths = layoutRoots
    .filter((root) => root.isEnabled && root.absolutePath.trim())
    .map((root) => root.absolutePath.trim());
  const conflicts = new Map<string, ScanRootConflict>();

  normalizedLensPaths.forEach((lensPath) => {
    normalizedLayoutPaths.forEach((layoutPath) => {
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

function mergeLensRoots(maRoots: ConfiguredScanRoot[], movRoots: ConfiguredScanRoot[]): ConfiguredScanRoot[] {
  const merged = new Map<string, ConfiguredScanRoot>();
  [...maRoots, ...movRoots].forEach((root, index) => {
    const key = `${root.absolutePath.trim().toUpperCase()}::${root.label.trim().toUpperCase()}::${root.priority}::${root.isEnabled ? 1 : 0}`;
    if (!merged.has(key)) {
      merged.set(key, {
        rootId: root.rootId.replace(/_(ma|mov)$/i, ''),
        fileKind: 'ma',
        label: root.label,
        absolutePath: root.absolutePath,
        initExcelPath: root.initExcelPath,
        priority: root.priority,
        isEnabled: root.isEnabled,
      });
    }
  });

  return [...merged.values()].sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, 'zh-CN') || left.absolutePath.localeCompare(right.absolutePath, 'zh-CN'));
}

function createCompactId(): string {
  return randomUUID().replaceAll('-', '');
}
