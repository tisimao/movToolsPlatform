import { useEffect, useMemo, useRef, useState } from 'react';
import { getPrimaryRole } from '../auth/permissions';
import { useAuthStore } from '../auth/store';
import type { FileCheckMutationResponse, FileCheckProgressEvent } from '../types/ipc';
import type { LayoutReferenceCheckRecord, LensLayoutCandidate, LensLayoutVideoBinding, ScanRootConfigItem } from '../types/fileCheck';
import type { LensRecord } from '../types/lens';
import { useFileCheckStore } from '../stores/fileCheckStore';
import { useProjectStore } from '../stores/projectStore';
import { refreshAndSyncLensBindings } from '../lib/lensBindingSync';
import { lensService } from '../services/repositoryService';

/**
 * 创建一个空的文件检查突变响应对象
 * @returns 空的文件检查突变响应
 */
function emptyMutation(): FileCheckMutationResponse {
  return { success: true };
}

/**
 * 创建扫描根目录配置项
 * @param fileKind 文件类型：'ma' 表示镜头版本文件，'layout' 表示 Layout 文件
 * @returns 扫描根目录配置项
 */
function createScanRoot(fileKind: 'ma' | 'layout'): ScanRootConfigItem {
  return {
    rootId: crypto.randomUUID(),
    fileKind,
    label: '',
    absolutePath: '',
    priority: 100,
    isEnabled: true,
  };
}

/**
 * 获取镜头文件根目录与 Layout 根目录之间的冲突消息
 * @param lensRoots 镜头文件根目录配置数组
 * @param layoutRoots Layout 根目录配置数组
 * @returns 冲突消息字符串（如果没有冲突则返回 null）
 */
function getRootConflictMessage(lensRoots: ScanRootConfigItem[], layoutRoots: ScanRootConfigItem[]): string | null {
  const normalizedLensRoots = lensRoots
    .filter((item) => item.isEnabled && item.absolutePath.trim())
    .map((item) => item.absolutePath.trim());
  const normalizedLayoutRoots = layoutRoots
    .filter((item) => item.isEnabled && item.absolutePath.trim())
    .map((item) => item.absolutePath.trim());

  for (const lensPath of normalizedLensRoots) {
    for (const layoutPath of normalizedLayoutRoots) {
      const normalizedLens = normalizeComparablePath(lensPath);
      const normalizedLayout = normalizeComparablePath(layoutPath);
      if (normalizedLens === normalizedLayout) {
        return `检测到镜头文件根目录与 Layout 根目录重复：${lensPath}`;
      }

      if (normalizedLayout.startsWith(`${normalizedLens}\\`) || normalizedLens.startsWith(`${normalizedLayout}\\`)) {
        return `检测到镜头文件根目录与 Layout 根目录存在包含关系：镜头 ${lensPath} ↔ Layout ${layoutPath}`;
      }
    }
  }

  return null;
}

/**
 * 标准化可比较的路径（转换为大写并统一路径分隔符）
 * @param value 原始路径字符串
 * @returns 标准化后的路径字符串
 */
function normalizeComparablePath(value: string): string {
  return value.replace(/[\\/]+/g, '\\').replace(/[\\/]+$/, '').toUpperCase();
}

/**
 * 标准化 Layout 视频文件名（去除扩展名、版本号等信息）
 * @param fileName 原始文件名
 * @returns 标准化后的文件名干部分
 */
function normalizeLayoutVideoStem(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/u, '') // 去除扩展名
    .toUpperCase() // 转换为大写
    .replace(/(?:^|[_-])V0*\d{1,3}(?=$|[_-])/giu, '') // 去除版本号如 V001、_V1 等
    .replace(/[_-]{2,}/gu, '_') // 将多个连续的下划线或短横线替换为单个下划线
    .replace(/[_-]+|[_-]+$/gu, ''); // 去除开头或结尾的下划线或短横线
}

/**
 * 构建镜头 Layout 视频绑定对象
 * @param lensCode 镜头编号
 * @param candidateId 候选项ID
 * @param lensRecord 镜头记录
 * @returns 镜头 Layout 视频绑定对象（如果无法构建则返回 null）
 */
function buildLensLayoutVideoBinding(lensCode: string, candidateId: string, lensRecord: LensRecord): LensLayoutVideoBinding | null {
  if (!lensRecord.layoutVideoReady || !lensRecord.layoutVideoFileName || !lensRecord.layoutVideoAbsolutePath) {
    return null;
  }

  return {
    bindingId: '',
    candidateId,
    lensCode,
    fileName: lensRecord.layoutVideoFileName,
    relativePath: lensRecord.layoutVideoRelativePath,
    absolutePath: lensRecord.layoutVideoAbsolutePath,
    bindTime: '',
    exists: true,
    sourceRoot: undefined,
  };
}

/**
 * 获取 Layout 视频匹配提示信息
 * @param hasSelectedLayout 是否已选择 Layout Maya
 * @param hasMatchedVideo 是否已匹配到视频文件
 * @returns 匹配提示信息字符串
 */
function getLayoutVideoMatchHint(hasSelectedLayout: boolean, hasMatchedVideo: boolean): string {
  if (!hasSelectedLayout) {
    return '自动匹配会优先基于当前采用的 Layout Maya 进行；多候选时默认选择版本号更大、命名更标准且来源优先级更高的视频。';
  }

  if (!hasMatchedVideo) {
    return '当前仍未命中可用视频。自动匹配会优先基于当前采用的 Layout Maya 进行；多候选时默认选择版本号更大、命名更标准且来源优先级更高的视频。';
  }

  return '当前视频来自自动匹配结果：优先基于当前采用的 Layout Maya；多候选时默认选择版本号更大、命名更标准且来源优先级更高的视频。';
}

/**
 * 文件检查页面组件
  * 用于当前激活集的文件检查与Layout协作功能，包括路径配置、Layout扫描、引用排查和问题报告导出
 * @returns JSX元素
 */
