import { getRuntimeConfig } from '../config/runtime';
import { ApiError } from './errors';

/**
 * 请求选项接口，扩展原生 RequestInit
 */
export interface RequestOptions extends RequestInit {
  /** 是否跳过身份验证 */
  skipAuth?: boolean;
}

/**
 * API客户端配置接口
 */
interface ApiClientConfig {
  /** 基础URL */
  baseUrl: string;
  /** 获取认证令牌的函数 */
  getToken: () => string | null;
}

/**
 * 拼接基础URL和路径
 * @param baseUrl 基础URL
 * @param path 路径
 * @returns 拼接后的完整URL
 */
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * 读取并解析响应体
 * @param response HTTP响应对象
 * @returns 解析后的数据（JSON对象或文本）
 */
async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * 从响应载荷中提取错误消息
 * @param payload 响应载荷
 * @param fallback 默认错误消息
 * @returns 错误消息
 */
function extractMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.message, record.error, record.msg, record.title];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return fallback;
}

/**
 * API客户端类，封装HTTP请求和身份验证逻辑
 */
export class ApiClient {
  /** 基础URL */
  private baseUrl: string;
  /** 获取认证令牌的函数 */
  private readonly getToken: () => string | null;

  /**
   * 创建API客户端实例
   * @param config 客户端配置
   */
  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.getToken = config.getToken;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * 发送HTTP请求（核心方法）
   * @param path 请求路径
   * @param options 请求选项
   * @returns 请求结果
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { skipAuth, headers, ...init } = options;
    const requestHeaders = new Headers(headers);

    if (!requestHeaders.has('Accept')) {
      requestHeaders.set('Accept', 'application/json');
    }

    if (init.body && !requestHeaders.has('Content-Type') && !(init.body instanceof FormData)) {
      requestHeaders.set('Content-Type', 'application/json');
    }

    if (!skipAuth) {
      const token = this.getToken();
      if (token) {
        requestHeaders.set('Authorization', `Bearer ${token}`);
      }
    }

    let response: Response;
    try {
      response = await fetch(joinUrl(this.baseUrl, path), {
        ...init,
        headers: requestHeaders,
      });
    } catch (error) {
      throw new ApiError('无法连接到服务端，请检查 API 地址或服务端状态。', 0, {
        details: error,
      });
    }

    const payload = await readResponseBody(response);

    if (!response.ok) {
      throw new ApiError(extractMessage(payload, `请求失败（HTTP ${response.status}）`), response.status, {
        code: typeof payload === 'object' && payload ? String((payload as Record<string, unknown>).code ?? '') || undefined : undefined,
        details: payload,
        traceId: typeof payload === 'object' && payload ? String((payload as Record<string, unknown>).traceId ?? '') || undefined : undefined,
      });
    }

    return payload as T;
  }

  /**
   * 发送GET请求
   * @param path 请求路径
   * @param options 请求选项
   * @returns 请求结果
   */
  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'GET',
    });
  }

  /**
   * 发送POST请求
   * @param path 请求路径
   * @param body 请求体
   * @param options 请求选项
   * @returns 请求结果
   */
  post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /**
   * 发送健康检查请求（跳过身份验证）
   * @param path 请求路径，默认为运行时配置中的健康检查路径
   * @returns 请求结果
   */
  healthCheck<T = unknown>(path = getRuntimeConfig().healthPath): Promise<T> {
    return this.get<T>(path, { skipAuth: true });
  }
}

const runtimeConfig = getRuntimeConfig();

/**
 * 默认API客户端实例
 */
export const apiClient = new ApiClient({
  baseUrl: runtimeConfig.apiBaseUrl,
  getToken: () => {
    try {
      const storageValue = window.localStorage.getItem('movtools.auth.session.v1');
      if (!storageValue) {
        return null;
      }

      const parsed = JSON.parse(storageValue) as { token?: string };
      return typeof parsed.token === 'string' && parsed.token.trim() ? parsed.token : null;
    } catch {
      return null;
    }
  },
});

/**
 * 创建API客户端实例的工厂函数
 * @param getToken 获取认证令牌的函数
 * @returns API客户端实例
 */
export function createApiClient(getToken: () => string | null): ApiClient {
  return new ApiClient({
    baseUrl: runtimeConfig.apiBaseUrl,
    getToken,
  });
}

export function updateApiClientBaseUrl(baseUrl: string): void {
  apiClient.setBaseUrl(baseUrl);
}
