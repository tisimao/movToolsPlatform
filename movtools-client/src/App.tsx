import React, { useCallback, useEffect, useMemo, useState } from 'react';
import brandIcon from '../icon.png';
import { apiClient, updateApiClientBaseUrl } from './api/client';
import { getRuntimeConfig, setRuntimeServerBaseUrl, validateServerBaseUrl } from './config/runtime';
import { DEFAULT_SERVER_BASE_URL, normalizeServerBaseUrl } from './config/serverBaseUrl';
import { getRoleLabel, getVisibleNavigationItems } from './auth/permissions';
import { useAuthStore } from './auth/store';
import { DashboardPage } from './pages/DashboardPage';
import { DirectorDashboardPage } from './pages/DirectorDashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ExtractPage } from './pages/ExtractPage';
import { FileCheckPage } from './pages/FileCheckPage';
import { HomePage } from './pages/HomePage';
import { LensPage } from './pages/LensPage';
import { LogsPage } from './pages/LogsPage';
import { ProjectPage } from './pages/ProjectPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';
import { ReviewPage } from './pages/ReviewPage';
import { ProducerTaskPage } from './pages/ProducerTaskPage';
import { projectService } from './services/repositoryService';
import { useLogStore } from './stores/logStore';
import { useLensStore } from './stores/lensStore';
import { useProjectStore } from './stores/projectStore';
import { useSettingsStore } from './stores/settingsStore';
import { useTaskStore } from './stores/taskStore';
import { useDirectorNavigationStore } from './stores/directorNavigationStore';
import { getPrimaryRole } from './auth/permissions';
import { initializeSyncManager, getSyncManagerState, onSignalRStatusChange } from './sync';
import { connectSignalR, disconnectSignalR } from './sync/signalrService';
import type { AppInfo, EnvironmentStatus } from './types/ipc';

type AppPage = 'dashboard' | 'projects' | 'file-check' | 'extract' | 'lens' | 'home' | 'logs' | 'settings' | 'review' | 'users' | 'path-mapping' | 'producer-review';

class PageErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="content app-content">
          <section className="panel" style={{ margin: '1rem' }}>
            <p className="eyebrow">审片页面异常</p>
            <h2>页面加载失败</h2>
            <p className="muted">{this.state.message || '审片页在渲染时发生错误。'}</p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

const navigationAccents: Record<AppPage, string> = {
  dashboard: '盘',
  projects: '项',
  'file-check': '文',
  extract: '提',
  lens: '镜',
  home: '工',
  logs: '日',
  settings: '设',
  'path-mapping': '映',
  review: '审',
  users: '用',
  'producer-review': '任',
};

const firstLaunchGuideStorageKey = 'movtools.first-launch-guide.dismissed.v1';

