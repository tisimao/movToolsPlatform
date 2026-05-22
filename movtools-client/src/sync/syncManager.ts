/**
 * 自动同步管理器
 * 
 * 负责：
 * - 网络状态监控
 * - 自动同步触发
 * - SignalR 事件处理与页面刷新
 */
import { 
  getNetworkStatus, 
  triggerSync, 
  getSyncState, 
  type SyncState,
  type NetworkStatus 
} from './syncService';
import { 
  connectSignalR, 
  disconnectSignalR,
  onSignalREvent,
  onSignalRStatusChange,
  type SignalREvent,
  type SignalRConnectionStatus 
} from './signalrService';

/** 页面刷新回调类型 */
type PageRefreshCallback = (eventType: string, payload: unknown) => void;

/** 自动同步管理器类 */
class SyncManager {
  private networkStatus: NetworkStatus = 'checking';
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private refreshCallbacks: PageRefreshCallback[] = [];
  private isInitialized = false;

  /**
   * 初始化同步管理器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // 初始化网络状态
    this.networkStatus = getNetworkStatus();
    
    // 监听网络状态变化
    window.addEventListener('online', this.handleNetworkOnline);
    window.addEventListener('offline', this.handleNetworkOffline);
    
    // 监听 SignalR 事件并刷新页面
    this.setupSignalREventHandlers();
    
    // 启动定时同步
    this.startPeriodicSync();
    
    this.isInitialized = true;
    
    // 尝试连接 SignalR
    if (this.networkStatus === 'online') {
      await connectSignalR();
    }
  }

  /**
   * 处理网络恢复在线
   */
  private handleNetworkOnline = (): void => {
    console.info('[SyncManager] Network online');
    this.networkStatus = 'online';
    
    // 网络恢复时触发同步
    void this.triggerSyncOnNetworkRecovery();
    
    // 尝试连接 SignalR
    void connectSignalR();
  };

  /**
   * 处理网络离线
   */
  private handleNetworkOffline = (): void => {
    console.info('[SyncManager] Network offline');
    this.networkStatus = 'offline';
    
    // 断开 SignalR 连接
    void disconnectSignalR();
  };

  /**
   * 网络恢复时触发同步
   */
  private async triggerSyncOnNetworkRecovery(): Promise<void> {
    console.info('[SyncManager] Triggering sync on network recovery');
    
    try {
      const result = await triggerSync();
      if (!result.success) {
        console.warn('[SyncManager] Sync failed on network recovery:', result.error);
      }
    } catch (error) {
      console.error('[SyncManager] Error triggering sync:', error);
    }
  }

  /**
   * 设置 SignalR 事件处理器
   */
  private setupSignalREventHandlers(): void {
    // 监听 SignalR 连接状态
    onSignalRStatusChange((status: SignalRConnectionStatus, error?: string) => {
      console.info('[SyncManager] SignalR status:', status, error || '');
      
      if (status === 'connected') {
        // SignalR 连接成功，刷新所有关键页面
        this.notifyRefresh('signalr.connected', null);
      }
    });

    // 监听项目更新
    onSignalREvent('project.updated', (event: SignalREvent) => {
      console.info('[SyncManager] Project updated, triggering refresh');
      this.notifyRefresh('project.updated', event.payload);
    });

    // 监听镜头更新
    onSignalREvent('lens.updated', (event: SignalREvent) => {
      console.info('[SyncManager] Lens updated, triggering refresh');
      this.notifyRefresh('lens.updated', event.payload);
    });

    // 监听镜头状态变更
    onSignalREvent('lens.statusChanged', (event: SignalREvent) => {
      console.info('[SyncManager] Lens status changed, triggering refresh');
      this.notifyRefresh('lens.statusChanged', event.payload);
    });

    // 监听审片创建
    onSignalREvent('review.created', (event: SignalREvent) => {
      console.info('[SyncManager] Review created, triggering refresh');
      this.notifyRefresh('review.created', event.payload);
    });

    // 监听审片更新
    onSignalREvent('review.updated', (event: SignalREvent) => {
      console.info('[SyncManager] Review updated, triggering refresh');
      this.notifyRefresh('review.updated', event.payload);
    });

    // 监听审片评论
    onSignalREvent('review.commentAdded', (event: SignalREvent) => {
      console.info('[SyncManager] Review comment added, triggering refresh');
      this.notifyRefresh('review.commentAdded', event.payload);
    });
  }

  /**
   * 启动定时同步
   */
  private startPeriodicSync(): void {
    // 每 60 秒同步一次
    this.syncInterval = setInterval(async () => {
      if (this.networkStatus === 'online') {
        try {
          await triggerSync();
        } catch (error) {
          console.error('[SyncManager] Periodic sync error:', error);
        }
      }
    }, 60000);
  }

  /**
   * 通知所有回调刷新页面
   */
  private notifyRefresh(eventType: string, payload: unknown): void {
    for (const callback of this.refreshCallbacks) {
      try {
        callback(eventType, payload);
      } catch (error) {
        console.error('[SyncManager] Refresh callback error:', error);
      }
    }
  }

  /**
   * 注册页面刷新回调
   */
  onPageRefresh(callback: PageRefreshCallback): () => void {
    this.refreshCallbacks.push(callback);
    
    // 返回取消订阅函数
    return () => {
      const index = this.refreshCallbacks.indexOf(callback);
      if (index >= 0) {
        this.refreshCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * 获取同步状态
   */
  getSyncState(): SyncState {
    return getSyncState();
  }

  /**
   * 获取网络状态
   */
  getNetworkStatusValue(): NetworkStatus {
    return this.networkStatus;
  }

  /**
   * 手动触发同步
   */
  async sync(): Promise<{ success: boolean; error?: string }> {
    return triggerSync();
  }

  /**
   * 销毁同步管理器
   */
  destroy(): void {
    // 移除网络状态监听
    window.removeEventListener('online', this.handleNetworkOnline);
    window.removeEventListener('offline', this.handleNetworkOffline);
    
    // 停止定时同步
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    
    // 断开 SignalR
    void disconnectSignalR();
    
    this.isInitialized = false;
  }
}

/**
 * 同步管理器单例
 */
export const syncManager = new SyncManager();

/**
 * 初始化同步管理器
 */
export async function initializeSyncManager(): Promise<void> {
  return syncManager.initialize();
}

/**
 * 获取同步状态
 */
export function getSyncManagerState(): SyncState {
  return syncManager.getSyncState();
}

/**
 * 获取网络状态
 */
export function getNetworkStatusValue(): NetworkStatus {
  return syncManager.getNetworkStatusValue();
}

/**
 * 手动触发同步
 */
export async function syncNow(): Promise<{ success: boolean; error?: string }> {
  return syncManager.sync();
}

/**
 * 注册页面刷新回调
 */
export function onPageRefresh(callback: PageRefreshCallback): () => void {
  return syncManager.onPageRefresh(callback);
}

/**
 * 销毁同步管理器
 */
export function destroySyncManager(): void {
  syncManager.destroy();
}
