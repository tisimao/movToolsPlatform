import { apiClient } from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { getRuntimeConfig } from '../config/runtime';
import type { AuthSession, AuthUser, LoginCredentials, LoginResult } from './types';

/**
 * 将值转换为字符串（去除首尾空格），如果无效则返回回退值
 * @param value 要转换的值
 * @param fallback 回退值，默认为空字符串
 * @returns 转换后的字符串
 */
function toStringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return fallback;
}

/**
 * 将值转换为非空字符串数组
 * @param value 要转换的值
 * @returns 非空字符串数组
 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => toStringValue(item)).filter((item) => item.length > 0);
}

/**
 * 标准化用户数据
 * @param raw 原始用户数据
 * @returns 标准化的AuthUser对象
 */
function normalizeUser(raw: unknown): AuthUser {
  if (!raw || typeof raw !== 'object') {
    return {
      id: 'unknown',
      username: 'unknown',
      displayName: '未知用户',
      roles: ['viewer'],
    };
  }

  const record = raw as Record<string, unknown>;
  const roles = toStringArray(record.roles ?? record.roleNames ?? record.permissions ?? record.role)
    .map((role) => role.toLowerCase());
  const username = toStringValue(record.username ?? record.account ?? record.loginName ?? record.name, 'unknown');
  const displayName = toStringValue(record.displayName ?? record.realName ?? record.nickName ?? record.fullName, username);

  return {
    id: toStringValue(record.id ?? record.userId ?? record.sub ?? username, username),
    username,
    displayName,
    roles: roles.length > 0 ? roles : ['viewer'],
    email: toStringValue(record.email, ''),
  };
}

/**
 * 标准化会话数据
 * @param raw 原始会话数据
 * @param fallbackUser 回退用户对象（可选）
 * @returns 标准化的AuthSession对象
 */
function normalizeSession(raw: unknown, fallbackUser?: AuthUser): AuthSession {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const token = toStringValue(record.token ?? record.accessToken ?? record.jwt ?? record.data, '');
  const refreshToken = toStringValue(record.refreshToken ?? record.refresh_token, '');
  const nestedData = record.data;
  const nestedUser = nestedData && typeof nestedData === 'object' ? (nestedData as Record<string, unknown>).user : null;
  const user = normalizeUser(record.user ?? record.currentUser ?? record.profile ?? fallbackUser ?? nestedUser ?? null);

  if (!token) {
    throw new Error('登录响应中未返回 token。');
  }

  return {
    token,
    refreshToken: refreshToken || undefined,
    user,
  };
}

/**
 * 使用凭据登录
 * @param credentials 登录凭据
 * @returns 登录结果（包含会话和用户信息）
 */
export async function loginWithCredentials(credentials: LoginCredentials): Promise<LoginResult> {
  const config = getRuntimeConfig();
  const response = await apiClient.post<unknown>(config.loginPath, credentials, { skipAuth: true });
  const session = normalizeSession(response);

  // 如果用户信息不完整，则获取当前用户详情
  if (session.user.id === 'unknown' || session.user.username === 'unknown' || session.user.displayName === '未知用户') {
    const user = await fetchCurrentUser(session.token);
    return { ...session, user };
  }

  return session;
}

/**
 * 获取当前用户信息
 * @param token 认证令牌（可选，如果不提供则跳过身份验证）
 * @returns 当前用户信息
 */
export async function fetchCurrentUser(token?: string): Promise<AuthUser> {
  const config = getRuntimeConfig();
  const response = await apiClient.get<unknown>(config.currentUserPath, {
    skipAuth: !token,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (response && typeof response === 'object') {
    const record = response as Record<string, unknown>;
    return normalizeUser(record.user ?? record.currentUser ?? record.data ?? record);
  }

  return normalizeUser(response);
}

/**
 * 格式化登录错误消息
 * @param error 错误对象
 * @returns 格式化后的错误消息
 */
export function formatLoginError(error: unknown): string {
  return getApiErrorMessage(error, '登录失败，请检查账号密码或服务端状态。');
}
