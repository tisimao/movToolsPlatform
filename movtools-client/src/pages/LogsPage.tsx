import { useMemo, useState } from 'react';
import { taskStatusLabels, taskTypeLabels } from '../lib/displayText';
import { LogViewer } from '../components/LogViewer';
import { useLogStore } from '../stores/logStore';
import { useTaskStore } from '../stores/taskStore';

/**
 * 日志页面组件
 * 用于查看和管理任务日志，支持选择任务、打开日志文件、导出日志等功能
 */
export function LogsPage() {
  const { tasks } = useTaskStore();
  const { logsByTaskId } = useLogStore();
  /**
   * 选中的任务ID状态和设置器
   * 存储当前选中的任务ID，用于显示对应任务的日志
   */
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');

  /**
   * 当前活动的任务ID
   * 如果有选中的任务则使用选中的任务ID，否则使用第一个任务的ID（如果存在）
   */
  const activeTaskId = selectedTaskId || tasks[0]?.id || '';
  /**
   * 日志行内容的备忘录
   * 根据活动任务ID获取对应的日志行，如果任务ID不存在则显示默认提示信息
   */
  const lines = useMemo(() => logsByTaskId[activeTaskId] ?? ['当前还没有日志。请先在工作台创建任务，再回来查看实时日志。'], [activeTaskId, logsByTaskId]);

  /**
   * 处理打开日志文件按钮点击事件
   * 调用后端服务打开当前选中任务的日志文件
   * @returns 无返回值
   */
  async function handleOpenLog(): Promise<void> {
    if (!activeTaskId) {
      return;
    }

    await window.movtools.task.openLog({ taskId: activeTaskId });
  }

  /**
   * 处理导出日志按钮点击事件
   * 调用后端服务导出当前选中任务的日志文件
   * @returns 无返回值
   */
  async function handleExportLog(): Promise<void> {
    if (!activeTaskId) {
      return;
    }

    await window.movtools.task.exportLog({ taskId: activeTaskId });
  }

  return (
    <section className="page-layout">
      <header className="page-header">
        <div>
          <p className="eyebrow">日志</p>
          <h2>任务日志与运行记录</h2>
          <div className="page-header-tags">
            <span className="page-header-tag">任务追踪</span>
            <span className="page-header-tag">运行输出</span>
            <span className="page-header-tag">日志留痕</span>
          </div>
        </div>
        <div className="actions-row compact-actions wrap-actions logs-page-actions">
          <button className="secondary-button" disabled={!activeTaskId} onClick={() => void handleOpenLog()} type="button">
            打开日志文件
          </button>
          <button className="secondary-button" disabled={!activeTaskId} onClick={() => void handleExportLog()} type="button">
            导出日志
          </button>
        </div>
      </header>

      <div className="panel-grid two-column logs-page-grid">
        <section className="panel stack-gap logs-task-panel">
          <div className="section-heading">
            <div>
              <h3>任务列表</h3>
              <div className="section-heading-tags">
                <span className="section-heading-tag">按任务查看</span>
              </div>
            </div>
            <span className="muted">共 {tasks.length} 项</span>
          </div>
          <div className="task-list logs-task-list">
            {tasks.length > 0 ? (
              tasks.map((task) => (
                <button
                  key={task.id}
                  className={task.id === activeTaskId ? 'nav-item active' : 'nav-item'}
                  onClick={() => setSelectedTaskId(task.id)}
                  type="button"
                >
                  <span>{taskTypeLabels[task.type]}</span>
                  <small>{taskStatusLabels[task.status]}</small>
                </button>
              ))
            ) : (
              <p className="muted">当前还没有任务。</p>
            )}
          </div>
        </section>

        <LogViewer lines={lines} />
      </div>
    </section>
  );
}
