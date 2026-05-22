/**
 * 认证用户接口
 */
export interface AuthUser {
  /** 用户ID */
  id: string;
  /** 用户名 */
  username: string;
  /** 显示名称 */
  displayName: string;
  /** 角色列表 */
  roles: string[];
  /** 电子邮箱（可选） */
  email?: string;
}

/**
 * 认证会话接口
 */
export interface AuthSession {
  /** 访问令牌 */
  token: string;
  /** 刷新令牌（可选） */
  refreshToken?: string;
  /** 用户信息 */
  user: AuthUser;
}

/**
 * 登录凭据接口
 */
export interface LoginCredentials {
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
}

/**
 * 登录结果接口（继承自AuthSession）
 */
export interface LoginResult extends AuthSession {}
