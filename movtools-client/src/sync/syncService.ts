/**
 * 同步服务 - 本地优先的同步机制
 * 
 * 实现：
 * - outbox: 离线时记录待同步操作
 * - push: 在线时将本地变更推送到服务端
 * - pull: 增量拉取服务端变更
 * - 网络状态监控与自动同步
 */
import { apiClient } from '../api/client';
import { getDataSource } from '../services/repositoryService';

/** 同步变更类型 */
export type SyncChangeType = 
  | 'lens.update' 
  | 'lens.status' 
  | 'review.submit' 
  | 'review.comment'
  | 'review.action'
  | 'pathMapping.update';

/** 同步变更记录 */
export interface SyncChangeRecord {
  id: string;
  type: SyncChangeType;
  payload: unknown;
  createdAt: string;
  synced: boolean;
  retryCount: number;
}

/** 网络状态 */
export type NetworkStatus = 'online' | 'offline' | 'checking';

/** 同步状态 */
export interface SyncState {
  status: 'idle' | 'syncing' | 'error';
  lastSyncTime: string | null;
  pendingCount: number;
  error: string | null;
}

/** 变更拉取响应 */
export interface PullChangesResponse {
  success: boolean;
  changes: Array<{
    id: string;
    type: string;
    payload: unknown;
    timestamp: string;
  }>;
  latestSequence: number;
  error?: string;
}

const OUTBOX_KEY = 'movtools.sync.outbox.v1';
const SYNC_STATE_KEY = 'movtools.sync.state.v1';
const LAST_SEQUENCE_KEY = 'movtools.sync.lastSequence.v1';

/** 本地存储键前缀 */
const STORAGE_KEYS = {
  outbox: OUTBOX_KEY,
  state: SYNC_STATE_KEY,
  lastSequence: LAST_SEQUENCE_KEY,
};

/**
 * 获取网络状态
 */
export function getNetworkStatus(): NetworkStatus {
  if (typeof navigator !== 'undefined') {
    return navigator.onLine ? 'online' : 'offline';
  }
  return 'offline';
}

/**
 * 加载 outbox 记录
 */
function loadOutbox(): SyncChangeRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.outbox);
    if (!stored) return [];
    return JSON.parse(stored) as SyncChangeRecord[];
  } catch {
    return [];
  }
}

/**
 * 保存 outbox 记录
 */
function saveOutbox(records: SyncChangeRecord[]): void {
  localStorage.setItem(STORAGE_KEYS.outbox, JSON.stringify(records));
}

/**
 * 加载同步状态
 */
function loadSyncState(): SyncState {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.state);
    if (!stored) {
      return { status: 'idle', lastSyncTime: null, pendingCount: 0, error: null };
    }
    return JSON.parse(stored) as SyncState;
  } catch {
    return { status: 'idle', lastSyncTime: null, pendingCount: 0, error: null };
  }
}

/**
 * 保存同步状态
 */
function saveSyncState(state: SyncState): void {
  localStorage.setItem(STORAGE_KEYS.state, JSON.stringify(state));
}

/**
 * 获取最后同步序号
 */
