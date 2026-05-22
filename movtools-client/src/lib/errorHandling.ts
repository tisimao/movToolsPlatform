/**
 * 错误处理与日志服务
 * 
 * 提供：
 * - 统一错误处理与提示
 * - 用户可读的错误消息
 * - 调试日志记录
 * - 错误上报机制
 */

/** 错误级别 */
export type ErrorLevel = 'info' | 'warning' | 'error' | 'critical';

/** 错误分类 */
export type ErrorCategory = 
  | 'network' 
  | 'auth' 
  | 'permission' 
  | 'sync' 
  | 'validation' 
  | 'unknown';

/** 错误记录 */
export interface ErrorLog {
  id: string;
  timestamp: string;
  level: ErrorLevel;
  category: ErrorCategory;
  message: string;
  details?: unknown;
  stack?: string;
  userMessage?: string;
}

/** 本地错误日志存储键 */
const ERROR_LOG_KEY = 'movtools.errorLogs.v1';
const MAX_LOCAL_LOGS = 100;

/**
 * 获取错误分类
 */
export function categorizeError(error: unknown): ErrorCategory {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  
  // 网络错误
  if (
    lowerMessage.includes('network') ||
    lowerMessage.includes('fetch') ||
    lowerMessage.includes('connection') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('offline') ||
    lowerMessage.includes('api')
  ) {
    return 'network';
  }
  
  // 认证错误
  if (
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('401') ||
    lowerMessage.includes('token') ||
    lowerMessage.includes('login')
  ) {
    return 'auth';
  }
  
  // 权限错误
  if (
    lowerMessage.includes('forbidden') ||
    lowerMessage.includes('403') ||
    lowerMessage.includes('permission') ||
    lowerMessage.includes('denied')
  ) {
    return 'permission';
  }
  
  // 同步错误
  if (
    lowerMessage.includes('sync') ||
    lowerMessage.includes('outbox') ||
    lowerMessage.includes('conflict')
  ) {
    return 'sync';
  }
  
  // 验证错误
  if (
    lowerMessage.includes('validation') ||
    lowerMessage.includes('invalid') ||
    lowerMessage.includes('required')
  ) {
    return 'validation';
  }
  
  return 'unknown';
}

/**
 * 获取用户友好的错误消息
 */
export function getUserFriendlyErrorMessage(error: unknown, category: ErrorCategory): string {
  const message = error instanceof Error ? error.message : String(error);
  
  switch (category) {
    case 'network':
      if (message.includes('offline') || message.includes('network')) {
        return '网络已断开。部分功能可能无法使用，请检查网络连接。';
      }
      if (message.includes('timeout')) {
        return '请求超时，请稍后重试。';
      }
      return '网络请求失败，请检查网络连接后重试。';
    
    case 'auth':
      if (message.includes('token') || message.includes('401')) {
        return '登录已过期，请重新登录。';
      }
      if (message.includes('login')) {
        return '登录失败，请检查用户名和密码。';
      }
      return '认证失败，请重新登录。';
    
    case 'permission':
      return '您没有权限执行此操作。';
    
    case 'sync':
      if (message.includes('conflict')) {
        return '数据已更新，请刷新页面后重试。';
      }
      if (message.includes('outbox')) {
        return '操作已缓存，将在网络恢复后同步。';
      }
      return '同步失败，已缓存操作。';
    
    case 'validation':
      return message;
    
    default:
      if (message.includes('404') || message.includes('not found')) {
        return '请求的资源不存在。';
      }
      if (message.includes('500') || message.includes('server')) {
        return '服务端错误，请稍后重试。';
      }
      return '操作失败，请稍后重试。';
  }
}

/**
 * 记录错误日志
 */
export function logError(
  error: unknown,
  level: ErrorLevel = 'error',
  details?: unknown
): ErrorLog {
  const category = categorizeError(error);
  const userMessage = getUserFriendlyErrorMessage(error, category);
  
  const logEntry: ErrorLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    category,
    message: error instanceof Error ? error.message : String(error),
    details,
    stack: error instanceof Error ? error.stack : undefined,
    userMessage,
  };
  
  // 控制台输出
  switch (level) {
    case 'info':
      console.info('[Error]', logEntry);
      break;
    case 'warning':
      console.warn('[Error]', logEntry);
      break;
    case 'error':
    case 'critical':
    default:
      console.error('[Error]', logEntry);
  }
  
  // 保存到本地存储
  saveErrorLog(logEntry);
  
  return logEntry;
}

/**
 * 保存错误日志到本地存储
 */
function saveErrorLog(log: ErrorLog): void {
  try {
    const existing = getErrorLogs();
    const logs = [log, ...existing].slice(0, MAX_LOCAL_LOGS);
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(logs));
  } catch {
    // 忽略存储错误
  }
}

/**
 * 获取本地错误日志
 */
export function getErrorLogs(): ErrorLog[] {
  try {
    const stored = localStorage.getItem(ERROR_LOG_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as ErrorLog[];
  } catch {
    return [];
  }
}

/**
 * 清除错误日志
 */
export function clearErrorLogs(): void {
  localStorage.removeItem(ERROR_LOG_KEY);
}

/**
 * 获取错误统计
 */
export function getErrorStats(): Record<ErrorCategory, number> {
  const logs = getErrorLogs();
  const stats: Record<ErrorCategory, number> = {
    network: 0,
    auth: 0,
    permission: 0,
    sync: 0,
    validation: 0,
    unknown: 0,
  };
  
  for (const log of logs) {
    stats[log.category]++;
  }
  
  return stats;
}

/**
 * 显示错误提示
 */
export function showErrorNotification(error: unknown): void {
  const category = categorizeError(error);
  const userMessage = getUserFriendlyErrorMessage(error, category);
  
  // 使用 alert 显示错误（后续可以替换为 Toast 组件）
  window.alert(userMessage);
}

/**
 * 处理 API 错误
 */
export function handleApiError(error: unknown): { 
  handled: boolean; 
  userMessage: string; 
  category: ErrorCategory 
} {
  const category = categorizeError(error);
  const userMessage = getUserFriendlyErrorMessage(error, category);
  
  // 记录错误日志
  logError(error, 'error', { category });
  
  return {
    handled: true,
    userMessage,
    category,
  };
}

/**
 * 处理 Promise 错误（用于 .catch()）
 */
export function handlePromiseError(error: unknown): void {
  logError(error, 'error');
}

/**
 * 记录信息日志
 */
export function logInfo(message: string, details?: unknown): void {
  console.info('[Info]', message, details);
  
  const logEntry: ErrorLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level: 'info',
    category: 'unknown',
    message,
    details,
  };
  
  saveErrorLog(logEntry);
}

/**
 * 记录警告日志
 */
export function logWarning(message: string, details?: unknown): void {
  console.warn('[Warning]', message, details);
  
  const logEntry: ErrorLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level: 'warning',
    category: 'unknown',
    message,
    details,
  };
  
  saveErrorLog(logEntry);
}
