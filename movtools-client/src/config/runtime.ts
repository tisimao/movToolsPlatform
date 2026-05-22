import { DEFAULT_SERVER_BASE_URL, normalizeServerBaseUrl, validateServerBaseUrl } from './serverBaseUrl';
export { DEFAULT_SERVER_BASE_URL, normalizeServerBaseUrl, validateServerBaseUrl } from './serverBaseUrl';

/**
 * 运行时配置接口
 */
export interface RuntimeConfig {
  /** 应用名称 */
  appName: string;
  /** 服务端基础URL */
  serverBaseUrl: string;
  /** API基础URL */
  apiBaseUrl: string;
  /** 健康检查路径 */
  healthPath: string;
  /** 登录路径 */
  loginPath: string;
  /** 获取当前用户路径 */
  currentUserPath: string;
  /** SignalR Hub URL（可选） */
  signalRHubUrl?: string;
}

let runtimeServerBaseUrl = normalizeServerBaseUrl(
  import.meta.env.VITE_SERVER_BASE_URL?.trim()
    || import.meta.env.VITE_API_BASE_URL?.trim()
    || DEFAULT_SERVER_BASE_URL,
);

/**
 * 获取当前运行时服务端地址
 */
export function getRuntimeServerBaseUrl(): string {
  return runtimeServerBaseUrl;
}

/**
 * 设置当前运行时服务端地址
 */
export function setRuntimeServerBaseUrl(value: string): string {
  const validation = validateServerBaseUrl(value);
  if (!validation.success || !validation.normalized) {
    throw new Error(validation.error ?? '服务端地址无效。');
  }

  runtimeServerBaseUrl = validation.normalized;
  return runtimeServerBaseUrl;
}

export function resetRuntimeServerBaseUrl(): string {
  runtimeServerBaseUrl = normalizeServerBaseUrl(DEFAULT_SERVER_BASE_URL);
  return runtimeServerBaseUrl;
}

function buildSignalrHubUrl(serverBaseUrl: string): string {
  const url = new URL(serverBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/hubs/movtools`;
  return url.toString().replace(/\/+$/, '');
}

/**
 * 标准化路径（确保以斜杠开头）
 * @param value 原始路径
 * @returns 标准化后的路径
 */
function normalizePath(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * 获取运行时配置
 * 从环境变量中读取配置，提供默认值
 * @returns 运行时配置对象
 */
export function getRuntimeConfig(): RuntimeConfig {
  const env = import.meta.env;
  const serverBaseUrl = runtimeServerBaseUrl;
  const signalRHubUrl = env.VITE_SIGNALR_HUB_URL?.trim()
    ? env.VITE_SIGNALR_HUB_URL.trim()
    : buildSignalrHubUrl(serverBaseUrl);

  return {
    appName: env.VITE_APP_NAME?.trim() || 'Movtools Client',
    serverBaseUrl,
    apiBaseUrl: serverBaseUrl,
    healthPath: normalizePath(env.VITE_API_HEALTH_PATH || '/health'),
    loginPath: normalizePath(env.VITE_API_LOGIN_PATH || '/auth/login'),
    currentUserPath: normalizePath(env.VITE_API_ME_PATH || '/auth/me'),
    signalRHubUrl,
  };
}
