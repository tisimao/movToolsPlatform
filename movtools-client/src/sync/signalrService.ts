/**
 * SignalR 实时通信服务
 * 
 * 实现：
 * - SignalR Hub 连接管理
 * - 事件订阅与分发
 * - 断线自动重连
 * - 连接状态监控
 */
import type { HubConnection } from '@microsoft/signalr';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { getRuntimeConfig } from '../config/runtime';

/** SignalR 事件类型 */
export type SignalREventType = 
  | 'project.updated'
  | 'lens.updated'
  | 'lens.statusChanged'
  | 'review.created'
  | 'review.updated'
  | 'review.commentAdded'
  | 'member.updated';

/** SignalR 事件载荷 */
export interface SignalREvent<T = unknown> {
  type: SignalREventType;
  payload: T;
  timestamp: string;
}

/** SignalR 连接状态 */
export type SignalRConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** SignalR 事件处理器 */
type SignalREventHandler = (event: SignalREvent) => void;

/** 连接状态变化处理器 */
type ConnectionStatusHandler = (status: SignalRConnectionStatus, error?: string) => void;

const SIGNALR_STATE_KEY = 'movtools.signalr.state.v1';

/**
 * SignalR 服务类
 * 
 * 使用 @microsoft/signalr 实现客户端连接
 */
class SignalRService {
  private connection: HubConnection | null = null;
  private eventHandlers: Map<SignalREventType, SignalREventHandler[]> = new Map();
  private statusHandlers: ConnectionStatusHandler[] = [];
  private connectionStatus: SignalRConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * 初始化 SignalR 连接
   */
  async connect(): Promise<{ success: boolean; error?: string }> {
    const runtimeConfig = getRuntimeConfig();
    const hubUrl = runtimeConfig.signalRHubUrl;
    
    if (!hubUrl) {
      // SignalR 未配置，跳过连接
      console.info('[SignalR] Hub URL not configured, skipping connection');
      return { success: true };
    }
    
    try {
      if (this.connection) {
        await this.disconnect();
      }

      this.setStatus('connecting');
      
      const connection = new HubConnectionBuilder()
        .withUrl(hubUrl, {
          accessTokenFactory: () => {
            const storageValue = localStorage.getItem('movtools.auth.session.v1');
            if (!storageValue) return '';
            try {
              const parsed = JSON.parse(storageValue);
              return parsed.token || '';
            } catch {
              return '';
            }
          },
        })
        .withAutomaticReconnect([0, 1000, 3000, 5000, 10000])
        .configureLogging(LogLevel.Warning)
        .build();
      
      // 注册事件处理器
      this.registerEventHandlers(connection);
      
      // 监听连接状态变化
      connection.onreconnecting(() => {
        this.setStatus('reconnecting');
      });
      
      connection.onreconnected((connectionId?: string) => {
        console.info('[SignalR] Reconnected:', connectionId);
        this.setStatus('connected');
        this.reconnectAttempts = 0;
      });
      
      connection.onclose((error?: Error) => {
        if (error) {
          console.error('[SignalR] Connection closed with error:', error);
          this.setStatus('error', error.message);
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
        }
      });
      
      // 启动连接
      await connection.start();
      
      this.connection = connection;
      this.setStatus('connected');
      this.reconnectAttempts = 0;
      
      // 启动心跳
      this.startHeartbeat(connection);
      
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SignalR connection failed';
      console.error('[SignalR] Connection error:', message);
      this.setStatus('error', message);
      this.scheduleReconnect();
      return { success: false, error: message };
    }
  }

