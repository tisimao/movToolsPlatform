import { useEffect, useRef, useState } from 'react';
import type { AppSettings, ExtractActionResponse, ExtractProgressEvent, GenerateExtractPreviewRequest } from '../types/ipc';
import type { ExtractFileSelection } from '../types/extract';
import type { LensStatus } from '../types/lens';
import { useExtractStore } from '../stores/extractStore';
import { useProjectStore } from '../stores/projectStore';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * 创建一个空的提取操作响应对象
 * @returns 空的提取操作响应
 */
function emptyAction(): ExtractActionResponse {
  return { success: true };
}

/**
 * 判断是否为执行结果响应（包含文件总数）
 * @param result 提取操作响应
 * @returns 是否为执行结果
 */
function isExecutionResult(result: ExtractActionResponse): boolean {
  return result.fileTotal !== undefined;
}

/**
 * 提取页面组件
 * 用于镜头文件的提取功能，包括生成预览列表、确认列表和执行提取
 * @returns JSX元素
 */
export function ExtractPage() {
  const { activeProjectId } = useProjectStore();
  const { history, previewId, previewItems, removePreviewItem, setHistory, setPreview } = useExtractStore();
  const [filters, setFilters] = useState<GenerateExtractPreviewRequest>({
    lensCode: '',
    maker: '',
    lensStatus: '',
    versionNum: '',
    fileSelection: 'ma+mov',
    renameFiles: false,
  });
  const [targetPath, setTargetPath] = useState('');
  const [listConfirmed, setListConfirmed] = useState(false);
  const [result, setResult] = useState<ExtractActionResponse>(emptyAction);
  const [lastExecutionResult, setLastExecutionResult] = useState<ExtractActionResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [progressLogs, setProgressLogs] = useState<ExtractProgressEvent[]>([]);
  const executionResultRef = useRef<HTMLElement | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const { settings } = useSettingsStore();

   /**
    * 刷新提取历史记录
    * 从主进程获取历史记录并更新状态
    */
   async function refreshHistory(): Promise<void> {
     const response = await window.movtools.extract.history();
     if (response.success) {
       setHistory(response.records);
     }
   }

   /**
    * 设置进度事件监听器
    * 订阅提取进度事件并在收到事件时更新日志
    * 返回清理函数以在组件卸载时取消订阅
    */
   useEffect(() => {
     const unsubscribe = window.movtools.extract.onProgress((event) => {
       setProgressLogs((current) => [...current, event]);
     });

     return () => {
       unsubscribe();
     };
   }, []);

   /**
     * 当活动项目ID变化时执行的副作用
     * 刷新历史、重置预览状态、清除日志和结果
     * @param activeProjectId 活动项目ID的变化触发此效果
     */
   useEffect(() => {
     void refreshHistory();
     setPreview({ previewId: null, previewItems: [] });
     setListConfirmed(false);
     setLastExecutionResult(null);
     setProgressLogs([]);
     setResult(emptyAction());
   }, [activeProjectId]);

   /**
     * 当预览列表变化时，默认全选所有项
     */
    useEffect(() => {
      setSelectedItemIds((current) => {
        if (current.length === 0) {
          return previewItems.map((item) => item.itemId);
        }

        const visibleIds = new Set(previewItems.map((item) => item.itemId));
        const retained = current.filter((itemId) => visibleIds.has(itemId));
        return retained.length > 0 ? retained : previewItems.map((item) => item.itemId);
      });
      setListConfirmed(false);
    }, [previewItems]);

   useEffect(() => {
     setFilters((current) => ({
       ...current,
       renameFiles: settings.renameDuringExtract,
     }));
   }, [settings.renameDuringExtract]);

   /**
    * 处理选择目标路径按钮点击事件
    * 打开系统文件夹选择器并设置选中的目录作为目标提取路径
    */
   async function handlePickTargetPath(): Promise<void> {
     const directory = await window.movtools.dialog.pickDirectory();
     if (directory) {
       setTargetPath(directory);
     }
   }

   /**
    * 处理生成预览列表按钮点击事件
    * 根据当前过滤条件生成待提取文件的预览列表
    */
    async function handleGeneratePreview(): Promise<void> {
      const response = await window.movtools.extract.preview(filters);
     setResult(response.success ? { success: true } : { success: false, error: response.error });
     setLastExecutionResult(null);
     setProgressLogs([]);
      setPreview({ previewId: response.previewId ?? null, previewItems: response.items });
      setListConfirmed(false);
    }

    function handleRemovePreviewItem(itemId: string): void {
      removePreviewItem(itemId);
      setSelectedItemIds((current) => current.filter((id) => id !== itemId));
      setListConfirmed(false);
      setResult({ success: true });
    }

   /**
    * 处理确认提取列表按钮点击事件
    * 将当前预览列表确认为待提取的正式列表
    */
   function handleConfirmList(): void {
     if (selectedItemIds.length === 0) {
       setResult({ success: false, error: '请先勾选待提取的文件。' });
       return;
     }
     setListConfirmed(true);
     setResult({ success: true });
   }

   /**
    * 处理执行提取按钮点击事件
    * 根据已确认的预览列表和目标路径执行实际的文件提取操作
    */
   async function handleExecuteExtract(): Promise<void> {
     if (!previewId || !listConfirmed) {
       setResult({ success: false, error: '请先生成并确认提取列表。' });
       return;
     }
     if (!targetPath.trim()) {
       setResult({ success: false, error: '请选择目标提取路径。' });
       return;
     }

     const confirmed = window.confirm('已确认提取列表，是否直接提取当前已绑定的文件？');
     if (!confirmed) {
       setListConfirmed(false);
       setResult({ success: false, error: '已取消提取流程，提取列表已解锁。' });
       return;
     }

      setIsExecuting(true);
      setProgressLogs([]);
      try {
        const response = await window.movtools.extract.execute({ previewId, targetPath: targetPath.trim(), selectedItemIds });
       setResult(response);
       setLastExecutionResult(isExecutionResult(response) ? response : null);
       if (response.fileTotal !== undefined) {
         await refreshHistory();
         window.setTimeout(() => {
           executionResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
         }, 0);
         window.alert(buildExtractSummary(response));
       }
       if (response.success) {
         setPreview({ previewId: null, previewItems: [] });
         setListConfirmed(false);
       }
     } finally {
       setIsExecuting(false);
     }
   }

   /**
    * 处理打开目标目录按钮点击事件
    * 在文件资源管理器中打开指定的目标目录
    * @param target 要打开的目标目录路径
    */
   async function handleOpenTarget(target: string): Promise<void> {
     const response = await window.movtools.extract.openTarget(target);
     setResult(response);
   }

   function toggleItem(itemId: string): void {
     setSelectedItemIds((current) =>
       current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
     );
   }

   function handleSelectAll(): void {
     setSelectedItemIds(previewItems.map((item) => item.itemId));
   }

   function handleInvertSelection(): void {
     const visibleIds = previewItems.map((item) => item.itemId);
     setSelectedItemIds((current) => {
       const currentSet = new Set(current);
       const toToggle = visibleIds.filter((id) => !currentSet.has(id));
       const keep = current.filter((id) => !visibleIds.includes(id));
       return [...keep, ...toToggle];
     });
   }

   function handleClearSelection(): void {
     setSelectedItemIds([]);
   }

  return (
    <section className="page-layout">
      <header className="page-header">
        <div>
          <p className="eyebrow">提取</p>
          <h2>镜头文件提取</h2>
        </div>
        <div className="page-header-actions">
          <p className="muted">按“生成列表 → 确认列表 → 直接提取”执行。当前版本基于已绑定文件做提取。</p>
        </div>
      </header>

      <div className="panel-grid two-column extract-page-grid">
        <div className="panel stack-gap extract-page-panel">
          <div className="section-heading">
            <div>
              <h3>提取筛选条件</h3>
              <p className="muted">按镜头编号 / 制作人员 / 状态 / 版本号生成待提取文件列表。</p>
            </div>
          </div>

          <div className="form-grid lens-form-grid">
            <label className="field">
              <span>镜头编号</span>
              <input onChange={(event) => setFilters((current) => ({ ...current, lensCode: event.target.value }))} value={filters.lensCode ?? ''} />
            </label>
            <label className="field">
              <span>制作人员</span>
              <input onChange={(event) => setFilters((current) => ({ ...current, maker: event.target.value }))} value={filters.maker ?? ''} />
            </label>
            <label className="field">
              <span>镜头状态</span>
              <select onChange={(event) => setFilters((current) => ({ ...current, lensStatus: event.target.value as GenerateExtractPreviewRequest['lensStatus'] }))} value={filters.lensStatus ?? ''}>
                <option value="">全部</option>
                <option value="制作">制作</option>
                <option value="提交">提交</option>
                <option value="返修">返修</option>
                <option value="通过">通过</option>
                <option value="关闭">关闭</option>
              </select>
            </label>
            <label className="field">
              <span>版本号</span>
              <input onChange={(event) => setFilters((current) => ({ ...current, versionNum: event.target.value }))} value={filters.versionNum ?? ''} />
            </label>
            <label className="field">
              <span>提取文件类型</span>
              <select onChange={(event) => setFilters((current) => ({ ...current, fileSelection: event.target.value as ExtractFileSelection }))} value={filters.fileSelection}>
                <option value="ma+mov">ma + mov</option>
                <option value="ma">仅 ma</option>
                <option value="mov">仅 mov</option>
              </select>
            </label>
            <label className="checkbox-field">
              <input checked={Boolean(filters.renameFiles)} onChange={(event) => setFilters((current) => ({ ...current, renameFiles: event.target.checked }))} type="checkbox" />
              <span>本次提取按系统规则改名</span>
            </label>
            <label className="field">
              <span>目标提取路径</span>
              <div className="picker-row">
                <input onChange={(event) => setTargetPath(event.target.value)} value={targetPath} />
                <button className="secondary-button" onClick={() => void handlePickTargetPath()} type="button">浏览</button>
              </div>
            </label>
          </div>

          <div className="actions-row wrap-actions">
            <button className="primary-button" disabled={!activeProjectId} onClick={() => void handleGeneratePreview()} type="button">生成提取列表</button>
            <button className="secondary-button" disabled={selectedItemIds.length === 0} onClick={handleConfirmList} type="button">确认提取列表</button>
            <button className="secondary-button" disabled={!listConfirmed || isExecuting} onClick={() => void handleExecuteExtract()} type="button">{isExecuting ? '提取中…' : '确认并提取'}</button>
            <span className="muted" style={{ fontSize: '0.85em' }}>
              默认策略：{settings.renameDuringExtract ? '自动改名' : '保持原名'} · 本次执行：{filters.renameFiles ? '自动改名' : '保持原名'}
            </span>
            <span className={result.success ? 'success-copy' : 'danger-copy'}>
              {isExecuting ? '正在提取文件，请稍候…' : result.success ? (listConfirmed ? '提取列表已锁定，可直接开始提取。' : '准备就绪。') : result.error ?? '准备就绪。'}
            </span>
          </div>

          {lastExecutionResult?.fileTotal !== undefined ? (
            <section className="stack-gap" ref={executionResultRef}>
              <div className="section-heading">
                <div>
                  <h3>本次提取结果</h3>
                  <p className="muted">共 {lastExecutionResult.fileTotal} 项，成功 {lastExecutionResult.successCount ?? 0} 项，失败 {lastExecutionResult.failedCount ?? 0} 项。</p>
                </div>
              </div>
              <div className="actions-row wrap-actions">
                <span className="muted">ma：{lastExecutionResult.maFileNum ?? 0}</span>
                <span className="muted">mov：{lastExecutionResult.movFileNum ?? 0}</span>
              </div>
              {lastExecutionResult.manifestPath ? <small className="muted">提取清单：{lastExecutionResult.manifestPath}</small> : null}
              {lastExecutionResult.logs && lastExecutionResult.logs.length > 0 ? (
                <div className="lens-list">
                  {lastExecutionResult.logs.map((log) => (
                    <article className="lens-card" key={log.itemId}>
                      <div className="section-heading">
                        <div>
                          <h3>{log.lensCode}</h3>
                          <p className="muted">{log.fileType} · {log.targetFileName}</p>
                        </div>
                        <span className={log.success ? 'environment-pill ready' : 'environment-pill blocked'}>{log.success ? '成功' : '失败'}</span>
                      </div>
                      <small className="muted">源文件：{log.sourcePath}</small>
                      {log.targetPath ? <small className="muted">输出文件：{log.targetPath}</small> : null}
                      {log.error ? <small className="error-copy">失败原因：{log.error}</small> : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="stack-gap">
            <div className="section-heading">
              <div>
                <h3>提取过程日志</h3>
                <p className="muted">实时显示提取执行进度，方便确认当前卡在哪一步。</p>
              </div>
            </div>
            {progressLogs.length > 0 ? (
              <div className="lens-list">
                {progressLogs.map((log, index) => (
                  <article className="lens-card" key={`${index}-${log.phase}-${log.logLine ?? log.message}`}>
                    <div className="section-heading">
                      <div>
                        <h3>{log.message}</h3>
                        <p className="muted">阶段：{log.phase}{log.current !== undefined && log.total !== undefined ? ` · ${log.current}/${log.total}` : ''}</p>
                      </div>
                      <span className={log.success === undefined ? 'environment-pill info' : log.success ? 'environment-pill ready' : 'environment-pill blocked'}>{log.success === undefined ? '进行中' : log.success ? '成功' : '失败'}</span>
                    </div>
                    {log.logLine ? <small className="muted">{log.logLine}</small> : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">尚未开始提取。</p>
            )}
          </section>
        </div>

        <div className="panel stack-gap extract-page-panel">
          <div className="section-heading">
            <div>
              <h3>待提取文件列表</h3>
              <p className="muted">
                共 {previewItems.length} 项，已选 {selectedItemIds.length} 项。
                {listConfirmed ? '当前列表已锁定。' : '勾选后确认即可提取。'}
                {settings.renameDuringExtract ? ' 已开启自动改名。' : ' 保持原始文件名。'}
              </p>
            </div>
            {!listConfirmed && previewItems.length > 0 ? (
              <div className="actions-row compact-actions">
                <button className="secondary-button" onClick={handleSelectAll} type="button">全选</button>
                <button className="secondary-button" onClick={handleInvertSelection} type="button">反选</button>
                <button className="secondary-button" onClick={handleClearSelection} type="button">清空</button>
              </div>
            ) : null}
          </div>

          {previewItems.length > 0 ? (
            <div className="lens-list">
              {previewItems.map((item) => (
                <article className={`lens-card ${!listConfirmed ? 'selectable-card' : ''}`} key={item.itemId}>
                  {!listConfirmed ? (
                    <label className="section-heading card-selectable-heading">
                      <input checked={selectedItemIds.includes(item.itemId)} onChange={() => toggleItem(item.itemId)} type="checkbox" />
                      <div>
                        <h3>{item.lensCode}</h3>
                        <p className="muted">{item.versionNum} · {item.fileType} · {item.fileName}</p>
                      </div>
                      <span className={extractLensStatusClassName(item.lensStatus)}>{item.lensStatus}</span>
                    </label>
                  ) : (
                    <div className="section-heading">
                      <div>
                        <h3>{item.lensCode}</h3>
                        <p className="muted">{item.versionNum} · {item.fileType} · {item.fileName}</p>
                      </div>
                      <span className={extractLensStatusClassName(item.lensStatus)}>{item.lensStatus}</span>
                    </div>
                  )}
                  <small className="muted">源文件：{item.sourcePath}</small>
                  <small className="muted">原文件名：{item.sourceFileName}</small>
                  <small className="muted">目标文件名：{item.targetFileName}</small>
                  {!listConfirmed ? (
                    <div className="actions-row compact-actions">
                      <button className="secondary-button" onClick={() => handleRemovePreviewItem(item.itemId)} type="button">移除</button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">尚未生成提取列表。</p>
          )}
        </div>
      </div>

      <section className="panel stack-gap extract-history-panel">
        <div className="section-heading">
          <div>
            <h3>提取历史</h3>
            <p className="muted">记录提取时间、文件数量、目标路径与成功状态。</p>
          </div>
        </div>

        {history.length > 0 ? (
          <div className="lens-list">
            {history.map((record) => (
              <article className="lens-card" key={record.recordId}>
                <div className="section-heading">
                  <div>
                    <h3>{record.extractTime}</h3>
                    <p className="muted">总数 {record.fileTotal} · ma {record.maFileNum} · mov {record.movFileNum}</p>
                  </div>
                  <span className={record.isSuccess === '是' ? 'environment-pill ready' : 'environment-pill blocked'}>{record.isSuccess}</span>
                </div>
                <small className="muted">目标路径：{record.targetPath}</small>
                {record.failReason ? <small className="error-copy">失败原因：{record.failReason}</small> : null}
                <div className="actions-row compact-actions">
                  <button className="secondary-button" onClick={() => void handleOpenTarget(record.targetPath)} type="button">打开目标目录</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">当前还没有提取历史。</p>
        )}
      </section>
    </section>
  );
}

function buildExtractSummary(result: ExtractActionResponse): string {
  if (result.fileTotal === undefined) {
    return result.error ?? '提取完成。';
  }

  const lines = [
    `提取完成：共 ${result.fileTotal} 项`,
    `成功：${result.successCount ?? 0} 项`,
    `失败：${result.failedCount ?? 0} 项`,
    `ma：${result.maFileNum ?? 0} 项`,
    `mov：${result.movFileNum ?? 0} 项`,
  ];

  if (result.manifestPath) {
    lines.push(`清单：${result.manifestPath}`);
  }

  if (result.failedCount && result.logs) {
    const failedLogs = result.logs.filter((log) => !log.success).slice(0, 5);
    if (failedLogs.length > 0) {
      lines.push('', '失败项：');
      for (const log of failedLogs) {
        lines.push(`- ${log.lensCode} / ${log.fileType} / ${log.error ?? '未知错误'}`);
      }
      if (result.failedCount > failedLogs.length) {
        lines.push(`- 其余 ${result.failedCount - failedLogs.length} 项请在页面“本次提取结果”中查看`);
      }
    }
  }

  return lines.join('\n');
}

function extractLensStatusClassName(status: LensStatus): string {
  if (status === '通过') {
    return 'environment-pill ready';
  }

  if (status === '关闭') {
    return 'environment-pill blocked';
  }

  return status === '提交' ? 'environment-pill info' : 'environment-pill warning';
}
