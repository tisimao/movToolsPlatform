import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { DEFAULT_SERVER_BASE_URL, normalizeServerBaseUrl, validateServerBaseUrl } from '../config/runtime';
import type { AuthStatus } from '../auth/store';
import type { LoginCredentials } from '../auth/types';

/**
 * 登录页面组件的属性接口
 */
interface LoginPageProps {
  /** 应用名称 */
  appName: string;
  /** API 基础URL */
  apiBaseUrl: string;
  /** 服务端基础URL */
  serverBaseUrl: string;
  /** API 状态：idle(空闲)、checking(检测中)、online(在线)、offline(离线) */
  apiStatus: 'idle' | 'checking' | 'online' | 'offline';
  /** API 消息 */
  apiMessage: string;
  /** 认证状态 */
  authStatus: AuthStatus;
  /** 认证错误信息 */
  authError: string | null;
  /** 登录回调函数 */
  onLogin: (credentials: LoginCredentials) => Promise<void>;
  /** 重试API检查的回调函数 */
  onRetryApiCheck: () => void;
  /** 保存服务端地址 */
  onServerBaseUrlSave: (value: string) => Promise<{ success: boolean; error?: string; normalized?: string }>;
  /** 恢复默认服务端地址 */
  onServerBaseUrlRestoreDefault: () => Promise<{ success: boolean; error?: string; normalized?: string }>;
}

export function LoginPage({
  appName,
  apiBaseUrl,
  serverBaseUrl,
  apiStatus,
  apiMessage,
  authStatus,
  authError,
  onLogin,
  onRetryApiCheck,
  onServerBaseUrlSave,
  onServerBaseUrlRestoreDefault,
}: LoginPageProps) {
  /**
   * 用户名输入状态和设置器
   * 存储用户输入的用户名值
   */
  const [username, setUsername] = useState('');
  /**
   * 密码输入状态和设置器
   * 存储用户输入的密码值
   */
  const [password, setPassword] = useState('');
  const [serverAddressDraft, setServerAddressDraft] = useState(serverBaseUrl);
  /**
   * 本地消息状态和设置器（用于显示登录错误等信息）
   * 用于存储登录过程中的错误或提示信息
   */
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [serverAddressMessage, setServerAddressMessage] = useState<string | null>(null);

  /**
   * 是否正在提交登录的状态
   * 当认证状态为'loading'时为true，表示登录请求正在处理中
   */
  const isSubmitting = authStatus === 'loading';
  const normalizedServerAddress = useMemo(() => normalizeServerBaseUrl(serverAddressDraft), [serverAddressDraft]);
  /**
   * API状态标签（中文）
   * 根据API状态返回对应的中文标签
   */
  const statusLabel = useMemo(() => {
    switch (apiStatus) {
      case 'checking':
        return '检测中';
      case 'online':
        return '在线';
      case 'offline':
        return '离线';
      default:
        return '未检测';
    }
  }, [apiStatus]);

    /**
     * 处理登录表单提交事件
     * 阻止表单默认提交行为以防止页面刷新，清除之前的本地错误消息，
     * 然后使用提供的用户名和密码调用onLogin回调函数进行身份验证
     * @param event - React表单提交事件对象
     */
  useEffect(() => {
    setServerAddressDraft(serverBaseUrl || DEFAULT_SERVER_BASE_URL);
  }, [serverBaseUrl]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLocalMessage(null);

      try {
        // 调用登录回调函数，传入用户名和密码进行身份验证
        await onLogin({ username, password });
      } catch {
        // 如果登录过程中发生异常（如网络错误或服务端验证失败），设置本地错误消息
        setLocalMessage('登录失败，请检查账号密码或服务端状态。');
      }
  }

  async function handleServerBaseUrlSave(): Promise<void> {
    const validation = validateServerBaseUrl(serverAddressDraft);
    if (!validation.success || !validation.normalized) {
      setServerAddressMessage(validation.error ?? '服务端地址无效。');
      return;
    }

    setServerAddressMessage('正在保存并切换服务端地址...');
    const result = await onServerBaseUrlSave(validation.normalized);
    setServerAddressMessage(result.success ? `已切换到 ${result.normalized}` : result.error ?? '保存失败。');
  }

  async function handleRestoreDefault(): Promise<void> {
    setServerAddressDraft(DEFAULT_SERVER_BASE_URL);
    setServerAddressMessage('正在恢复默认地址...');
    const result = await onServerBaseUrlRestoreDefault();
    setServerAddressMessage(result.success ? `已恢复默认地址 ${result.normalized}` : result.error ?? '恢复默认失败。');
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <p className="eyebrow">协同客户端</p>
          <h1>{appName}</h1>
          <p className="auth-copy">登录后进入协同客户端，继续使用项目、镜头和本地能力。</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {/* 用户名输入字段 */}
          <label className="auth-field">
            <span>用户名</span>
            <input
              autoComplete="username"
              disabled={isSubmitting}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入用户名"
              value={username}
            />
          </label>

          {/* 密码输入字段 */}
          <label className="auth-field">
            <span>密码</span>
            <input
              autoComplete="current-password"
              disabled={isSubmitting}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              type="password"
              value={password}
            />
          </label>

          {/* 登录按钮 */}
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? '正在登录…' : '登录'}
          </button>
        </form>

        <div className="auth-server-config panel">
          <label className="auth-field">
            <span>服务端地址</span>
            <input
              autoComplete="off"
              disabled={isSubmitting}
              onChange={(event) => setServerAddressDraft(event.target.value)}
              placeholder={DEFAULT_SERVER_BASE_URL}
              value={serverAddressDraft}
            />
          </label>
          <div className="auth-actions auth-actions--server">
            <button className="primary-button" onClick={() => void handleServerBaseUrlSave()} type="button">
              保存并检测
            </button>
            <button className="ghost-button" onClick={() => void handleRestoreDefault()} type="button">
              恢复默认
            </button>
            <button className="ghost-button" onClick={onRetryApiCheck} type="button">
              重新检测接口
            </button>
          </div>
          <p className="auth-note">当前生效地址：{normalizedServerAddress || apiBaseUrl}</p>
          {serverAddressMessage ? <div className="auth-message auth-message--info">{serverAddressMessage}</div> : null}
        </div>

        {/* API状态信息展示区域 */}
        <div className="auth-status-grid">
          <div className="status-tile">
            <strong>API 地址</strong>
            <span>{apiBaseUrl}</span>
          </div>
          <div className="status-tile">
            <strong>接口状态</strong>
            <span>{statusLabel}</span>
          </div>
        </div>

        {/* 错误消息展示区域 */}
        {(authError || localMessage || apiMessage) ? (
          <div className="auth-message" role="status">
            {authError || localMessage || apiMessage}
          </div>
        ) : null}

        {/* 支持角色说明 */}
        <p className="auth-note">支持角色：系统管理员 / 制片 / 导演 / 制作人员 / 只读查看者</p>
      </section>
    </main>
  );
}

/**
 * 登录页面组件
 * 提供用户登录界面，包括用户名密码输入、登录按钮、API状态显示等
 * @param props - LoginPage 属性对象
 */
