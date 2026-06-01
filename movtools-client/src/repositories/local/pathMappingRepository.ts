/**
 * 本地路径映射仓储
 * 
 * 本地模式使用本地存储保存路径映射。
 */
import type { IPathMappingRepository, StorageRoot, ClientPathMapping } from '../types';

const STORAGE_KEY = 'movtools.pathMappings.v1';

/** 从本地存储加载映射 */
function loadLocalMappings(): ClientPathMapping[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as ClientPathMapping[];
  } catch {
    return [];
  }
}

/** 保存到本地存储 */
function saveLocalMappings(mappings: ClientPathMapping[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
}

/** 默认的存储根（本地模式硬编码） */
const DEFAULT_STORAGE_ROOTS: StorageRoot[] = [
  {
    rootId: 'local-default',
    rootCode: 'lens-root-main',
    rootLabel: '镜头主目录',
    description: '镜头文件根目录',
    createdAt: new Date().toISOString(),
  },
  {
    rootId: 'local-layout',
    rootCode: 'layout-root-main',
    rootLabel: 'Layout 目录',
    description: 'Layout 文件根目录',
    createdAt: new Date().toISOString(),
  },
];

export const localPathMappingRepository: IPathMappingRepository = {
  async listStorageRoots(): Promise<{ success: boolean; roots: StorageRoot[]; error?: string }> {
    return {
      success: true,
      roots: DEFAULT_STORAGE_ROOTS,
    };
  },

  async getClientPathMappings(): Promise<{ success: boolean; mappings: ClientPathMapping[]; error?: string }> {
    return {
      success: true,
      mappings: loadLocalMappings(),
    };
  },

  async savePathMapping(mapping: {
    rootCode: string;
    localAbsolutePath: string;
  }): Promise<{ success: boolean; mapping?: ClientPathMapping; error?: string }> {
    const mappings = loadLocalMappings();
    const existingIndex = mappings.findIndex((m) => m.rootCode === mapping.rootCode);
    const now = new Date().toISOString();
    
    const newMapping: ClientPathMapping = {
      mappingId: existingIndex >= 0 ? mappings[existingIndex].mappingId : crypto.randomUUID(),
      clientNodeId: 'local-client',
      rootCode: mapping.rootCode,
      localAbsolutePath: mapping.localAbsolutePath,
      createdAt: existingIndex >= 0 ? mappings[existingIndex].createdAt : now,
      updatedAt: now,
    };
    
    if (existingIndex >= 0) {
      mappings[existingIndex] = newMapping;
    } else {
      mappings.push(newMapping);
    }
    
    saveLocalMappings(mappings);
    
    return {
      success: true,
      mapping: newMapping,
    };
  },

  async deletePathMapping(rootCode: string): Promise<{ success: boolean; error?: string }> {
    const mappings = loadLocalMappings().filter((m) => m.rootCode !== rootCode);
    saveLocalMappings(mappings);
    
    return {
      success: true,
    };
  },

  async resolveLogicalPath(rootCode: string, logicalPath: string): Promise<{ success: boolean; localPath?: string; error?: string }> {
    const mappings = loadLocalMappings();
    const mapping = mappings.find((m) => m.rootCode === rootCode);
    
    if (!mapping) {
      return {
        success: false,
        error: `未找到路径根 "${rootCode}" 的映射配置。请在设置中配置本机路径映射。`,
      };
    }
    
    // 组合路径：本地路径 + 逻辑路径
    const normalizedLocalPath = mapping.localAbsolutePath.replace(/[\\/]+$/, '');
    const normalizedLogicalPath = logicalPath.replace(/^[\\/]+/, '');
    const localPath = `${normalizedLocalPath}\\${normalizedLogicalPath}`.replace(/\\\\/g, '\\');
    
    return {
      success: true,
      localPath: localPath,
    };
  },
};