  /**
   * 注册事件处理器
   */
  private registerEventHandlers(connection: HubConnection): void {
    // 项目更新事件
    connection.on('projectUpdated', (payload: unknown) => {
      this.emit('project.updated', payload);
    });
    
    // 镜头更新事件
    connection.on('lensUpdated', (payload: unknown) => {
      this.emit('lens.updated', payload);
    });
    
    // 镜头状态变更事件
    connection.on('lensStatusChanged', (payload: unknown) => {
      this.emit('lens.statusChanged', payload);
    });
    
    // 审片创建事件
    connection.on('reviewCreated', (payload: unknown) => {
      this.emit('review.created', payload);
    });
    
    // 审片更新事件
    connection.on('reviewUpdated', (payload: unknown) => {
      this.emit('review.updated', payload);
    });
    
    // 审片评论事件
    connection.on('reviewCommentAdded', (payload: unknown) => {
      this.emit('review.commentAdded', payload);
    });
    
    // 成员更新事件
    connection.on('memberUpdated', (payload: unknown) => {
      this.emit('member.updated', payload);
    });
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(connection: HubConnection): void {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(async () => {
      if (connection.state === 'Connected') {
        try {
          await connection.invoke('ping');
        } catch {
          // 忽略心跳错误
        }
      }
    }, 30000);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[SignalR] Max reconnect attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.info(`[SignalR] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => {
      if (this.connectionStatus !== 'connected') {
        void this.connect();
      }
    }, delay);
  }

  /**
   * 断开 SignalR 连接
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    
    if (this.connection) {
      try {
        await this.connection.stop();
      } catch {
        // 忽略停止错误
      }
      this.connection = null;
    }
    
    this.setStatus('disconnected');
  }

  /**
   * 订阅事件
   */
  on(eventType: SignalREventType, handler: SignalREventHandler): () => void {
    const handlers = this.eventHandlers.get(eventType) || [];
    handlers.push(handler);
    this.eventHandlers.set(eventType, handlers);
    
    // 返回取消订阅函数
    return () => {
      const currentHandlers = this.eventHandlers.get(eventType) || [];
      const index = currentHandlers.indexOf(handler);
      if (index >= 0) {
        currentHandlers.splice(index, 1);
        this.eventHandlers.set(eventType, currentHandlers);
      }
    };
  }

  /**
   * 订阅连接状态变化
   */
  onStatusChange(handler: ConnectionStatusHandler): () => void {
    this.statusHandlers.push(handler);
    
    // 立即调用一次当前状态
    handler(this.connectionStatus);
    
    // 返回取消订阅函数
    return () => {
      const index = this.statusHandlers.indexOf(handler);
      if (index >= 0) {
        this.statusHandlers.splice(index, 1);
      }
    };
  }

  /**
   * 获取连接状态
   */
  getStatus(): SignalRConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * 触发事件
   */
  private emit(type: SignalREventType, payload: unknown): void {
    const event: SignalREvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    
    const handlers = this.eventHandlers.get(type) || [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error(`[SignalR] Event handler error for ${type}:`, error);
      }
    }
  }

  /**
   * 设置连接状态
   */
  private setStatus(status: SignalRConnectionStatus, error?: string): void {
    this.connectionStatus = status;
    
    // 保存到本地存储
    try {
      localStorage.setItem(SIGNALR_STATE_KEY, JSON.stringify({
        status,
        error,
        timestamp: new Date().toISOString(),
      }));
    } catch {
      // 忽略存储错误
    }
    
    // 通知状态处理器
    for (const handler of this.statusHandlers) {
      try {
        handler(status, error);
      } catch (error) {
        console.error('[SignalR] Status handler error:', error);
      }
    }
  }
}

/**
 * SignalR 服务单例
 */
export const signalrService = new SignalRService();

/**
 * 获取 SignalR 连接状态
 */
export function getSignalRStatus(): SignalRConnectionStatus {
  return signalrService.getStatus();
}

/**
 * 连接 SignalR Hub
 */
export async function connectSignalR(): Promise<{ success: boolean; error?: string }> {
  return signalrService.connect();
}

/**
 * 断开 SignalR Hub
 */
export async function disconnectSignalR(): Promise<void> {
  return signalrService.disconnect();
}

/**
 * 订阅 SignalR 事件
 */
export function onSignalREvent(type: SignalREventType, handler: SignalREventHandler): () => void {
  return signalrService.on(type, handler);
}

/**
 * 订阅 SignalR 状态变化
 */
export function onSignalRStatusChange(handler: ConnectionStatusHandler): () => void {
  return signalrService.onStatusChange(handler);
}
