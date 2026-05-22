/**
 * 远程路径映射仓储
 * 
 * 从服务端获取存储根，保存到服务端并同步本地缓存。
 */
import type { IPathMappingRepository, StorageRoot, ClientPathMapping, ClientNode } from '../types';
import { apiClient } from '../../api/client';

const STORAGE_KEY = 'movtools.pathMappings.v1';
const CLIENT_NODE_KEY = 'movtools.clientNodeId.v1';

/** 从本地存储获取客户端节点ID */
function getStoredClientNodeId(): string | null {
  return localStorage.getItem(CLIENT_NODE_KEY);
}

/** 存储客户端节点ID */
function storeClientNodeId(clientNodeId: string): void {
  localStorage.setItem(CLIENT_NODE_KEY, clientNodeId);
}

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

/** 确保获取客户端节点ID（注册或获取已存在的） */
async function getOrCreateClientNodeId(): Promise<string | null> {
  // 1. 先检查本地是否已有 clientNodeId
  let clientNodeId = getStoredClientNodeId();
  
  if (clientNodeId) {
    // 验证节点是否仍然有效
    try {
      await apiClient.get<ClientNode>(`/api/path-mappings/client-nodes/${clientNodeId}`);
      return clientNodeId;
    } catch {
      // 节点不存在，需要重新注册
      localStorage.removeItem(CLIENT_NODE_KEY);
    }
  }
  
  // 2. 注册新的客户端节点
  try {
    const platform = typeof window !== 'undefined' ? window.navigator?.platform || 'unknown' : 'unknown';
    const clientId = `client-${crypto.randomUUID().substring(0, 8)}`;
    const response = await apiClient.post<ClientNode>('/api/path-mappings/client-nodes', {
      clientId,
      clientName: 'MovTools Client',
      machineName: platform,
    });
    
    if (response && response.id) {
      storeClientNodeId(response.id);
      return response.id;
    }
  } catch (error) {
    console.error('Failed to register client node:', error);
  }
  
  return null;
}

