import { create } from 'zustand';
import { clearStoredAuthSession, loadStoredAuthSession, saveStoredAuthSession } from './session';
import { fetchCurrentUser, formatLoginError, loginWithCredentials } from './service';
import type { AuthSession, AuthUser, LoginCredentials } from './types';

/**
 * 认证状态类型
 */
export type AuthStatus = 'anonymous' | 'loading' | 'authenticated' | 'error';

/**
 * 认证状态接口
 */
interface AuthState {
  /** 认证状态 */
  status: AuthStatus;
  /** 认证令牌 */
  token: string | null;
  /** 用户信息 */
  user: AuthUser | null;
  /** 错误消息 */
  errorMessage: string | null;
  /** 引导初始化 */
  bootstrap: () => Promise<void>;
  /** 登录 */
  login: (credentials: LoginCredentials) => Promise<AuthSession>;
  /** 登出 */
  logout: () => void;
  /** 刷新当前用户 */
  refreshCurrentUser: () => Promise<void>;
  /** 清除错误 */
  clearError: () => void;
}

/**
 * 存储会话
 * @param session 要存储的会话
 */
function storeSession(session: AuthSession): void {
  saveStoredAuthSession(session);
}

/**
 * 移除会话
 */
function removeSession(): void {
  clearStoredAuthSession();
}

export const useAuthStore = create<AuthState>((set, get) => ({
  /** 初始状态：如果有token则为loading，否则为anonymous */
  status: loadStoredAuthSession()?.token ? 'loading' : 'anonymous',
  /** 初始令牌：从存储中读取 */
  token: loadStoredAuthSession()?.token ?? null,
  /** 初始用户：从存储中读取 */
  user: loadStoredAuthSession()?.user ?? null,
  /** 初始错误消息 */
  errorMessage: null,
  /**
   * 引导初始化：检查存储中的会话并尝试获取最新用户信息
   */
  bootstrap: async () => {
    const session = loadStoredAuthSession();

    if (!session?.token) {
      set({ status: 'anonymous', token: null, user: null, errorMessage: null });
      return;
    }

    set({ status: 'loading', token: session.token, user: session.user, errorMessage: null });

    try {
      const user = await fetchCurrentUser(session.token);
      const nextSession: AuthSession = { ...session, user };
      storeSession(nextSession);
      set({ status: 'authenticated', token: nextSession.token, user: nextSession.user, errorMessage: null });
    } catch (error) {
      removeSession();
      set({ status: 'anonymous', token: null, user: null, errorMessage: formatLoginError(error) });
    }
  },
  /**
   * 登录：使用凭据登录并存储会话
   * @param credentials 登录凭据
   * @returns 登录会话
   */
  login: async (credentials) => {
    set({ status: 'loading', errorMessage: null });

    try {
      const session = await loginWithCredentials(credentials);
      storeSession(session);
      set({ status: 'authenticated', token: session.token, user: session.user, errorMessage: null });
      return session;
    } catch (error) {
      removeSession();
      const message = formatLoginError(error);
      set({ status: 'error', token: null, user: null, errorMessage: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },
  /**
   * 登出：清除会话并重置状态
   */
  logout: () => {
    removeSession();
    set({ status: 'anonymous', token: null, user: null, errorMessage: null });
  },
  /**
   * 刷新当前用户：重新获取用户信息并更新会话
   */
  refreshCurrentUser: async () => {
    const { token } = get();

    if (!token) {
      set({ status: 'anonymous', user: null });
      return;
    }

    try {
      const user = await fetchCurrentUser(token);
      const nextSession: AuthSession = { token, user };
      storeSession(nextSession);
      set({ status: 'authenticated', user, errorMessage: null });
    } catch (error) {
      removeSession();
      set({ status: 'anonymous', token: null, user: null, errorMessage: formatLoginError(error) });
    }
  },
  /**
   * 清除错误消息
   */
  clearError: () => set({ errorMessage: null }),
}));
