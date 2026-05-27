import type { AuthUser } from './types';

/**
 * 应用角色类型
 */
export type AppRole = 'system-admin' | 'producer' | 'director' | 'maker' | 'viewer' | string;

/**
 * 导航项接口
 */
export interface NavigationItem {
  /** 导航项ID */
  id: 'dashboard' | 'projects' | 'file-check' | 'extract' | 'lens' | 'home' | 'logs' | 'settings' | 'review' | 'users' | 'producer-review';
  /** 显示标签 */
  label: string;
  /** 描述信息 */
  description: string;
  /** 允许访问的角色列表 */
  allowedRoles: AppRole[];
}

/**
 * 角色中文标签映射
 */
const roleLabelMap: Record<string, string> = {
  'system-admin': '系统管理员',
  admin: '系统管理员',
  producer: '制片',
  director: '导演',
  maker: '制作人员',
  viewer: '只读查看者',
};

/**
 * 导航项配置列表
 */
export const navigationItems: NavigationItem[] = [
  { id: 'dashboard', label: '仪表盘', description: '查看可访问项目、当前激活项目与工作概览。', allowedRoles: ['system-admin', 'admin', 'producer', 'director', 'maker', 'viewer'] },
  { id: 'projects', label: '项目', description: '管理本地项目与数据库底座。', allowedRoles: ['system-admin', 'producer', 'maker'] },
  { id: 'file-check', label: '文件检查', description: '配置路径、筛查缺失并绑定文件。', allowedRoles: ['system-admin', 'producer', 'maker'] },
  { id: 'extract', label: '提取', description: '确认列表后直接提取当前已绑定文件。', allowedRoles: ['system-admin', 'producer', 'maker'] },
  { id: 'lens', label: '镜头', description: '按镜头查询状态、版本与反馈回看。', allowedRoles: ['system-admin', 'producer', 'director', 'maker'] },
  { id: 'review', label: '审片', description: '导演审片主工作区。', allowedRoles: ['system-admin', 'director'] },
  { id: 'producer-review', label: '审片任务', description: '制片任务装配台：创建、编辑、提交审片任务。', allowedRoles: ['system-admin', 'producer'] },
  { id: 'home', label: '工作台', description: '按顺序拼接已完成镜头的 mov。', allowedRoles: ['system-admin', 'producer', 'viewer'] },
  { id: 'logs', label: '日志', description: '查看每个任务的运行输出。', allowedRoles: ['system-admin', 'producer', 'maker', 'viewer'] },
  { id: 'settings', label: '设置', description: '配置 FFmpeg 路径和默认选项。', allowedRoles: ['system-admin', 'producer', 'maker', 'viewer'] },
  { id: 'users', label: '用户', description: '用户与权限管理。', allowedRoles: ['admin', 'system-admin'] },
];

/**
 * 标准化角色名称（转小写并去除首尾空格）
 * @param value 角色名称
 * @returns 标准化后的角色名称
 */
function normalizeRole(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 获取用户的主要角色
 * @param user 用户对象（可能为null）
 * @returns 主要角色（如果没有角色则返回'viewer'）
 */
export function getPrimaryRole(user: AuthUser | null): string {
  const firstRole = user?.roles?.[0];
  return normalizeRole(firstRole ?? 'viewer');
}

/**
 * 根据角色获取对应的中文标签
 * @param role 角色名称（可能为null或undefined）
 * @returns 角色的中文标签
 */
export function getRoleLabel(role: string | null | undefined): string {
  const normalized = normalizeRole(role ?? 'viewer');
  return roleLabelMap[normalized] ?? role ?? '只读查看者';
}

/**
 * 格式化角色列表为中文显示
 */
export function formatRoleList(roles: Array<string | null | undefined>): string {
  const labels = roles.map((item) => getRoleLabel(item)).filter(Boolean);
  return labels.length > 0 ? labels.join(' · ') : '只读查看者';
}

/**
 * 检查用户是否可以访问指定的导航项
 * @param user 用户对象（可能为null）
 * @param item 导航项
 * @returns 是否可以访问
 */
export function canAccessNavigation(user: AuthUser | null, item: NavigationItem): boolean {
  const role = getPrimaryRole(user);
  if (item.allowedRoles.includes(role)) {
    return true;
  }

  // 系统管理员和admin可以访问所有导航项
  if (role === 'system-admin' || role === 'admin') {
    return true;
  }

  return false;
}

/**
 * 获取用户可见的导航项列表
 * @param user 用户对象（可能为null）
 * @returns 用户可见的导航项数组
 */
export function getVisibleNavigationItems(user: AuthUser | null): NavigationItem[] {
  return navigationItems.filter((item) => canAccessNavigation(user, item));
}

/**
 * 制作人员是否允许使用本机文件检查能力
 * 说明：该能力属于本地扫描/预览辅助，不等同于协同写权限。
 */
export function canUseLocalFileChecks(user: AuthUser | null): boolean {
  const role = getPrimaryRole(user);
  return role === 'maker' || role === 'producer' || role === 'director' || role === 'admin' || role === 'system-admin';
}
