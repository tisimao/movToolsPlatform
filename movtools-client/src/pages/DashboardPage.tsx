import { useEffect, useMemo, useState } from 'react';
import { getRoleLabel } from '../auth/permissions';
import { useAuthStore } from '../auth/store';
import { lensService, projectService } from '../services/repositoryService';
import { useLensStore } from '../stores/lensStore';
import { useProjectStore } from '../stores/projectStore';

interface DashboardPageProps {
  onOpenLens: () => void;
}

export function DashboardPage({ onOpenLens }: DashboardPageProps) {
  const { user } = useAuthStore();
  const { projects, activeProjectId, activeEpisodeId, setWorkspace } = useProjectStore();
  const { lenses, activeEpisodeName, setLensList } = useLensStore();
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingLenses, setLoadingLenses] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualActivationProjectId, setManualActivationProjectId] = useState<string | null>(null);
  const [manualProjectRootPath, setManualProjectRootPath] = useState('');
  const [manualLensRootPath, setManualLensRootPath] = useState('');
  const [manualLayoutRootPath, setManualLayoutRootPath] = useState('');

  const activeProject = useMemo(() => projects.find((item) => item.projectId === activeProjectId) ?? null, [activeProjectId, projects]);
  const accessibleProjects = projects;
  const myLenses = useMemo(() => {
    if (!user) return [];
    return lenses.filter((lens) => {
      return lens.makerUserId?.trim().toLowerCase() === user.id.toLowerCase();
    });
  }, [lenses, user]);

  const lensSummary = useMemo(() => ({
    total: myLenses.length,
    制作: myLenses.filter((lens) => lens.lensStatus === '制作').length,
    提交: myLenses.filter((lens) => lens.lensStatus === '提交').length,
    返修: myLenses.filter((lens) => lens.lensStatus === '返修').length,
    通过: myLenses.filter((lens) => lens.lensStatus === '通过').length,
    关闭: myLenses.filter((lens) => lens.lensStatus === '关闭').length,
  }), [myLenses]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingProjects(true);
      try {
        const workspace = await projectService.getWorkspace();
        if (cancelled) return;
        setWorkspace(workspace);
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? `刷新工作区失败：${error.message}` : '刷新工作区失败。');
      } finally {
        if (cancelled) return;
        setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setWorkspace]);

  useEffect(() => {
    let cancelled = false;
    if (!activeProjectId || !activeEpisodeId) {
      return;
    }

    void (async () => {
      setLoadingLenses(true);
      try {
        const response = await lensService.listLenses();
        if (cancelled) return;
        if (!response.success) {
          setMessage(response.error ?? '加载镜头失败。');
          setLensList({ ...response, lenses: [] });
          return;
        }

        setLensList(response);
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? `加载镜头失败：${error.message}` : '加载镜头失败。');
      } finally {
        if (cancelled) return;
        setLoadingLenses(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEpisodeId, activeProjectId, setLensList]);

  async function handleActivateProject(
    projectId: string,
    options?: { projectRootPath?: string; lensFolderRootPath?: string; layoutCheckPath?: string },
  ): Promise<void> {
    setMessage(null);
    setLoadingProjects(true);
    try {
      const response = await projectService.setActiveProject(projectId, options);
      if (!response.success || !response.workspace) {
        setMessage(response.error ?? '激活项目失败。请重选项目根目录后重试。');
        setManualActivationProjectId(projectId);
        return;
      }

      setWorkspace(response.workspace);
      setManualActivationProjectId(null);
      setManualProjectRootPath('');
      setManualLensRootPath('');
      setManualLayoutRootPath('');
      const lensResponse = await lensService.listLenses();
      if (!lensResponse.success) {
        setMessage(lensResponse.error ?? '项目已激活，但镜头加载失败。');
        setLensList({ ...lensResponse, lenses: [] });
        return;
      }

      setLensList(lensResponse);
      setMessage('项目已激活。');
    } finally {
      setLoadingProjects(false);
    }
  }

  async function handlePickManualActivationPath(target: 'project' | 'lens' | 'layout'): Promise<void> {
    const selected = await window.movtools.dialog.pickDirectory();
    if (!selected) {
      return;
    }

    switch (target) {
      case 'project':
        setManualProjectRootPath(selected);
        break;
      case 'lens':
        setManualLensRootPath(selected);
        break;
      case 'layout':
        setManualLayoutRootPath(selected);
        break;
    }
  }

  return (
    <div className="page-layout stack-gap dashboard-page">
      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">仪表盘</p>
          <h2>仪表盘</h2>
          <p className="muted">这里汇总你能访问的项目、当前激活上下文和本人镜头概览。</p>
        </div>
        <div className="actions-row compact-actions wrap-actions">
          <button className="secondary-button" onClick={onOpenLens} type="button">前往镜头页</button>
        </div>
      </header>

      {message ? <div className="workbench-result-card"><span>{message}</span></div> : null}

      <section className="panel dashboard-summary-grid">
        <article className="dashboard-metric-card">
          <span className="lens-summary-label">可访问项目</span>
          <strong>{accessibleProjects.length}</strong>
          <small className="muted">{loadingProjects ? '正在刷新…' : '来自当前工作区数据'}</small>
        </article>
        <article className="dashboard-metric-card">
          <span className="lens-summary-label">当前激活项目</span>
          <strong>{activeProject?.projectName ?? '未激活'}</strong>
          <small className="muted">{activeEpisodeName || '暂无激活集'}</small>
        </article>
        <article className="dashboard-metric-card">
          <span className="lens-summary-label">我的镜头</span>
          <strong>{lensSummary.total}</strong>
            <small className="muted">{loadingLenses ? '正在加载镜头…' : `制作 ${lensSummary.制作} · 提交 ${lensSummary.提交} · 返修 ${lensSummary.返修}`}</small>
        </article>
      </section>

      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>我可访问的项目</h3>
            <p className="muted">点击“激活”会沿用现有项目激活链路，并同步刷新当前工作区。</p>
          </div>
        </div>
        <div className="dashboard-project-grid">
          {accessibleProjects.length === 0 ? (
            <p className="muted">当前没有可访问项目。</p>
          ) : accessibleProjects.map((project) => {
            const isActive = project.projectId === activeProjectId;
            const isManualActivationTarget = manualActivationProjectId === project.projectId;
            return (
                <article className={isActive ? 'project-card dashboard-project-card is-active' : 'project-card dashboard-project-card'} key={project.projectId}>
                  <div className="section-heading">
                    <div>
                      <h4>{project.projectName}</h4>
                      <p className="muted">主路径：{project.projectRootPath || '未配置'}</p>
                    </div>
                    <span className={isActive ? 'environment-pill ready' : 'environment-pill info'}>{isActive ? '当前激活' : '可激活'}</span>
                  </div>
                <small className="muted">镜头根：{project.lensFolderRootPath || '未配置'} · Layout 根：{project.layoutCheckPath || '未配置'}</small>
                <small className="muted">镜头文件根目录：{project.lensRoots?.length ?? 0} 个 · Layout 根目录：{project.layoutRoots?.length ?? 0} 个</small>
                <small className="muted">版本 {project.versionTag ?? 'ANI'} · Layout {project.layoutTag ?? 'LAY'}</small>
                <div className="actions-row compact-actions wrap-actions">
                  <button className="secondary-button" disabled={isActive || loadingProjects} onClick={() => void handleActivateProject(project.projectId)} type="button">
                    {isActive ? '已激活' : '激活项目'}
                  </button>
                </div>
                {isManualActivationTarget ? (
                  <div className="stack-gap compact-gap" style={{ marginTop: '0.75rem' }}>
                    <small className="muted">激活失败时，请指定本机路径。镜头文件根目录和 Layout 根目录为可选，不填则自动按项目根目录盘符重映射。</small>
                    <label className="field">
                      <span>项目根目录（必填）</span>
                      <div className="inline-field-actions">
                        <input value={manualProjectRootPath} onChange={(event) => setManualProjectRootPath(event.target.value)} placeholder={project.projectRootPath || '手动选择本机项目根目录'} />
                        <button className="secondary-button" disabled={loadingProjects} onClick={() => void handlePickManualActivationPath('project')} type="button">选择</button>
                      </div>
                    </label>
                    <label className="field">
                      <span>镜头文件根目录（可选）</span>
                      <div className="inline-field-actions">
                        <input value={manualLensRootPath} onChange={(event) => setManualLensRootPath(event.target.value)} placeholder={project.lensFolderRootPath || '自动按项目根目录盘符重映射'} />
                        <button className="secondary-button" disabled={loadingProjects} onClick={() => void handlePickManualActivationPath('lens')} type="button">选择</button>
                      </div>
                    </label>
                    <label className="field">
                      <span>Layout 根目录（可选）</span>
                      <div className="inline-field-actions">
                        <input value={manualLayoutRootPath} onChange={(event) => setManualLayoutRootPath(event.target.value)} placeholder={project.layoutCheckPath || '自动按项目根目录盘符重映射'} />
                        <button className="secondary-button" disabled={loadingProjects} onClick={() => void handlePickManualActivationPath('layout')} type="button">选择</button>
                      </div>
                    </label>
                    <div className="actions-row compact-actions wrap-actions">
                      <button
                        className="primary-button"
                        disabled={loadingProjects || !manualProjectRootPath.trim()}
                        onClick={() => void handleActivateProject(project.projectId, {
                          projectRootPath: manualProjectRootPath,
                          lensFolderRootPath: manualLensRootPath || undefined,
                          layoutCheckPath: manualLayoutRootPath || undefined,
                        })}
                        type="button"
                      >
                        应用并重试
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>我的镜头概览</h3>
            <p className="muted">仅统计当前工作区中属于你的镜头。</p>
          </div>
        </div>
        <div className="dashboard-lens-summary-grid">
          {Object.entries(lensSummary).map(([label, value]) => (
            <article className="dashboard-metric-card dashboard-metric-card--compact" key={label}>
              <span className="lens-summary-label">{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>角色提示</h3>
            <p className="muted">当前登录角色：{user ? user.roles.map((role) => getRoleLabel(role)).join(' · ') : '未识别'}</p>
          </div>
        </div>
      </section>

      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>路径映射入口</h3>
            <p className="muted">如果需要把服务端逻辑路径映射到本机目录，请到“设置”页下的“高级功能”中打开。</p>
          </div>
        </div>
      </section>
    </div>
  );
}