export const remotePathMappingRepository: IPathMappingRepository = {
  async listStorageRoots(): Promise<{ success: boolean; roots: StorageRoot[]; error?: string }> {
    try {
      // 服务端路由: GET /api/path-mappings/storage-roots
      const response = await apiClient.get<StorageRootResponse[]>('/api/path-mappings/storage-roots');
      const roots = Array.isArray(response) ? response : [];
      
      return {
        success: true,
        roots: roots.map((r) => ({
          rootId: r.id,
          rootCode: r.code,
          rootLabel: r.name,
          description: r.description,
          createdAt: r.createdAtUtc?.toString() || new Date().toISOString(),
          isActive: r.isActive,
        })),
      };
    } catch (error) {
      return {
        success: false,
        roots: [],
        error: error instanceof Error ? error.message : '获取存储根失败',
      };
    }
  },

  async getClientPathMappings(): Promise<{ success: boolean; mappings: ClientPathMapping[]; error?: string }> {
    // 获取或创建客户端节点
    const clientNodeId = await getOrCreateClientNodeId();
    
    if (!clientNodeId) {
      // 如果无法获取 clientNodeId，回退到本地存储
      return {
        success: true,
        mappings: loadLocalMappings(),
      };
    }
    
    try {
      // 服务端路由: GET /api/path-mappings/client-nodes/{clientNodeId}/mappings
      const response = await apiClient.get<PathMappingResponse[]>(`/api/path-mappings/client-nodes/${clientNodeId}/mappings`);
      const mappings = Array.isArray(response) ? response : [];
      
      const mappedMappings: ClientPathMapping[] = mappings.map((m) => ({
        mappingId: m.id,
        clientNodeId: m.clientNodeId,
        rootCode: m.rootCode,
        localAbsolutePath: m.localPath,
        createdAt: m.createdAtUtc?.toString() || new Date().toISOString(),
        updatedAt: m.updatedAtUtc?.toString() || new Date().toISOString(),
      }));
      
      // 同步到本地存储作为缓存
      saveLocalMappings(mappedMappings);
      
      return {
        success: true,
        mappings: mappedMappings,
      };
    } catch (error) {
      // 如果服务端获取失败，回退到本地存储
      return {
        success: true,
        mappings: loadLocalMappings(),
      };
    }
  },

  async savePathMapping(mapping: {
    rootCode: string;
    localAbsolutePath: string;
  }): Promise<{ success: boolean; mapping?: ClientPathMapping; error?: string }> {
    // 获取或创建客户端节点
    const clientNodeId = await getOrCreateClientNodeId();
    
    if (!clientNodeId) {
      return {
        success: false,
        error: '无法获取客户端节点，请检查网络连接',
      };
    }
    
    try {
      // 服务端路由: POST /api/path-mappings/client-nodes/{clientNodeId}/mappings
      const response = await apiClient.post<PathMappingResponse>(
        `/api/path-mappings/client-nodes/${clientNodeId}/mappings`,
        {
          rootCode: mapping.rootCode,
          localPath: mapping.localAbsolutePath,
        }
      );
      
      if (!response) {
        return {
          success: false,
          error: '保存路径映射失败',
        };
      }
      
      const now = new Date().toISOString();
      const newMapping: ClientPathMapping = {
        mappingId: response.id,
        clientNodeId: response.clientNodeId,
        rootCode: response.rootCode,
        localAbsolutePath: response.localPath,
        createdAt: response.createdAtUtc?.toString() || now,
        updatedAt: response.updatedAtUtc?.toString() || now,
      };
      
      // 更新本地存储
      const mappings = loadLocalMappings();
      const existingIndex = mappings.findIndex((m) => m.rootCode === mapping.rootCode);
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
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存路径映射失败',
      };
    }
  },

  async deletePathMapping(rootCode: string): Promise<{ success: boolean; error?: string }> {
    // 获取客户端节点
    const clientNodeId = await getOrCreateClientNodeId();
    
    if (!clientNodeId) {
      // 回退到仅删除本地存储
      const mappings = loadLocalMappings().filter((m) => m.rootCode !== rootCode);
      saveLocalMappings(mappings);
      return { success: true };
    }
    
    try {
      // 服务端路由: DELETE /api/path-mappings/client-nodes/{clientNodeId}/mappings/{rootCode}
      await apiClient.request(`/api/path-mappings/client-nodes/${clientNodeId}/mappings/${rootCode}`, { method: 'DELETE' });
    } catch {
      // 忽略服务端错误，继续删除本地存储
    }
    
    // 删除本地存储
    const mappings = loadLocalMappings().filter((m) => m.rootCode !== rootCode);
    saveLocalMappings(mappings);
    
    return {
      success: true,
    };
  },

  async resolveLogicalPath(rootCode: string, logicalPath: string): Promise<{ success: boolean; localPath?: string; error?: string }> {
    // 优先从服务端获取最新映射
    const clientNodeId = await getOrCreateClientNodeId();
    
    if (clientNodeId) {
      try {
        const response = await apiClient.get<PathMappingResponse>(
          `/api/path-mappings/client-nodes/${clientNodeId}/mappings/${rootCode}`
        );
        
        if (response && response.localPath) {
          // 组合路径
          const normalizedLocalPath = response.localPath.replace(/[\\/]+$/, '');
          const normalizedLogicalPath = logicalPath.replace(/^[\\/]+/, '');
          const localPath = `${normalizedLocalPath}\\${normalizedLogicalPath}`.replace(/\\\\/g, '\\');
          
          return {
            success: true,
            localPath,
          };
        }
      } catch {
        // 回退到本地存储
      }
    }
    
    // 回退到本地存储
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
      localPath,
    };
  },
};

/** 服务端响应类型 */
interface StorageRootResponse {
  id: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAtUtc?: string;
  updatedAtUtc?: string;
}

interface PathMappingResponse {
  id: string;
  clientNodeId: string;
  rootCode: string;
  localPath: string;
  createdAtUtc?: string;
  updatedAtUtc?: string;
}