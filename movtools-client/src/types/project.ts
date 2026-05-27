/**
 * 项目与集类型定义
 * 
 * 用于描述项目（剧项目）和集（镜头表）的结构和状态。
 */

import type { ScanRootConfigItem } from './fileCheck';

/** 项目成员摘要 */
export interface ProjectMemberSummary {
  userId: string;
  userName: string;
  displayName: string;
  projectRoleCode: string;
  isActive: boolean;
}

/** 集（镜头表）摘要信息 */
export interface EpisodeSummary {
  episodeId: string;          // 集 ID
  projectId: string;          // 所属项目 ID
  episodeCode: string;        // 集编号（如 EP01）
  episodeName: string;        // 集名称
  lensFolderRootPath?: string; // 镜头文件根目录
  layoutCheckPath?: string;   // Layout 检查路径
  versionTag?: string;        // 版本文件字段（当前集统一）
  layoutTag?: string;         // Layout 文件字段（当前集统一）
  initExcelPath?: string;     // 初始化 Excel 路径
  lensRoots?: ScanRootConfigItem[];
  layoutRoots?: ScanRootConfigItem[];
  createdAt: string;          // 创建时间
  updatedAt: string;          // 更新时间
}

/** 项目摘要信息 */
export interface ProjectSummary {
  projectId: string;           // 项目 ID
  projectName: string;        // 项目名称
  projectRootPath: string;    // 项目根目录
  projectDefaultFps?: number; // 项目默认帧率
  databasePath: string;       // SQLite 数据库路径
  backupDir: string;          // 备份目录
  versionTag?: string;        // 项目统一版本字段
  layoutTag?: string;         // 项目统一 Layout 字段
  lensFolderRootPath?: string; // 镜头文件根目录
  maCheckPath?: string;      // ma 文件检查路径
  movCheckPath?: string;     // mov 文件检查路径
  layoutCheckPath?: string;   // layout 检查路径
  lensRoots?: ScanRootConfigItem[];
  layoutRoots?: ScanRootConfigItem[];
  createdAt: string;          // 创建时间
  updatedAt: string;          // 更新时间
  lastOpenedAt?: string;      // 最近打开时间
}

/** 项目工作空间状态 */
export interface ProjectWorkspace {
  projects: ProjectSummary[]; // 所有项目列表
  activeProjectId: string | null;  // 当前激活的项目 ID
  activeEpisodeId: string | null; // 当前激活的集 ID
}