function getLastSequence(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.lastSequence);
    return stored ? parseInt(stored, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * 保存最后同步序号
 */
function setLastSequence(seq: number): void {
  localStorage.setItem(STORAGE_KEYS.lastSequence, String(seq));
}

/**
 * 添加变更到 outbox
 */
export function addToOutbox(type: SyncChangeType, payload: unknown): SyncChangeRecord {
  const record: SyncChangeRecord = {
    id: crypto.randomUUID(),
    type,
    payload,
    createdAt: new Date().toISOString(),
    synced: false,
    retryCount: 0,
  };
  
  const outbox = loadOutbox();
  outbox.push(record);
  saveOutbox(outbox);
  
  // 更新状态
  const state = loadSyncState();
  state.pendingCount = outbox.filter(r => !r.synced).length;
  saveSyncState(state);
  
  return record;
}

/**
 * 从 outbox 移除已同步的记录
 */
function removeSyncedFromOutbox(ids: string[]): void {
  const outbox = loadOutbox();
  const remaining = outbox.filter(r => !ids.includes(r.id));
  saveOutbox(remaining);
  
  // 更新状态
  const state = loadSyncState();
  state.pendingCount = remaining.filter(r => !r.synced).length;
  saveSyncState(state);
}

/**
 * 推送本地变更到服务端
 */
export async function pushChanges(): Promise<{ success: boolean; error?: string }> {
  // 检查数据源模式
  const dataSource = getDataSource();
  if (dataSource !== 'remote') {
    return { success: true }; // 本地模式不需要推送
  }
  
  // 检查网络状态
  const networkStatus = getNetworkStatus();
  if (networkStatus !== 'online') {
    return { success: true }; // 离线时不推送
  }
  
  const outbox = loadOutbox();
  const pendingRecords = outbox.filter(r => !r.synced);
  
  if (pendingRecords.length === 0) {
    return { success: true };
  }
  
  // 更新状态为 syncing
  const state = loadSyncState();
  state.status = 'syncing';
  saveSyncState(state);
  
  const syncedIds: string[] = [];
  
  for (const record of pendingRecords) {
    try {
      const result = await pushSingleChange(record);
      if (result.success) {
        syncedIds.push(record.id);
      } else {
        // 增加重试计数
        record.retryCount++;
        if (record.retryCount >= 3) {
          // 重试3次后放弃
          record.synced = true; // 标记为已处理，避免一直重试
        }
      }
    } catch {
      record.retryCount++;
    }
  }
  
  // 保存更新后的 outbox
  if (syncedIds.length > 0) {
    removeSyncedFromOutbox(syncedIds);
  } else {
    saveOutbox(outbox);
  }
  
  // 更新状态
  const newState = loadSyncState();
  newState.status = 'idle';
  newState.lastSyncTime = new Date().toISOString();
  newState.pendingCount = outbox.filter(r => !r.synced).length;
  saveSyncState(newState);
  
  return { success: true };
}

/**
 * 推送单个变更
 */
async function pushSingleChange(record: SyncChangeRecord): Promise<{ success: boolean; error?: string }> {
  const endpointMap: Record<SyncChangeType, string> = {
    'lens.update': '/api/lenses',
    'lens.status': '/api/lenses/status',
    'review.submit': '/api/reviews',
    'review.comment': '/api/reviews',
    'review.action': '/api/reviews',
    'pathMapping.update': '/api/path-mappings',
  };
  
  const endpoint = endpointMap[record.type];
  if (!endpoint) {
    return { success: false, error: `Unknown change type: ${record.type}` };
  }
  
  try {
    await apiClient.post(endpoint, {
      type: record.type,
      payload: record.payload,
      timestamp: record.createdAt,
    });
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Push failed' 
    };
  }
}

/**
 * 从服务端拉取增量变更
 */
export async function pullChanges(): Promise<PullChangesResponse> {
  // 检查数据源模式
  const dataSource = getDataSource();
  if (dataSource !== 'remote') {
    return { success: true, changes: [], latestSequence: 0 };
  }
  
  // 检查网络状态
  const networkStatus = getNetworkStatus();
  if (networkStatus !== 'online') {
    return { success: true, changes: [], latestSequence: getLastSequence() };
  }
  
  const lastSequence = getLastSequence();
  
  try {
    const response = await apiClient.get<{
      changes: Array<{ id: string; type: string; payload: unknown; timestamp: string }>;
      latestSequence: number;
    }>(`/api/sync/changes?since=${lastSequence}`);
    
    const changes = Array.isArray(response?.changes) ? response.changes : [];
    const latestSequence = response?.latestSequence ?? lastSequence;
    
    // 保存最新序号
    setLastSequence(latestSequence);
    
    // 更新同步状态
    const state = loadSyncState();
    state.lastSyncTime = new Date().toISOString();
    saveSyncState(state);
    
    return {
      success: true,
      changes,
      latestSequence,
    };
  } catch (error) {
    return {
      success: false,
      changes: [],
      latestSequence: lastSequence,
      error: error instanceof Error ? error.message : 'Pull failed',
    };
  }
}

/**
 * 获取同步状态
 */
export function getSyncState(): SyncState {
  const outbox = loadOutbox();
  const state = loadSyncState();
  state.pendingCount = outbox.filter(r => !r.synced).length;
  return state;
}

/**
 * 手动触发同步
 */
export async function triggerSync(): Promise<{ success: boolean; error?: string }> {
  // 先 push
  const pushResult = await pushChanges();
  if (!pushResult.success) {
    return pushResult;
  }
  
  // 再 pull
  const pullResult = await pullChanges();
  if (!pullResult.success) {
    return { success: false, error: pullResult.error };
  }
  
  return { success: true };
}

/**
 * 清除同步状态（用于调试）
 */
export function clearSyncState(): void {
  localStorage.removeItem(STORAGE_KEYS.outbox);
  localStorage.removeItem(STORAGE_KEYS.state);
  localStorage.removeItem(STORAGE_KEYS.lastSequence);
}

/**
 * 获取待同步记录数
 */
export function getPendingCount(): number {
  const outbox = loadOutbox();
  return outbox.filter(r => !r.synced).length;
}
