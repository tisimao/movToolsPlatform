import type { AuthSession } from './types';

/** 存储键名 */
const STORAGE_KEY = 'movtools.auth.session.v1';

/**
 * 检查是否可以使用本地存储
 * @returns 是否可以使用本地存储
 */
function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * 从本地存储加载身份验证会话
 * @returns 身份验证会话对象（如果不存在则返回null）
 */
export function loadStoredAuthSession(): AuthSession | null {
  if (!canUseStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.token || !parsed?.user) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * 保存身份验证会话到本地存储
 * @param session 要保存的身份验证会话对象
 */
export function saveStoredAuthSession(session: AuthSession): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

/**
 * 清除本地存储中的身份验证会话
 */
export function clearStoredAuthSession(): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}
