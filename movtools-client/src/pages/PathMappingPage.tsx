/**
 * 路径映射设置页面
 * 
 * 配置本机路径映射，用于将服务端的逻辑路径解析为本地绝对路径。
 */
import { useEffect, useMemo, useState } from 'react';
import type { StorageRoot, ClientPathMapping } from '../repositories/types';
import { pathMappingService } from '../services/repositoryService';

/**
 * 路径映射设置页面组件
 * 配置本机路径映射，用于将服务端的逻辑路径解析为本地绝对路径
 */
interface PathMappingPageProps {
  embedded?: boolean;
}

export function PathMappingPage({ embedded = false }: PathMappingPageProps) {
  /**
   * 存储根列表状态和设置器
   * 存储服务端配置的存储根信息
   */
  const [storageRoots, setStorageRoots] = useState<StorageRoot[]>([]);
  /**
   * 客户端路径映射列表状态和设置器
   * 存储本地配置的路径映射信息
   */
  const [mappings, setMappings] = useState<ClientPathMapping[]>([]);
  /**
   * 是否正在加载数据的状态和设置器
   * 表示组件正在从服务端获取路径映射数据
   */
  const [loading, setLoading] = useState(true);
  /**
   * 是否正在保存映射的状态和设置器
   * 表示组件正在保存路径映射到服务端
   */
  const [saving, setSaving] = useState(false);
  /**
   * 操作结果状态和设置器
   * 用于显示操作成功或失败的信息，包含success布尔值和可选的error字符串
   */
  const [result, setResult] = useState<{ success: boolean; error?: string }>({ success: true });
  /**
   * 正在编辑的映射状态和设置器
   * 为null时表示不处于编辑状态
   * 包含rootCode（存储根代码）和path（本地路径）字段
   */
  const [editingMapping, setEditingMapping] = useState<{ rootCode: string; path: string } | null>(null);

    /**
     * 加载路径映射数据
     * 从服务端获取存储根列表和客户端路径映射列表，并更新对应的状态变量
     * 包含错误处理逻辑：如果服务端接口不可用（404）或连接失败，会设置相应的错误状态
     * @returns 无返回值
     */
    async function loadData(): Promise<void> {
     // 设置加载状态和初始化结果
     setLoading(true);
     setResult({ success: true });
     try {
       // 并行获取存储根列表和客户端路径映射
       const [rootsResult, mappingsResult] = await Promise.all([
         pathMappingService.listStorageRoots(),
         pathMappingService.getClientPathMappings(),
       ]);
       
       // 处理存储根获取结果
       if (!rootsResult.success) {
         // 检查是否是接口错误（如404）
         const errorMsg = rootsResult.error || '';
         if (errorMsg.includes('404') || errorMsg.includes('not found')) {
           // 接口不存在，表示路径映射功能不可用
           setResult({ success: false, error: '路径映射功能不可用：服务端接口返回错误。' });
           setStorageRoots([]);
         } else {
           // 其他错误
           setResult({ success: false, error: rootsResult.error });
           setStorageRoots([]);
         }
         setMappings([]);
         setLoading(false);
         return;
       }
       
       // 处理成功的存储根获取结果
       if (rootsResult.success) {
         setStorageRoots(rootsResult.roots);
       }
       // 处理成功的映射获取结果
       if (mappingsResult.success) {
         setMappings(mappingsResult.mappings);
       }
     } catch (error) {
       // 捕获网络错误或其他异常，表示无法连接服务端
       setResult({ success: false, error: '路径映射功能不可用：无法连接服务端。' });
       setStorageRoots([]);
       setMappings([]);
     } finally {
       // 无论成功或失败，都结束加载状态
       setLoading(false);
     }
   }

  /**
   * 组件挂载时自动加载路径映射数据
   * 空依赖数组表示仅在组件挂载时执行一次
   */
  useEffect(() => {
    void loadData();
  }, []);

    /**
     * 计算带有映射信息的存储根列表
     * 将存储根信息与对应的路径映射合并，用于显示在UI中
     * 依赖storageRoots和mappings的变化
     * @returns 存储根数组，每个元素包含原始存储根信息以及对应的本地映射路径和映射ID
     */
    const mappedRoots = useMemo(() => {
     return storageRoots.map((root) => {
       // 查找当前存储根对应的路径映射
       const mapping = mappings.find((m) => m.rootCode === root.rootCode);
       return {
         ...root,
         // 如果有映射则使用映射的本地路径，否则为空字符串
         localPath: mapping?.localAbsolutePath ?? '',
         // 映射ID（如果存在）
         mappingId: mapping?.mappingId,
       };
     });
   }, [storageRoots, mappings]);

    /**
     * 处理保存路径映射的事件
     * 当用户在编辑器中输入本地路径并点击保存按钮时调用
     * 验证输入的本地路径不为空后，调用服务保存路径映射配置
     * 保存成功后重新加载数据并退出编辑状态
     * @param rootCode - 存储根代码
     * @param localPath - 本地绝对路径
     * @returns 无返回值
     */
    async function handleSaveMapping(rootCode: string, localPath: string): Promise<void> {
     // 验证本地路径是否为空
     if (!localPath.trim()) {
       setResult({ success: false, error: '请填写本地路径' });
       return;
     }
     
     // 设置保存状态
     setSaving(true);
     try {
       // 调用服务保存路径映射
       const response = await pathMappingService.savePathMapping({
         rootCode,
         localAbsolutePath: localPath.trim(),
       });
       
       // 如果保存成功，重新加载数据并退出编辑状态
       if (response.success) {
         await loadData();
         setEditingMapping(null);
       } else {
         // 如果保存失败，设置错误结果
         setResult({ success: false, error: response.error ?? '保存失败' });
       }
     } finally {
       // 无论成功或失败，都结束保存状态
       setSaving(false);
     }
   }

    /**
     * 处理删除路径映射的事件
     * 当用户点击删除按钮时调用
     * 会先弹出确认对话框，确认后调用服务删除指定存储根的路径映射
     * 删除成功后重新加载数据以更新UI
     * @param rootCode - 要删除的存储根代码
     * @returns 无返回值
     */
    /**
     * 处理选择目录的事件
     * 通过系统对话框让用户选择一个目录，然后调用提供的setter函数设置选中的路径
     * 用于在编辑映射时选择本地目录路径
     * @param setter - 用于设置选中路径的函数
     */
    async function handlePickDirectory(setter: (path: string) => void): Promise<void> {
     // 检查是否有可用的目录选择对话框
     if (window.movtools?.dialog?.pickDirectory) {
       // 调用系统对话框让用户选择目录
       const selected = await window.movtools.dialog.pickDirectory();
       // 如果用户选择了目录（不是null或空字符串），则调用setter设置路径
       if (selected) {
         setter(selected);
       }
     }
   }

  /**
   * 根据存储根代码获取对应的存储根标签（中文名称）
   * 在存储根列表中查找匹配的根代码，如果找到则返回其中文标签，否则返回根代码本身
   * @param rootCode - 存储根代码
   * @returns 存储根的中文标签，如果未找到则返回根代码
   */
  function getRootLabel(rootCode: string): string {
    const root = storageRoots.find((r) => r.rootCode === rootCode);
    return root?.rootLabel ?? rootCode;
  }

  return (
    <section className={embedded ? 'page-layout path-mapping-embedded' : 'page-layout'}>
      <header className="page-header">
        <div>
          <p className="eyebrow">路径映射设置</p>
          <h2>路径映射设置</h2>
          <div className="page-header-tags">
            <span className="page-header-tag">路径映射</span>
            <span className="page-header-tag">本机路径解析</span>
          </div>
        </div>
        <div className="page-header-actions">
          <p className="muted">把服务端逻辑路径映射到本机真实目录，方便打开文件和预览源文件。</p>
          <button className="secondary-button" onClick={() => void loadData()} type="button">
            刷新
          </button>
        </div>
      </header>

      <div className="panel path-mapping-panel">
        <div className="section-heading">
          <div>
            <h3>路径映射配置</h3>
            <p className="muted">
              服务端存储的是逻辑路径（如 /EP01/A010/output/A010_v001.mov），需要配置本机映射才能在本地打开文件。
            </p>
          </div>
        </div>

        {loading ? (
          <p className="muted">加载中...</p>
        ) : mappedRoots.length === 0 ? (
          <p className="muted">暂无路径根配置。请确认服务端已配置存储根。</p>
        ) : (
          <div className="path-mapping-list">
            {mappedRoots.map((root) => (
              <article className="path-mapping-card" key={root.rootCode}>
                <div className="section-heading">
                  <div>
                    <h4>{root.rootLabel}</h4>
                    <p className="muted">代码：{root.rootCode}</p>
                    {root.description && <p className="muted">{root.description}</p>}
                  </div>
                  {root.localPath ? (
                    <span className="environment-pill ready">已配置</span>
                  ) : (
                    <span className="environment-pill warning">未配置</span>
                  )}
                </div>

                {editingMapping?.rootCode === root.rootCode ? (
                  <div className="path-mapping-editor">
                    <label className="field">
                      <span>本地绝对路径</span>
                      <div className="inline-field-actions">
                        <input
                          onChange={(e) => setEditingMapping((m) => m ? { ...m, path: e.target.value } : m)}
                          value={editingMapping.path}
                          placeholder="例如：D:\Projects\XJ3\Shots"
                        />
                        <button
                          className="secondary-button"
                          onClick={() => void handlePickDirectory((p) => setEditingMapping((m) => m ? { ...m, path: p } : m))}
                          type="button"
                        >
                          选择目录
                        </button>
                      </div>
                    </label>
                    <div className="actions-row compact-actions">
                      <button
                        className="primary-button"
                        disabled={saving || !editingMapping.path.trim()}
                        onClick={() => void handleSaveMapping(root.rootCode, editingMapping.path)}
                        type="button"
                      >
                        保存
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => setEditingMapping(null)}
                        type="button"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="path-mapping-display">
                    {root.localPath ? (
                      <div className="stack-gap compact-gap">
                        <code className="path-display">{root.localPath}</code>
                        <div className="actions-row compact-actions">
                          <button
                            className="secondary-button"
                            onClick={() => setEditingMapping({ rootCode: root.rootCode, path: root.localPath })}
                            type="button"
                          >
                            编辑
                          </button>
                          {embedded ? null : null}
                        </div>
                      </div>
                    ) : (
                      <div className="stack-gap compact-gap">
                        <p className="muted">尚未配置本机路径映射</p>
                        <button
                          className="secondary-button"
                          onClick={() => setEditingMapping({ rootCode: root.rootCode, path: '' })}
                          type="button"
                        >
                          配置映射
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {embedded ? null : (
        <div className="path-mapping-help">
          <h4>使用说明</h4>
          <ul>
            <li>每个路径根代表一个逻辑存储区域（如镜头文件、Layout 文件）。</li>
            <li>配置本地映射后，系统会将逻辑路径解析为本地绝对路径。</li>
            <li>不同客户端可以配置不同的映射，互不影响。</li>
            <li>未配置映射时，将无法在本地打开预览。</li>
          </ul>
        </div>
        )}
      </div>

      {result.error && (
        <div className="danger-copy">
          {result.error}
          <button onClick={() => setResult({ success: true })} type="button">关闭</button>
        </div>
      )}
    </section>
  );
}