export function FileCheckPage() {
  const { user } = useAuthStore();
  const { activeProjectId: workspaceActiveProjectId, activeEpisodeId: workspaceActiveEpisodeId } = useProjectStore();
  const {
    activeProjectId,
    activeProjectName,
    activeEpisodeId,
    activeEpisodeCode,
    activeEpisodeName,
    config,
    setStatePayload,
    layoutCandidates,
    layoutVideoBindings,
    records,
    layoutReferenceChecks,
  } = useFileCheckStore();
  const [draftConfig, setDraftConfig] = useState(config);
  const [result, setResult] = useState<FileCheckMutationResponse>(emptyMutation);
  const [isLoading, setIsLoading] = useState(false);
  const [scanState, setScanState] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [scanMode, setScanMode] = useState<'layout' | 'reference' | null>(null);
  const [progressMessage, setProgressMessage] = useState('等待执行 layout 扫描或引用排查。');
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressLogs, setProgressLogs] = useState<string[]>([]);
  const [completionNotice, setCompletionNotice] = useState<string>('');
  const [issueViewFilter, setIssueViewFilter] = useState<'all' | 'issuesOnly'>('issuesOnly');
  const [issueTypeFilter, setIssueTypeFilter] = useState<'all' | '路径不存在' | '路径存在但文件不存在' | '路径存在但文件名不匹配'>('all');
  const [batchVersionTag, setBatchVersionTag] = useState('ANI');
  const [lensRecordsByCode, setLensRecordsByCode] = useState<Record<string, LensRecord>>({});
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const currentRole = getPrimaryRole(user);
  const isMaker = currentRole === 'maker';
  const currentUserId = user?.id?.trim() || '';

  async function loadLensList() {
    return lensService.listLenses();
  }

  async function refreshState(): Promise<void> {
    setIsLoading(true);
    try {
      const response = await window.movtools.fileCheck.getState();
      const lensResponse = await loadLensList();
      setStatePayload(response);
      setDraftConfig(response.config);
      setBatchVersionTag(response.config.versionTag || lensResponse.episodeVersionTag || 'ANI');
      if (lensResponse.success) {
        setLensRecordsByCode(buildLensRecordMap(lensResponse.lenses));
      } else {
        setLensRecordsByCode({});
      }
      if (!response.success) {
        setResult({ success: false, error: response.error });
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function syncLensBindingsByIds(lensIds: string[]): Promise<FileCheckMutationResponse> {
    const uniqueLensIds = [...new Set(lensIds.filter(Boolean))];
    if (uniqueLensIds.length === 0) {
      return { success: true };
    }

    const lensResponse = await loadLensList();
    if (!lensResponse.success) {
      return { success: false, error: lensResponse.error ?? '读取当前集镜头列表失败。' };
    }

    const lensById = new Map(lensResponse.lenses.map((lens) => [lens.lensId, lens] as const));
    const refreshResponse = await refreshAndSyncLensBindings({
      lensIds: uniqueLensIds,
      resolveLens: (lensId) => lensById.get(lensId),
      resolveLensDetail: async (lensId) => {
        const detailResponse = await window.movtools.lens.detail({ lensId });
        return detailResponse.success && detailResponse.detail ? detailResponse.detail : null;
      },
    });

    return refreshResponse.success ? { success: true } : { success: false, error: refreshResponse.error ?? '同步镜头绑定失败。' };
  }

  useEffect(() => {
    void refreshState();
  }, [workspaceActiveEpisodeId, workspaceActiveProjectId]);

  useEffect(() => {
    return window.movtools.fileCheck.onProgress((event: FileCheckProgressEvent) => {
      if (event.mode === 'layout' || event.mode === 'reference') {
        setScanMode(event.mode);
      }
      setProgressMessage(event.message);
      setProgressCurrent(event.current ?? 0);
      setProgressTotal(event.total ?? 0);
      if (event.logLine) {
        setProgressLogs((current) => [...current.slice(-199), `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${event.logLine}`]);
      }

      if (event.phase === 'started' || event.phase === 'scanning' || event.phase === 'matching' || event.phase === 'writing') {
        setScanState('running');
      }

      if (event.phase === 'completed') {
        setScanState('success');
      }

      if (event.phase === 'failed') {
        setScanState('error');
      }
    });
  }, []);

  useEffect(() => {
    if (!logContainerRef.current) {
      return;
    }

    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [progressLogs]);

  async function handlePickScanRootDirectory(rootId: string, target: 'lensRoots' | 'layoutRoots'): Promise<void> {
    const nextPath = await window.movtools.dialog.pickDirectory();
    if (!nextPath) {
      return;
    }

    setDraftConfig((current) => ({
      ...current,
      [target]: current[target].map((item) => item.rootId === rootId ? { ...item, absolutePath: nextPath } : item),
    }));
  }

  function handleAddScanRoot(target: 'lensRoots' | 'layoutRoots', fileKind: 'ma' | 'layout'): void {
    setDraftConfig((current) => ({
      ...current,
      [target]: [...current[target], createScanRoot(fileKind)],
    }));
  }

  function handleRemoveScanRoot(rootId: string, target: 'lensRoots' | 'layoutRoots'): void {
    setDraftConfig((current) => ({
      ...current,
      [target]: current[target].filter((item) => item.rootId !== rootId),
    }));
  }

  function handleScanRootChange(rootId: string, target: 'lensRoots' | 'layoutRoots', patch: Partial<ScanRootConfigItem>): void {
    setDraftConfig((current) => ({
      ...current,
      [target]: current[target].map((item) => item.rootId === rootId ? { ...item, ...patch } : item),
    }));
  }

  async function handleSaveConfig(): Promise<void> {
    const conflictMessage = getRootConflictMessage(draftConfig.lensRoots, draftConfig.layoutRoots);
    if (conflictMessage) {
      setResult({ success: false, error: `${conflictMessage}。请调整后再保存。` });
      return;
    }

    const response = await window.movtools.fileCheck.updateConfig(draftConfig);
    setResult(response);
    if (response.success) {
      await refreshState();
    }
  }

  async function runMakerScopedChecks(
    lensIds: string[],
    options: {
      mode: 'layout' | 'reference';
      emptyMessage: string;
      startLog: string;
      runLens: (lensId: string) => Promise<FileCheckMutationResponse>;
      successMessage: string;
    },
  ): Promise<void> {
    if (lensIds.length === 0) {
      setResult({ success: false, error: options.emptyMessage });
      return;
    }

    setScanState('running');
    setScanMode(options.mode);
    setProgressCurrent(0);
    setProgressTotal(lensIds.length);
    setProgressMessage(options.startLog);
    setProgressLogs([`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} [开始] ${options.startLog}`]);
    setCompletionNotice('');

    for (let index = 0; index < lensIds.length; index += 1) {
      const lensId = lensIds[index];
      const lensCode = Object.values(lensRecordsByCode).find((lens) => lens.lensId === lensId)?.lensCode || lensId;
      setProgressCurrent(index + 1);
      setProgressMessage(`正在处理 ${lensCode}`);
      setProgressLogs((current) => [...current.slice(-199), `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} [处理] ${lensCode}`]);
      const response = await options.runLens(lensId);
      if (!response.success) {
        setScanState('error');
        setResult(response);
        setProgressLogs((current) => [...current.slice(-199), `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} [失败] ${lensCode} · ${response.error ?? '执行失败'}`]);
        return;
      }
    }

    await refreshState();
    setScanState('success');
    setResult({ success: true });
    setCompletionNotice(options.successMessage);
  }

  async function handleScanLayout(): Promise<void> {
    if (isMaker) {
      const makerLensIds = visibleRecords.map((record) => lensRecordsByCode[record.lensCode]?.lensId).filter(Boolean) as string[];
      await runMakerScopedChecks(makerLensIds, {
        mode: 'layout',
        emptyMessage: '当前没有属于你的镜头可执行 Layout 扫描。',
        startLog: '按本人镜头逐条扫描 Layout',
        runLens: async (lensId) => window.movtools.fileCheck.scanLens({ lensId }),
        successMessage: 'Layout 扫描完成，已按你的镜头范围刷新结果。',
      });
      return;
    }

    setScanState('running');
    setScanMode('layout');
    setProgressCurrent(0);
    setProgressTotal(0);
    setProgressLogs([`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} [开始] 批量扫描 layout`]);
    setCompletionNotice('');
    const response = await window.movtools.fileCheck.scanLayout();
    setResult(response.success ? { success: true } : response);
    if (response.success) {
      const syncResponse = await syncLensBindingsByIds(lensRecordsByCode ? Object.values(lensRecordsByCode).map((lens) => lens.lensId) : []);
      if (!syncResponse.success) {
        setScanState('error');
        setResult(syncResponse);
        return;
      }

      await refreshState();
      const latestState = await window.movtools.fileCheck.getState();
      if (latestState.success) {
        setCompletionNotice(isMaker ? 'layout 扫描完成。当前页面仅显示你负责的镜头。' : `layout 扫描完成：已采用 layout 镜头 ${latestState.layoutReferenceSummary.selectedLayoutLensCount}。可继续执行引用排查。`);
      }
    } else {
      setScanState('error');
    }
  }

  async function handleScanLayoutReferences(): Promise<void> {
    if (isMaker) {
      const makerLensIds = selectedLayoutVideoRows.map((item) => lensRecordsByCode[item.lensCode]?.lensId).filter(Boolean) as string[];
      await runMakerScopedChecks(makerLensIds, {
        mode: 'reference',
        emptyMessage: '当前没有属于你的已采用 Layout 镜头可执行引用检查。',
        startLog: '按本人镜头逐条检查 Layout 引用',
        runLens: async (lensId) => window.movtools.fileCheck.scanLensLayoutReferences({ lensId }),
        successMessage: 'Layout 引用排查完成，已按你的镜头范围刷新结果。',
      });
      return;
    }

    setScanState('running');
    setScanMode('reference');
    setProgressCurrent(0);
    setProgressTotal(0);
    setProgressLogs([`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} [开始] 批量检查当前采用 layout 的引用`]);
    setCompletionNotice('');
    const response = await window.movtools.fileCheck.scanLayoutReferences();
    setResult(response.success ? { success: true } : response);
    if (response.success) {
      await refreshState();
      const latestState = await window.movtools.fileCheck.getState();
      if (latestState.success) {
        setCompletionNotice(isMaker ? 'layout 引用排查完成。当前页面仅展示你负责镜头的排查结果。' : `layout 引用排查完成：已采用 layout 镜头 ${latestState.layoutReferenceSummary.selectedLayoutLensCount}，已检查 ${latestState.layoutReferenceSummary.checkedLensCount}，存在问题镜头 ${latestState.layoutReferenceSummary.issueLensCount}，问题总数 ${latestState.layoutReferenceSummary.totalIssueCount}。`);
      }
    } else {
      setScanState('error');
    }
  }

  async function handleExportLayoutReferenceReport(): Promise<void> {
    if (isMaker) {
      setResult({ success: false, error: '制作人员账号暂不支持在文件检查页导出整集引用问题报告，请在当前页面处理自己的镜头。' });
      return;
    }

    const response = await window.movtools.fileCheck.exportLayoutReferences({
      onlyWithIssues: issueViewFilter === 'issuesOnly',
      issueType: issueTypeFilter,
    });
    setResult({ success: response.success, error: response.success ? `已导出 ${response.exportedCount ?? 0} 条 layout 引用问题到：${response.filePath}` : response.error });
    window.alert(response.success ? `layout 引用问题报告已导出：${response.filePath}` : response.error ?? '导出 layout 引用问题报告失败。');
  }

  async function handleBatchVersionTagUpdate(): Promise<void> {
    const nextVersionTag = batchVersionTag.trim().toUpperCase();
    if (!nextVersionTag) {
      setResult({ success: false, error: '请先填写统一版本文件字段。' });
      return;
    }

    const confirmed = window.confirm(`将当前集全部镜头的版本文件字段统一修改为“${nextVersionTag}”，并同步重算版本文件名。\n\n是否继续？`);
    if (!confirmed) {
      return;
    }

    const lensResponse = await loadLensList();
    if (!lensResponse.success) {
      setResult({ success: false, error: lensResponse.error ?? '读取当前集镜头列表失败。' });
      return;
    }

    const response = await window.movtools.lens.batchUpdateVersionTag({ versionTag: nextVersionTag });
    if (!response.success) {
      setResult(response);
      return;
    }

    const lensById = new Map(lensResponse.lenses.map((lens) => [lens.lensId, lens] as const));
    const refreshResponse = await refreshAndSyncLensBindings({
      lensIds: lensResponse.lenses.map((lens) => lens.lensId),
      resolveLens: (lensId) => lensById.get(lensId),
      resolveLensDetail: async (lensId) => {
        const detailResponse = await window.movtools.lens.detail({ lensId });
        return detailResponse.success && detailResponse.detail ? detailResponse.detail : null;
      },
    });
    setResult(refreshResponse.success ? response : { success: false, error: `版本字段已更新，但自动文件匹配失败：${refreshResponse.error}` });
    await refreshState();
  }

  async function handleExportMissingLayoutReport(): Promise<void> {
    if (isMaker) {
      setResult({ success: false, error: '制作人员账号暂不支持在文件检查页导出整集缺失 Layout 清单，请仅处理自己的镜头。' });
      return;
    }

    const missingLayoutLensCodes = new Set(visibleRecords.filter((record) => record.layoutStatus === '缺失').map((record) => record.lensCode));
    if (missingLayoutLensCodes.size === 0) {
      setResult({ success: false, error: '当前集没有缺失 Layout 的镜头可导出。' });
      window.alert('当前集没有缺失 Layout 的镜头可导出。');
      return;
    }

    const lensResponse = await loadLensList();
    if (!lensResponse.success) {
      setResult({ success: false, error: lensResponse.error ?? '读取当前集镜头列表失败。' });
      return;
    }

    const missingLayoutLensIds = lensResponse.lenses
      .filter((lens) => missingLayoutLensCodes.has(lens.lensCode) && !lens.layoutReady)
      .map((lens) => lens.lensId);
    if (missingLayoutLensIds.length === 0) {
      setResult({ success: false, error: '当前集没有缺失 Layout 的镜头可导出。' });
      window.alert('当前集没有缺失 Layout 的镜头可导出。');
      return;
    }

    const response = await window.movtools.lens.exportIssues({ lensIds: missingLayoutLensIds, mode: 'missing-layout' });
    setResult({
      success: response.success,
      error: response.success ? `已导出 ${response.exportedCount ?? missingLayoutLensIds.length} 条 layout 缺项到：${response.filePath}` : response.error,
    });
    window.alert(response.success ? `缺失 layout 表已导出：${response.filePath}` : response.error ?? '导出缺失 layout 表失败。');
  }

  async function handlePickLayoutVideo(lensCode: string, candidateId: string, defaultPath?: string): Promise<void> {
    const filePath = await window.movtools.dialog.pickFile({
      title: '选择 Layout 视频文件',
      filters: [{ name: '视频文件', extensions: ['mov', 'mp4', 'm4v', 'avi', 'mxf', 'mpg', 'mpeg', 'wmv'] }],
      defaultPath,
    });
    if (!filePath) {
      return;
    }

    const response = await window.movtools.fileCheck.addLayoutVideoBinding({ lensCode, candidateId, filePath });
    setResult(response.success ? { success: true } : response);
    if (response.success) {
      const lensId = lensRecordsByCode[lensCode]?.lensId;
      const syncResponse = await syncLensBindingsByIds(lensId ? [lensId] : []);
      if (!syncResponse.success) {
        setResult(syncResponse);
        return;
      }

      await refreshState();
    }
  }

  async function handleRunFileCheck(): Promise<void> {
    if (isMaker) {
      const makerLensIds = visibleRecords.map((record) => lensRecordsByCode[record.lensCode]?.lensId).filter(Boolean) as string[];
      await runMakerScopedChecks(makerLensIds, {
        mode: 'reference',
        emptyMessage: '当前没有属于你的镜头可执行文件检查。',
        startLog: '按本人镜头逐条执行文件检查',
        runLens: async (lensId) => window.movtools.fileCheck.scanLens({ lensId }),
        successMessage: '文件检查完成，已按你的镜头范围刷新结果。',
      });
      return;
    }

    setScanState('running');
    setScanMode('reference');
    setProgressCurrent(0);
    setProgressTotal(0);
    setProgressLogs([`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} [开始] 执行当前集文件检查`]);
    setCompletionNotice('');

    const response = await window.movtools.fileCheck.scan();
    if (!response.success) {
      setResult(response);
      setScanState('error');
      return;
    }

    const syncResponse = await syncLensBindingsByIds(Object.values(lensRecordsByCode).map((lens) => lens.lensId));
    if (!syncResponse.success) {
      setResult(syncResponse);
      setScanState('error');
      return;
    }

    setResult({ success: true });
    await refreshState();
    const latestState = await window.movtools.fileCheck.getState();
    if (latestState.success) {
      setCompletionNotice(isMaker ? '文件检查完成。当前页面仅展示你负责镜头的检查结果。' : `文件检查完成：共 ${latestState.summary.totalLensCount} 条镜头，缺失 ma ${latestState.summary.missingMaCount}，缺失 mov ${latestState.summary.missingMovCount}，缺失 layout ${latestState.summary.missingLayoutCount}。`);
    }
  }

  const progressRatio = progressTotal > 0 ? Math.min(100, Math.round((progressCurrent / progressTotal) * 100)) : 0;
  const visibleLensCodes = useMemo(() => {
    const allLensCodes = new Set<string>([
      ...records.map((record) => record.lensCode),
      ...layoutReferenceChecks.map((check) => check.lensCode),
      ...Object.keys(layoutCandidates),
      ...Object.keys(lensRecordsByCode),
    ]);

    if (!isMaker) {
      return allLensCodes;
    }

    return new Set(
      Object.values(lensRecordsByCode)
        .filter((lens) => (lens.makerUserId?.trim() || '') === currentUserId)
        .map((lens) => lens.lensCode)
        .filter((lensCode) => allLensCodes.has(lensCode)),
    );
  }, [currentUserId, isMaker, layoutCandidates, layoutReferenceChecks, lensRecordsByCode, records]);
  const visibleRecords = useMemo(
    () => records.filter((record) => visibleLensCodes.has(record.lensCode)),
    [records, visibleLensCodes],
  );
  const visibleLayoutReferenceChecks = useMemo(
    () => layoutReferenceChecks.filter((check) => visibleLensCodes.has(check.lensCode)),
    [layoutReferenceChecks, visibleLensCodes],
  );
  const visibleLayoutCandidates = useMemo(
    () => Object.fromEntries(Object.entries(layoutCandidates).filter(([lensCode]) => visibleLensCodes.has(lensCode))),
    [layoutCandidates, visibleLensCodes],
  );
  const currentTarget = useMemo(() => {
    const lastLine = progressLogs[progressLogs.length - 1] ?? '';
    const matchedLens = lastLine.match(/\[匹配\]\s+([^·\s]+)/);
    if (matchedLens?.[1]) {
      return `当前镜头：${matchedLens[1]}`;
    }

    const matchedPath = lastLine.match(/\[扫描\]\s+(.+)/);
    if (matchedPath?.[1]) {
      return `当前路径：${matchedPath[1]}`;
    }

    return scanMode === 'layout' ? '当前任务：批量扫描 layout' : '当前任务：批量检查 layout 引用';
  }, [progressLogs, scanMode]);

  const filteredReferenceChecks = useMemo(() => {
    return visibleLayoutReferenceChecks.filter((check) => {
      const matchesIssueView = issueViewFilter === 'all'
        ? true
        : check.issueCount > 0 || check.status === 'layout文件缺失' || check.status === '读取失败';

      const matchesIssueType = issueTypeFilter === 'all'
        ? true
        : check.issues.some((issue) => issue.issueType === issueTypeFilter)
          || (issueTypeFilter === '路径不存在' && check.status === 'layout文件缺失');

      return matchesIssueView && matchesIssueType;
    });
  }, [issueTypeFilter, issueViewFilter, visibleLayoutReferenceChecks]);

  const exportableIssueCount = useMemo(
    () => visibleLayoutReferenceChecks.filter((item) => item.issueCount > 0 || item.status === 'layout文件缺失' || item.status === '读取失败').length,
    [visibleLayoutReferenceChecks],
  );
  const selectedLayoutVideoRows = useMemo(() => {
    const referenceByLensCode = visibleLayoutReferenceChecks.reduce<Record<string, LayoutReferenceCheckRecord>>((accumulator, item) => {
      accumulator[item.lensCode] = item;
      return accumulator;
    }, {});

    const lensCodes = Object.keys(visibleLayoutCandidates)
      .filter((lensCode) => {
        const candidates = visibleLayoutCandidates[lensCode] ?? [];
        return candidates.length > 0;
      })
      .sort((left, right) => left.localeCompare(right, 'zh-CN'));

    return lensCodes.reduce<Array<{
      lensCode: string;
      selectedCandidate: LensLayoutCandidate;
      matchedVideo: LensLayoutVideoBinding | null;
      check: LayoutReferenceCheckRecord | undefined;
    }>>((accumulator, lensCode) => {
        const candidates = visibleLayoutCandidates[lensCode] ?? [];
        const lensRecord = lensRecordsByCode[lensCode];
        const selectedCandidate = candidates.find((candidate) => candidate.fileName === lensRecord?.selectedLayoutFileName)
          ?? candidates.find((candidate) => candidate.isSelected)
          ?? candidates[0]
          ?? null;
        if (!selectedCandidate) {
          return accumulator;
        }

        const matchedVideo = (lensRecord
          && lensRecord.layoutVideoReady
          ? buildLensLayoutVideoBinding(lensCode, selectedCandidate.candidateId, lensRecord)
          : null);
        accumulator.push({
          lensCode,
          selectedCandidate,
          matchedVideo,
          check: referenceByLensCode[lensCode],
        });
        return accumulator;
      }, []);
  }, [lensRecordsByCode, visibleLayoutCandidates, visibleLayoutReferenceChecks]);
  const visibleLayoutReferenceSummary = useMemo(() => ({
    selectedLayoutLensCount: selectedLayoutVideoRows.length,
    checkedLensCount: visibleLayoutReferenceChecks.length,
    issueLensCount: visibleLayoutReferenceChecks.filter((check) => check.issueCount > 0 || check.status === 'layout文件缺失' || check.status === '读取失败').length,
    totalIssueCount: visibleLayoutReferenceChecks.reduce((sum, check) => sum + check.issueCount, 0),
  }), [selectedLayoutVideoRows.length, visibleLayoutReferenceChecks]);
  const layoutPreviewLensCode = useMemo(() => {
    const firstLensCode = visibleLayoutReferenceChecks[0]?.lensCode;
    return firstLensCode || 'EP15_01_SC001';
  }, [visibleLayoutReferenceChecks]);
  const layoutPreviewFileName = useMemo(() => {
    const normalizedTag = (draftConfig.layoutTag.trim() || 'LAY').toLowerCase();
    return `${layoutPreviewLensCode}_${normalizedTag}.ma / ${layoutPreviewLensCode}_${normalizedTag}_v001.ma`;
  }, [draftConfig.layoutTag, layoutPreviewLensCode]);
  const enabledLayoutRootCount = useMemo(
    () => draftConfig.layoutRoots.filter((item) => item.isEnabled && item.absolutePath.trim()).length,
    [draftConfig.layoutRoots],
  );
  const enabledLensRootCount = useMemo(
    () => draftConfig.lensRoots.filter((item) => item.isEnabled && item.absolutePath.trim()).length,
    [draftConfig.lensRoots],
  );
  const rootConflictMessage = useMemo(
    () => getRootConflictMessage(draftConfig.lensRoots, draftConfig.layoutRoots),
    [draftConfig.layoutRoots, draftConfig.lensRoots],
  );
  const activeEpisodeLabel = useMemo(() => {
    if (!activeEpisodeCode && !activeEpisodeName) {
      return '未选择当前集';
    }

    return activeEpisodeName && activeEpisodeName !== activeEpisodeCode
      ? `${activeEpisodeCode} / ${activeEpisodeName}`
      : (activeEpisodeCode || activeEpisodeName);
  }, [activeEpisodeCode, activeEpisodeName]);
  const versionPreviewLensCode = useMemo(() => visibleRecords[0]?.lensCode ?? `${activeEpisodeCode || 'EP01'}_SC001`, [activeEpisodeCode, visibleRecords]);
  const versionPreviewFileName = useMemo(() => {
    const normalizedTag = (batchVersionTag.trim() || 'ANI').toUpperCase();
    return `${versionPreviewLensCode}_${normalizedTag}_v001`;
  }, [batchVersionTag, versionPreviewLensCode]);
  const missingLayoutCount = useMemo(() => visibleRecords.filter((record) => record.layoutStatus === '缺失').length, [visibleRecords]);

  function renderScanRootEditor(title: string, description: string, target: 'lensRoots' | 'layoutRoots', fileKind: 'ma' | 'layout', emptyLabel: string) {
    const roots = draftConfig[target];

    return (
      <div className="stack-gap">
        <div className="section-heading">
          <div>
            <h4>{title}</h4>
            <p className="muted">{description}</p>
          </div>
          <button className="secondary-button" onClick={() => handleAddScanRoot(target, fileKind)} type="button">新增根目录</button>
        </div>
        {roots.length > 0 ? roots.map((root, index) => (
          <article className="lens-history-card" key={root.rootId}>
            <div className="panel-grid two-column">
              <label className="field">
                <span>标签</span>
                <input onChange={(event) => handleScanRootChange(root.rootId, target, { label: event.target.value })} placeholder={`例如 团队${index + 1}`} value={root.label} />
              </label>
              <label className="field">
                <span>优先级</span>
                <input min={0} onChange={(event) => handleScanRootChange(root.rootId, target, { priority: Number(event.target.value || 0) })} type="number" value={root.priority} />
              </label>
            </div>
            <label className="field">
              <span>根目录</span>
              <div className="picker-row">
                <input onChange={(event) => handleScanRootChange(root.rootId, target, { absolutePath: event.target.value })} placeholder="选择或输入绝对路径" value={root.absolutePath} />
                <button className="secondary-button" onClick={() => void handlePickScanRootDirectory(root.rootId, target)} type="button">浏览</button>
              </div>
            </label>
            <div className="actions-row compact-actions wrap-actions">
              <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input checked={root.isEnabled} onChange={(event) => handleScanRootChange(root.rootId, target, { isEnabled: event.target.checked })} type="checkbox" />
                启用该根目录
              </label>
              <button className="secondary-button" onClick={() => handleRemoveScanRoot(root.rootId, target)} type="button">删除</button>
            </div>
          </article>
        )) : <p className="muted">{emptyLabel}</p>}
      </div>
    );
  }

  return (
    <section className="page-layout">
      <header className="page-header">
        <div>
          <p className="eyebrow">文件检查</p>
          <h2>当前集文件检查与Layout协作台</h2>
        </div>
        <div className="page-header-actions">
          <p className="muted">当前项目：{activeProjectName || '未选择项目'}；当前激活集：{activeEpisodeLabel}。本页所有路径配置、扫描结果、Layout候选和引用排查都只对应当前激活集；切换集后会自动切换到该集自己的独立数据。{isMaker ? ' 当前账号仅显示你负责的镜头。' : ''}</p>
          <div className="file-check-header-action-groups">
            <div className="file-check-header-action-group">
              <small className="muted">当前集状态</small>
              <div className="actions-row compact-actions">
                <button className="secondary-button" disabled={!activeProjectId || !activeEpisodeId || isLoading || scanState === 'running'} onClick={() => void refreshState()} type="button">
                  刷新当前集状态
                </button>
              </div>
            </div>
            <div className="file-check-header-action-group">
              <small className="muted">Layout处理</small>
              <div className="actions-row compact-actions">
                <button className="primary-button" disabled={!activeProjectId || !activeEpisodeId || scanState === 'running'} onClick={() => void handleRunFileCheck()} type="button">
                  执行当前集文件检查
                </button>
                <button className="secondary-button" disabled={!activeProjectId || !activeEpisodeId || scanState === 'running'} onClick={() => void handleScanLayout()} type="button">
                  扫描当前集Layout
                </button>
                <button className="secondary-button" disabled={!activeProjectId || !activeEpisodeId || scanState === 'running'} onClick={() => void handleScanLayoutReferences()} type="button">
                  检查当前集Layout引用
                </button>
                <button className="primary-button" disabled={exportableIssueCount === 0} onClick={() => void handleExportLayoutReferenceReport()} type="button">
                  导出当前集引用问题
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>当前激活集上下文</h3>
            <p className="muted">本页不会展示其他集的路径配置；你现在看到和编辑的，都是当前激活集的独立配置、扫描结果与协作状态。</p>
          </div>
          <span className={activeEpisodeId ? 'environment-pill ready' : 'environment-pill blocked'}>
            {activeEpisodeId ? '仅当前集生效' : '未激活集'}
          </span>
        </div>

        <div className="panel-grid two-column">
          <article className="environment-check file-check-scope-card">
            <span className="environment-pill info">项目上下文</span>
            <strong>{activeProjectName || '未选择项目'}</strong>
            <small className="muted">当前激活集的路径配置会保存在这个项目下，但不会与其他集共用。</small>
          </article>
          <article className="environment-check file-check-scope-card file-check-scope-card--active">
            <span className="environment-pill ready">当前激活集</span>
            <strong>{activeEpisodeLabel}</strong>
            <small className="muted">本页所有保存、扫描、引用排查操作都只写入和读取这个集。{isMaker ? ' 当前账号仅显示你负责的镜头。' : ''}</small>
          </article>
        </div>
      </section>

      <section className="panel stack-gap file-check-progress-panel">
        <div className="section-heading">
          <div>
            <h3>当前集 Layout 扫描 / 引用排查进度</h3>
            <p className="muted">扫描目录较深或引用较多时会持续输出日志，便于跟踪当前集的Layout处理进度。</p>
          </div>
          <span className={scanState === 'running' ? 'environment-pill warning' : scanState === 'success' ? 'environment-pill ready' : scanState === 'error' ? 'environment-pill blocked' : 'environment-pill'}>
            {scanState === 'running' ? `执行中 · ${scanMode === 'layout' ? 'layout扫描' : 'layout引用'}` : scanState === 'success' ? '最近一次已完成' : scanState === 'error' ? '最近一次失败' : '空闲'}
          </span>
        </div>

        <div className="file-check-progress-meta">
          <strong>{progressMessage}</strong>
          <small className="muted">{progressTotal > 0 ? `${progressCurrent} / ${progressTotal} · ${progressRatio}%` : '等待执行'}</small>
        </div>

        <div className="file-check-current-target">
          <span className="environment-pill warning">实时定位</span>
          <strong>{currentTarget}</strong>
        </div>

        <div className="file-check-progress-bar">
          <div className="file-check-progress-bar__fill" style={{ width: `${progressRatio}%` }} />
        </div>

        {completionNotice ? (
          <div className="file-check-completion-banner success-copy">
            <strong>扫描已完成</strong>
            <span>{completionNotice}</span>
          </div>
        ) : null}

        <div className="file-check-log-box" ref={logContainerRef}>
          {progressLogs.length > 0 ? progressLogs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>) : <div className="muted">执行 layout 扫描或引用排查后，这里会实时显示进度日志。</div>}
        </div>
      </section>

      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>当前集路径与命名配置</h3>
            <p className="muted">镜头资产路径、Layout路径与相关命名字段都在这里分开维护，且只对当前激活集生效。</p>
          </div>
        </div>

        <div className="panel-grid two-column">
          <article className="environment-check file-check-summary-card">
            <span className="environment-pill ready">镜头版本区域</span>
            <strong>已启用 {enabledLensRootCount} 个镜头文件根目录</strong>
            <small className="muted">镜头版本 MA / 拍屏视频只会从这些镜头文件根目录内查找。</small>
          </article>
          <article className="environment-check file-check-summary-card file-check-summary-card--warning">
            <span className="environment-pill warning">Layout区域</span>
            <strong>已启用 {enabledLayoutRootCount} 个 Layout 根目录</strong>
            <small className="muted">Layout Maya / Layout视频只会从这些 Layout 根目录内查找。</small>
          </article>
        </div>

        {rootConflictMessage ? <p className="danger-copy">{rootConflictMessage}。请调整后再保存，否则会导致镜头版本文件与 Layout 文件交叉扫描。</p> : null}

        <div className="panel-grid two-column">
          <article className="panel stack-gap file-check-root-panel file-check-root-panel--lens">
            <div className="section-heading">
              <div>
                <h4>镜头版本文件路径配置</h4>
                <p className="muted">只负责当前激活集的镜头版本 MA 与拍屏/视频文件匹配，不参与 Layout 候选发现。</p>
              </div>
              <span className="environment-pill ready">镜头版本专用</span>
            </div>
            <article className="environment-check file-check-summary-card">
              <span className="environment-pill ready">镜头版本区域</span>
              <strong>统一版本文件字段</strong>
              <small className="muted">只作用于当前激活集的镜头版本命名。预览：{versionPreviewFileName}</small>
              <label className="field">
                <span>统一版本文件字段</span>
                <input onChange={(event) => setBatchVersionTag(event.target.value.toUpperCase())} placeholder="例如 ANI" value={batchVersionTag} />
              </label>
              <div className="actions-row compact-actions wrap-actions">
                <button className="secondary-button" disabled={!activeProjectId || !activeEpisodeId} onClick={() => void handleBatchVersionTagUpdate()} type="button">
                  保存统一版本字段
                </button>
              </div>
            </article>
            {renderScanRootEditor('镜头文件根目录', '这些目录只会扫描当前集的版本 MA 与拍屏/视频文件，统一参与镜头版本匹配。', 'lensRoots', 'ma', '当前集暂未配置镜头版本文件根目录。')}
          </article>

          <article className="panel stack-gap file-check-root-panel file-check-root-panel--layout">
            <div className="section-heading">
              <div>
                <h4>Layout文件路径配置</h4>
                <p className="muted">只负责当前激活集的Layout Maya 与Layout视频扫描，用于候选发现、自动映射和引用排查。</p>
              </div>
              <span className="environment-pill warning">Layout专用</span>
            </div>
            <article className="environment-check file-check-summary-card file-check-summary-card--warning">
              <span className="environment-pill warning">Layout区域</span>
              <strong>缺失Layout协作导出</strong>
              <small className="muted">当前激活集共有 {missingLayoutCount} 条镜头仍缺少Layout Maya。{isMaker ? ' 当前账号不提供整集导出。' : ' 可导出给上下游协作补齐。'}</small>
              <div className="actions-row compact-actions wrap-actions">
                <button className="secondary-button" disabled={!activeProjectId || !activeEpisodeId || missingLayoutCount === 0} onClick={() => void handleExportMissingLayoutReport()} type="button">
                  导出缺失Layout（{missingLayoutCount}）
                </button>
              </div>
            </article>
            <label className="field">
                <span>当前激活集的Layout文件字段</span>
              <input onChange={(event) => setDraftConfig((current) => ({ ...current, layoutTag: event.target.value.toUpperCase() }))} placeholder="例如 LAY" value={draftConfig.layoutTag} />
                <small className="muted">只作用于当前激活集，用于匹配类似 {layoutPreviewFileName} 的Layout文件。</small>
            </label>
            {renderScanRootEditor('Layout 根目录', '这些目录只会递归扫描当前集的Layout Maya 与Layout视频文件，不参与镜头版本文件匹配。', 'layoutRoots', 'layout', '当前集暂未配置 Layout 根目录。')}
          </article>
        </div>
        <div className="actions-row wrap-actions">
          <button className="primary-button" disabled={!activeProjectId || !activeEpisodeId} onClick={() => void handleSaveConfig()} type="button">
            保存路径配置
          </button>
          <span className={result.success ? 'success-copy' : 'danger-copy'}>
            {result.success ? '当前页聚焦镜头文件根目录维护、Layout扫描、引用排查和问题报告导出。' : result.error ?? '准备就绪。'}
          </span>
        </div>
      </section>

      <section className="panel stack-gap file-check-layout-collab-panel">
        <div className="section-heading">
          <div>
            <h3>当前集Layout协作区</h3>
            <p className="muted">把当前集的Layout视频映射、引用排查与问题导出集中在这里，便于统一补齐与上下游协作。</p>
          </div>
          <div className="actions-row compact-actions wrap-actions">
            <button className="secondary-button" disabled={!activeProjectId || !activeEpisodeId || scanState === 'running'} onClick={() => void handleScanLayoutReferences()} type="button">
              批量检查当前采用Layout
            </button>
            <button className="primary-button" disabled={exportableIssueCount === 0} onClick={() => void handleExportLayoutReferenceReport()} type="button">
              导出当前集引用问题
            </button>
          </div>
        </div>

        <div className="environment-grid compact-grid">
          <article className="environment-check warning">
            <span className="environment-check__label">已采用 layout 镜头</span>
            <strong>{visibleLayoutReferenceSummary.selectedLayoutLensCount}</strong>
          </article>
          <article className="environment-check warning">
            <span className="environment-check__label">已检查镜头</span>
            <strong>{visibleLayoutReferenceSummary.checkedLensCount}</strong>
          </article>
          <article className="environment-check blocked">
            <span className="environment-check__label">问题镜头数</span>
            <strong>{visibleLayoutReferenceSummary.issueLensCount}</strong>
          </article>
          <article className="environment-check blocked">
            <span className="environment-check__label">问题总数</span>
            <strong>{visibleLayoutReferenceSummary.totalIssueCount}</strong>
          </article>
        </div>

        <section className="panel stack-gap file-check-layout-subpanel">
          <div className="section-heading">
            <div>
              <h4>当前Layout视频映射</h4>
              <p className="muted">显示每个镜头当前采用的Layout Maya 与对应视频路径；可在这里手动补绑或替换Layout视频。</p>
            </div>
          </div>

          {selectedLayoutVideoRows.length > 0 ? (
            <div className="lens-list">
              {selectedLayoutVideoRows.map((item) => (
                <article className="lens-card" key={item.lensCode}>
                  <div className="section-heading">
                    <div>
                      <h3>{item.lensCode}</h3>
                      <p className="muted">当前采用 Layout：{item.selectedCandidate.fileName}</p>
                    </div>
                    <span className={item.matchedVideo?.exists ? 'environment-pill ready' : item.matchedVideo ? 'environment-pill warning' : 'environment-pill blocked'}>
                      {item.matchedVideo?.exists ? '视频已匹配' : item.matchedVideo ? '已绑定但文件缺失' : '未匹配视频'}
                    </span>
                  </div>

                  <div className="stack-gap">
                    <small className="muted">Layout路径：{item.selectedCandidate.relativePath}</small>
                    <small className="muted">视频路径：{item.matchedVideo?.relativePath || '未绑定 / 未匹配'}</small>
                    <small className="muted">来源：{item.matchedVideo?.sourceRoot || item.selectedCandidate.sourceRoot || '—'}</small>
                    <small className="muted">匹配依据：{getLayoutVideoMatchHint(Boolean(item.selectedCandidate), Boolean(item.matchedVideo))}</small>
                    {item.check ? <small className={item.check.status === '正常' ? 'success-copy' : 'muted'}>引用检查：{item.check.status} · {item.check.lastCheckTime}</small> : <small className="muted">引用检查：尚未执行</small>}
                  </div>

                  <div className="actions-row compact-actions wrap-actions">
                    <button
                      className="secondary-button"
                      onClick={() => void handlePickLayoutVideo(item.lensCode, item.selectedCandidate.candidateId, item.matchedVideo?.absolutePath || item.selectedCandidate.absolutePath)}
                      type="button"
                    >
                      {item.matchedVideo ? '替换 Layout 视频' : '手动匹配 Layout 视频'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">当前还没有“已采用”的 Layout 候选。请先执行批量扫描 layout，或先在镜头页确认当前采用项。</p>
          )}
        </section>

        <section className="panel stack-gap file-check-layout-subpanel">
          <div className="section-heading">
            <div>
              <h4>Layout引用排查</h4>
              <p className="muted">批量检查当前集内“已采用 layout”的镜头引用知产是否缺失，并导出报告同步上下游团队补全。</p>
            </div>
          </div>

          <div className="panel-grid two-column file-check-filter-grid">
          <label className="field">
            <span>镜头筛选</span>
            <select onChange={(event) => setIssueViewFilter(event.target.value as 'all' | 'issuesOnly')} value={issueViewFilter}>
              <option value="issuesOnly">仅看有问题镜头</option>
              <option value="all">显示全部已检查镜头</option>
            </select>
          </label>

          <label className="field">
            <span>问题类型</span>
            <select onChange={(event) => setIssueTypeFilter(event.target.value as typeof issueTypeFilter)} value={issueTypeFilter}>
              <option value="all">全部问题类型</option>
              <option value="路径不存在">路径不存在</option>
              <option value="路径存在但文件不存在">文件不存在</option>
              <option value="路径存在但文件名不匹配">文件名不匹配</option>
            </select>
          </label>
          </div>

          {filteredReferenceChecks.length > 0 ? (
            <div className="lens-list">
              {filteredReferenceChecks.map((check) => (
                <article className="lens-card" key={check.checkId}>
                  <div className="section-heading">
                    <div>
                      <h3>{check.lensCode}</h3>
                      <p className="muted">{check.layoutFileName} · {check.layoutRelativePath}</p>
                    </div>
                    <span className={check.issueCount === 0 && check.status === '正常' ? 'environment-pill ready' : 'environment-pill blocked'}>{check.status}</span>
                  </div>

                  <div className="lens-meta-grid">
                    <span className="muted">检查引用：{check.checkedReferenceCount}</span>
                    <span className="muted">问题总数：{check.issueCount}</span>
                    <span className="muted">路径不存在：{check.pathMissingCount}</span>
                    <span className="muted">文件不存在：{check.fileMissingCount}</span>
                    <span className="muted">文件名不匹配：{check.fileNameMismatchCount}</span>
                    <span className="muted">检查时间：{check.lastCheckTime}</span>
                  </div>

                  {check.errorMessage ? <p className="danger-copy">{check.errorMessage}</p> : null}

                  {check.issues.length > 0 ? (
                    <div className="lens-layout-candidate-list">
                      <h4>引用问题明细</h4>
                      {check.issues.map((issue) => (
                        <div className="binding-row" key={issue.issueId}>
                          <div className="stack-gap">
                            <span className="muted">{issue.issueType} · {issue.expectedFileName}</span>
                            <small className="muted">Maya 原始路径：{issue.refOriginalPath}</small>
                            <small className="muted">解析绝对路径：{issue.refAbsolutePath}</small>
                            <small className="muted">候选：同目录 {issue.relatedFilesSameDir.length} 个 / 上层目录 {issue.relatedFilesParentDirs.length} 个</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">{check.status === '正常' ? '当前采用 layout 的引用完整。' : '当前检查没有生成引用问题明细。'}</p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">当前筛选条件下没有匹配的引用排查结果。可调整筛选，或先设置当前采用的 layout 并执行批量检查。</p>
          )}
        </section>
      </section>
    </section>
  );
}

function buildLensRecordMap(lenses: LensRecord[]): Record<string, LensRecord> {
  return lenses.reduce<Record<string, LensRecord>>((accumulator, lens) => {
    accumulator[lens.lensCode] = lens;
    return accumulator;
  }, {});
}