export default function App() {
  const runtimeConfig = getRuntimeConfig();
  const movtoolsBridge = typeof window !== 'undefined' ? window.movtools : undefined;
  const { status: authStatus, user, errorMessage: authError, bootstrap, login, logout, clearError } = useAuthStore();
  const [page, setPage] = useState<AppPage>('projects');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [environmentStatus, setEnvironmentStatus] = useState<EnvironmentStatus | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(true);
  const [showFirstLaunchGuide, setShowFirstLaunchGuide] = useState(() => !window.localStorage.getItem(firstLaunchGuideStorageKey));
  const [apiStatus, setApiStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [apiMessage, setApiMessage] = useState('');
  const [syncStatus, setSyncStatus] = useState<{ pending: number; lastSync: string | null }>({ pending: 0, lastSync: null });
  const [signalrStatus, setSignalrStatus] = useState<string>('未连接');
  const { settings, setSettings } = useSettingsStore();
  const { appendLog, hydrateLogs } = useLogStore();
  const { activeProjectId, setWorkspace, resetWorkspace } = useProjectStore();
  const { pendingReviewTaskId, clearPendingReviewTaskId, setPendingReviewTaskId, setPendingLensId } = useDirectorNavigationStore();
  const { resetLensList } = useLensStore();
  const { setTasks, upsertTask } = useTaskStore();
  const visibleNavigationItems = useMemo(() => getVisibleNavigationItems(user), [user]);
  const roleLabel = getRoleLabel(user?.roles?.[0]);
  const primaryRole = getPrimaryRole(user);
  const defaultPage = useMemo<AppPage>(() => {
    if (primaryRole === 'director') {
      return 'dashboard';
    }

    return primaryRole === 'maker' ? 'dashboard' : 'projects';
  }, [primaryRole]);

  const refreshSignalRConnection = useCallback(async (): Promise<void> => {
    await disconnectSignalR();
    await connectSignalR();
  }, []);

  const refreshApiHealth = useCallback(async (): Promise<void> => {
    setApiStatus('checking');
    setApiMessage('');

    try {
      await apiClient.healthCheck(runtimeConfig.healthPath);
      setApiStatus('online');
    } catch (error) {
      setApiStatus('offline');
      setApiMessage(error instanceof Error ? error.message : '服务端不可达。');
    }
  }, [runtimeConfig.healthPath]);

  const refreshEnvironmentStatus = useCallback(async (): Promise<void> => {
    if (!movtoolsBridge?.settings) {
      setEnvironmentLoading(false);
      setEnvironmentStatus(null);
      return;
    }

    setEnvironmentLoading(true);
    try {
      const status = await movtoolsBridge.settings.status();
      setEnvironmentStatus(status);
    } finally {
      setEnvironmentLoading(false);
    }
  }, [movtoolsBridge?.settings]);

  useEffect(() => {
    void bootstrap();
    void refreshApiHealth();
    
    // 初始化同步管理器
    void initializeSyncManager();
    
    // 监听同步状态
    const updateSyncStatus = () => {
      const state = getSyncManagerState();
      setSyncStatus({
        pending: state.pendingCount,
        lastSync: state.lastSyncTime,
      });
    };
    
    // 监听 SignalR 状态
    const unsubscribeSignalR = onSignalRStatusChange((status) => {
      setSignalrStatus(status === 'connected' ? '已连接' : status === 'connecting' ? '连接中...' : '未连接');
    });
    
    // 定期更新同步状态
    const syncInterval = setInterval(updateSyncStatus, 10000);
    updateSyncStatus();
    
    return () => {
      clearInterval(syncInterval);
      unsubscribeSignalR();
    };
  }, [bootstrap, refreshApiHealth]);

  const applyServerBaseUrl = useCallback(async (nextBaseUrl: string): Promise<{ success: boolean; error?: string; normalized?: string }> => {
    const validation = validateServerBaseUrl(nextBaseUrl);
    if (!validation.success || !validation.normalized) {
      return { success: false, error: validation.error };
    }

    const normalized = validation.normalized;
    try {
      setRuntimeServerBaseUrl(normalized);
      updateApiClientBaseUrl(normalized);

      await refreshSignalRConnection();
      void refreshApiHealth();
      void refreshEnvironmentStatus();

      return { success: true, normalized };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '服务端地址应用失败。' };
    }
  }, [refreshApiHealth, refreshEnvironmentStatus, refreshSignalRConnection]);

  const handleServerBaseUrlSave = useCallback(async (nextBaseUrl: string): Promise<{ success: boolean; error?: string; normalized?: string }> => {
    try {
      const validation = validateServerBaseUrl(nextBaseUrl);
      if (!validation.success || !validation.normalized) {
        return { success: false, error: validation.error };
      }

      const normalized = validation.normalized;

      if (movtoolsBridge?.settings) {
        const savedSettings = await movtoolsBridge.settings.update({ serverBaseUrl: normalized });
        setSettings(savedSettings);
        void applyServerBaseUrl(savedSettings.serverBaseUrl);
        return { success: true, normalized: savedSettings.serverBaseUrl };
      }

      setSettings({ ...settings, serverBaseUrl: normalized });
      return applyServerBaseUrl(normalized);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '保存服务端地址失败。' };
    }
  }, [applyServerBaseUrl, movtoolsBridge?.settings, setSettings, settings]);

  const handleServerBaseUrlRestoreDefault = useCallback(async (): Promise<{ success: boolean; error?: string; normalized?: string }> => {
    return handleServerBaseUrlSave(DEFAULT_SERVER_BASE_URL);
  }, [handleServerBaseUrlSave]);

  useEffect(() => {
    if (authStatus === 'authenticated') {
      setPage(defaultPage);
      void (async () => {
        try {
          const workspace = await projectService.getWorkspace();
          if (workspace.activeProjectId) {
            const activated = await projectService.setActiveProject(workspace.activeProjectId);
            if (activated.workspace) {
              setWorkspace(activated.workspace);
              return;
            }
          }

          setWorkspace(workspace);
        } catch (error) {
          console.error('刷新项目工作区失败：', error);
          resetWorkspace();
        }
      })();
      return;
    }

    if (authStatus === 'anonymous') {
      resetWorkspace();
      resetLensList();
    }
  }, [authStatus, defaultPage, movtoolsBridge?.project, resetLensList, resetWorkspace, setWorkspace]);

  function dismissFirstLaunchGuide(): void {
    window.localStorage.setItem(firstLaunchGuideStorageKey, '1');
    setShowFirstLaunchGuide(false);
  }

  async function handleLogin(credentials: { username: string; password: string }): Promise<void> {
    clearError();
    await login(credentials);
  }

  async function handleOpenManual(manual: 'usage' | 'testing'): Promise<void> {
    if (!movtoolsBridge?.dialog?.openManual) {
      window.alert('当前运行环境不支持打开本地文档。');
      return;
    }

    const result = await movtoolsBridge.dialog.openManual(manual);
    if (!result.success) {
      window.alert(result.error ?? '打开说明文档失败。');
    }
  }

  useEffect(() => {
    if (!movtoolsBridge?.settings) {
      return;
    }

    void movtoolsBridge.settings.get().then((nextSettings) => {
      setSettings(nextSettings);
      void applyServerBaseUrl(nextSettings.serverBaseUrl);
    });
    void movtoolsBridge.app.getInfo().then(setAppInfo);

    const disposeUpdated = movtoolsBridge.task.onUpdated(({ task }) => {
      upsertTask(task);
    });

    const disposeLogs = movtoolsBridge.task.onLogAppended(({ taskId, chunk }) => {
      appendLog(taskId, chunk.trimEnd());
    });

    void movtoolsBridge.task.list().then(setTasks);
    void movtoolsBridge.task.listLogs().then(({ logs }) => hydrateLogs(logs));

    return () => {
      disposeUpdated();
      disposeLogs();
    };
  }, [appendLog, applyServerBaseUrl, hydrateLogs, refreshApiHealth, refreshEnvironmentStatus, setSettings, setTasks, upsertTask]);

  useEffect(() => {
    void refreshEnvironmentStatus();
  }, [refreshEnvironmentStatus, settings.defaultOutputDir, settings.ffmpegPath, settings.ffprobePath, settings.serverBaseUrl]);

  useEffect(() => {
    if (showFirstLaunchGuide) {
      setPage(primaryRole === 'maker' || primaryRole === 'director' ? 'dashboard' : 'settings');
    }
  }, [primaryRole, showFirstLaunchGuide]);

  useEffect(() => {
    if (authStatus === 'authenticated' && user) {
      const nextRole = user.roles?.[0]?.toLowerCase();
      if (nextRole === 'maker' || nextRole === 'director') {
        setPage('dashboard');
      }
    }
  }, [authStatus, user]);

  useEffect(() => {
    if (visibleNavigationItems.length > 0 && !visibleNavigationItems.some((item) => item.id === page)) {
      setPage(visibleNavigationItems[0].id as AppPage);
    }
  }, [page, visibleNavigationItems]);

  const currentPage = useMemo(() => {
    if (page === 'dashboard') {
      if (primaryRole === 'director') {
        return (
          <DirectorDashboardPage
            onOpenLens={(lensId) => {
              if (lensId) {
                setPendingLensId(lensId);
              }
              setPage('lens');
            }}
            onOpenReviewTask={(taskId) => {
              clearPendingReviewTaskId();
              setPendingReviewTaskId(taskId);
              setPage(primaryRole === 'director' ? 'review' : 'producer-review');
            }}
          />
        );
      }

      return <DashboardPage onOpenLens={() => setPage('lens')} />;
    }

    if (page === 'settings') {
      return (
        <SettingsPage
          appVersion={appInfo?.version ?? ''}
          environmentLoading={environmentLoading}
          environmentStatus={environmentStatus}
          onDismissFirstLaunchGuide={dismissFirstLaunchGuide}
          onOpenTestingManual={() => handleOpenManual('testing')}
          onOpenUsageManual={() => handleOpenManual('usage')}
          onRefreshEnvironmentStatus={refreshEnvironmentStatus}
          settings={settings}
          onSettingsSaved={setSettings}
          showFirstLaunchGuide={showFirstLaunchGuide}
        />
      );
    }

    if (page === 'projects') {
      return <ProjectPage onProjectReady={() => setPage('lens')} />;
    }

    if (page === 'file-check') {
      return <FileCheckPage />;
    }

    if (page === 'extract') {
      return <ExtractPage />;
    }

    if (page === 'lens') {
      return <LensPage onNavigate={(targetPage) => setPage(targetPage as AppPage)} />;
    }

    if (page === 'logs') {
      return <LogsPage />;
    }

    if (page === 'users') {
      return <UsersPage />;
    }

    if (page === 'producer-review') {
      return <ProducerTaskPage initialTaskId={pendingReviewTaskId} onOpenReviewTask={(taskId) => { setPendingReviewTaskId(taskId); setPage('producer-review' as AppPage); }} />;
    }

    if (page === 'review') {
      return (
        <PageErrorBoundary>
          <ReviewPage
            initialTaskId={pendingReviewTaskId}
            onOpenLens={(lensId) => {
              if (lensId) {
                setPendingLensId(lensId);
              }
              setPage('lens');
            }}
            onTaskOpened={clearPendingReviewTaskId}
          />
        </PageErrorBoundary>
      );
    }

    return (
      <HomePage
        environmentLoading={environmentLoading}
        environmentStatus={environmentStatus}
        onDismissFirstLaunchGuide={dismissFirstLaunchGuide}
        onOpenLogs={() => setPage('logs')}
        onOpenSettings={() => setPage('settings')}
        onOpenUsageManual={() => handleOpenManual('usage')}
        onRefreshEnvironmentStatus={refreshEnvironmentStatus}
        showFirstLaunchGuide={showFirstLaunchGuide}
      />
    );
  }, [
    appInfo,
    clearPendingReviewTaskId,
    dismissFirstLaunchGuide,
    environmentLoading,
    environmentStatus,
    handleOpenManual,
    page,
    pendingReviewTaskId,
    refreshEnvironmentStatus,
    primaryRole,
    setSettings,
    settings,
    showFirstLaunchGuide,
  ]);

  if (authStatus === 'loading') {
    return (
      <main className="auth-screen auth-screen--loading">
        <section className="auth-card auth-card--loading">
          <p className="eyebrow">协同客户端</p>
          <h1>正在恢复登录态…</h1>
          <p className="auth-copy">正在检查本地 token 与当前用户信息。</p>
        </section>
      </main>
    );
  }

  if (authStatus !== 'authenticated' || !user) {
    return (
      <LoginPage
        appName={runtimeConfig.appName}
        apiBaseUrl={runtimeConfig.apiBaseUrl}
        serverBaseUrl={settings.serverBaseUrl || normalizeServerBaseUrl(runtimeConfig.serverBaseUrl)}
        apiStatus={apiStatus}
        apiMessage={apiMessage}
        authStatus={authStatus}
        authError={authError}
        onLogin={handleLogin}
        onRetryApiCheck={refreshApiHealth}
        onServerBaseUrlSave={handleServerBaseUrlSave}
        onServerBaseUrlRestoreDefault={handleServerBaseUrlRestoreDefault}
      />
    );
  }

  if (!movtoolsBridge?.settings) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <p className="eyebrow">协同客户端</p>
          <h1>Electron 桥未就绪</h1>
          <p className="auth-copy">当前页面不是在 Electron 预加载环境中运行，局部本地能力已暂不可用。</p>
        </section>
      </main>
      );
  }

  const sidebarItems = visibleNavigationItems.filter((item) => {
    if (primaryRole === 'director') {
      return item.id === 'dashboard' || item.id === 'lens' || item.id === 'review';
    }

    if (primaryRole === 'maker') {
      return item.id === 'dashboard' || item.id === 'lens' || item.id === 'settings';
    }

    return true;
  });

  return (
    <div className={isSidebarCollapsed ? 'app-shell app-shell--sidebar-collapsed' : 'app-shell'}>
      <aside className={isSidebarCollapsed ? 'sidebar sidebar--collapsed app-sidebar' : 'sidebar app-sidebar'}>
        <div className="sidebar-header app-sidebar-header">
          <div className="sidebar-brand-block">
            <div className="sidebar-brand-mark" aria-hidden="true">
              <img alt="萌粒制片管理系统" className="sidebar-brand-image" src={brandIcon} />
            </div>
            <div>
              <p className="eyebrow">协同客户端</p>
              <h1>协同客户端</h1>
            </div>
          </div>
          <button
            aria-label={isSidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            className="sidebar-toggle"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            type="button"
          >
            {isSidebarCollapsed ? '»' : '«'}
          </button>
        </div>

        <div className="sidebar-status app-sidebar-user">
          <strong>{user.displayName}</strong>
          <small>{roleLabel}</small>
          <button className="ghost-button ghost-button--compact" onClick={logout} type="button">
            退出登录
          </button>
        </div>

        <div className={apiStatus === 'online' ? 'sidebar-status sidebar-status--success' : 'sidebar-status sidebar-status--warning'}>
          <strong>API {apiStatus === 'online' ? '在线' : apiStatus === 'offline' ? '离线' : '检测中'}</strong>
          <small>{apiStatus === 'offline' ? apiMessage || '服务端不可达。' : runtimeConfig.apiBaseUrl}</small>
        </div>

        <div className={syncStatus.pending > 0 ? 'sidebar-status sidebar-status--warning' : 'sidebar-status sidebar-status--success'}>
          <strong>同步 {syncStatus.pending > 0 ? `待处理(${syncStatus.pending})` : '已同步'}</strong>
          <small>SignalR: {signalrStatus}</small>
        </div>

        <div className="sidebar-status app-sidebar-status">
          <strong>{activeProjectId ? '已选择项目' : '未选择项目'}</strong>
          <small>{activeProjectId ? '可以继续进入后续镜头管理开发。' : '请先在“项目”页创建或打开本地项目。'}</small>
        </div>

        <nav className="nav-list app-sidebar-nav" aria-label="主导航">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              className={item.id === page ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(item.id)}
              title={isSidebarCollapsed ? `${item.label} · ${item.description}` : undefined}
              data-tooltip={isSidebarCollapsed ? item.label : undefined}
              type="button"
            >
              <span className="nav-item-index" aria-hidden="true">{navigationAccents[item.id]}</span>
              <span className="nav-item-label-group">
                <span>{item.label}</span>
                {!isSidebarCollapsed ? <small>{item.description}</small> : null}
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status app-sidebar-version">
          <strong>协同客户端</strong>
          <small>版本号：{appInfo?.version || '读取中…'}</small>
        </div>
      </aside>

      <main className="content app-content">{currentPage}</main>
    </div>
  );
}
