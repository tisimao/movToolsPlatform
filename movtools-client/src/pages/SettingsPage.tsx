import { useEffect, useState } from 'react';
import { EnvironmentStatusCard } from '../components/EnvironmentStatusCard';
import type { AppSettings, EnvironmentStatus } from '../types/ipc';
import { PathMappingPage } from './PathMappingPage';

/**
 * 设置页面属性接口
 */
interface SettingsPageProps {
  /** 应用版本号 */
  appVersion: string;
  /** 环境状态加载中标志 */
  environmentLoading: boolean;
  /** 环境状态对象，可能为null */
  environmentStatus: EnvironmentStatus | null;
  /** 关闭首次启动引导的回调函数 */
  onDismissFirstLaunchGuide: () => void;
  /** 打开测试说明的回调函数 */
  onOpenTestingManual: () => Promise<void>;
  /** 打开使用说明的回调函数 */
  onOpenUsageManual: () => Promise<void>;
  /** 刷新环境状态的回调函数 */
  onRefreshEnvironmentStatus: () => Promise<void>;
  /** 当前应用设置 */
  settings: AppSettings;
  /** 设置保存后的回调函数 */
  onSettingsSaved: (settings: AppSettings) => void;
  /** 是否显示首次启动引导 */
  showFirstLaunchGuide: boolean;
}

/**
 * 设置页面组件
 * 提供运行环境配置界面，包括FFmpeg路径、FFprobe路径、默认输出目录等设置
 */
export function SettingsPage({
  appVersion,
  environmentLoading,
  environmentStatus,
  onDismissFirstLaunchGuide,
  onOpenTestingManual,
  onOpenUsageManual,
  onRefreshEnvironmentStatus,
  settings,
  onSettingsSaved,
  showFirstLaunchGuide,
}: SettingsPageProps) {
  /**
   * 草稿状态和设置器
   * 用于存储用户编辑中的设置数据，初始值为传入的settings
   */
  const [draft, setDraft] = useState<AppSettings>(settings);
  /**
   * 消息状态和设置器
   * 用于显示操作结果或提示信息
   */
  const [message, setMessage] = useState('设置会保存到 Electron 的 userData/settings.json 中。');
  /**
   * 是否正在清理预览缓存的状态和设置器
   * 表示组件正在执行清理预览缓存的操作
   */
  const [isClearingPreviewCache, setIsClearingPreviewCache] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);

  /**
   * 当settings属性变化时，更新草稿状态
   * 确保当外部设置更新时，草稿也能同步更新
   */
  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  /**
   * 处理选择FFmpeg路径按钮点击事件
   * 打开文件选择对话框让用户选择FFmpeg可执行文件，然后更新草稿中的ffmpegPath
   * @returns 无返回值
   */
  async function handlePickFfmpegPath(): Promise<void> {
    const filePath = await window.movtools.dialog.pickFile();
    if (filePath) {
      setDraft({ ...draft, ffmpegPath: filePath });
    }
  }

  /**
   * 处理选择FFprobe路径按钮点击事件
   * 打开文件选择对话框让用户选择FFprobe可执行文件，然后更新草稿中的ffprobePath
   * @returns 无返回值
   */
  async function handlePickFfprobePath(): Promise<void> {
    const filePath = await window.movtools.dialog.pickFile();
    if (filePath) {
      setDraft({ ...draft, ffprobePath: filePath });
    }
  }

  /**
   * 处理选择默认输出目录按钮点击事件
   * 打开目录选择对话框让用户选择默认输出目录，然后更新草稿中的defaultOutputDir
   * @returns 无返回值
   */
  async function handlePickDefaultOutputDirectory(): Promise<void> {
    const directoryPath = await window.movtools.dialog.pickDirectory();
    if (directoryPath) {
      setDraft({ ...draft, defaultOutputDir: directoryPath });
    }
  }

  /**
   * 处理保存设置按钮点击事件
   * 校验FFmpeg和FFprobe路径，校验通过后保存设置并刷新环境状态
   * @returns 无返回值
   */
  async function handleSave(): Promise<void> {
    setMessage('正在校验 FFmpeg 和 FFprobe 路径...');
    const validationResult = await window.movtools.settings.validate(draft);
    if (!validationResult.success) {
      setMessage(validationResult.error ?? '设置校验失败。');
      return;
    }

    const nextSettings = await window.movtools.settings.update(draft);
    onSettingsSaved(nextSettings);
    setDraft(nextSettings);
    await onRefreshEnvironmentStatus();
    setMessage('设置已保存。');
  }

  /**
   * 处理清理预览缓存按钮点击事件
   * 调用后端服务清理预览缓存，并根据结果更新消息
   * @returns 无返回值
   */
  async function handleClearPreviewCache(): Promise<void> {
    setIsClearingPreviewCache(true);
    setMessage('正在清理预览缓存...');
    try {
      const result = await window.movtools.settings.clearPreviewCache();
      if (!result.success) {
        setMessage(result.error ?? '预览缓存清理失败。');
        return;
      }

      setMessage(result.removedFileCount > 0 ? `预览缓存已清理，共删除 ${result.removedFileCount} 项。` : '预览缓存已是空的。');
    } finally {
      setIsClearingPreviewCache(false);
    }
  }

  return (
    <section className="page-layout">
      <header className="page-header">
        <div>
          <p className="eyebrow">设置</p>
          <h2>运行环境配置</h2>
        </div>
        <div className="page-header-actions">
          <p className="muted">这里的配置会持久化保存，安装完成后的第一次启动建议先完成一次自检。当前版本：{appVersion || '读取中…'}</p>
          <div className="actions-row compact-actions wrap-actions">
            <button className="secondary-button" onClick={() => void onOpenUsageManual()} type="button">安装使用说明</button>
            <button className="secondary-button" onClick={() => void onOpenTestingManual()} type="button">测试说明</button>
          </div>
        </div>
      </header>

      <EnvironmentStatusCard
        isLoading={environmentLoading}
        onDismissGuide={onDismissFirstLaunchGuide}
        onOpenUsageManual={onOpenUsageManual}
        onRefresh={onRefreshEnvironmentStatus}
        showFirstLaunchGuide={showFirstLaunchGuide}
        status={environmentStatus}
      />

      <div className="panel stack-gap narrow-panel settings-form-panel">
        <label className="field">
          <span>FFmpeg 路径</span>
          <div className="picker-row">
            <input value={draft.ffmpegPath} onChange={(event) => setDraft({ ...draft, ffmpegPath: event.target.value })} />
            <button className="secondary-button" onClick={() => void handlePickFfmpegPath()} type="button">
              浏览
            </button>
          </div>
        </label>
        <label className="field">
          <span>FFprobe 路径</span>
          <div className="picker-row">
            <input value={draft.ffprobePath} onChange={(event) => setDraft({ ...draft, ffprobePath: event.target.value })} />
            <button className="secondary-button" onClick={() => void handlePickFfprobePath()} type="button">
              浏览
            </button>
          </div>
        </label>
        <label className="field">
          <span>默认输出目录</span>
          <div className="picker-row">
            <input value={draft.defaultOutputDir} onChange={(event) => setDraft({ ...draft, defaultOutputDir: event.target.value })} />
            <button className="secondary-button" onClick={() => void handlePickDefaultOutputDirectory()} type="button">
              浏览
            </button>
          </div>
        </label>
        <label className="checkbox-field">
          <input checked={draft.autoOpenOutputDir} onChange={(event) => setDraft({ ...draft, autoOpenOutputDir: event.target.checked })} type="checkbox" />
          <span>任务完成后自动打开输出目录</span>
        </label>
        <label className="field">
          <span>日志保留天数</span>
          <input
            min={1}
            onChange={(event) => setDraft({ ...draft, logRetentionDays: Number(event.target.value) || 1 })}
            type="number"
            value={draft.logRetentionDays}
          />
        </label>

        <div className="actions-row wrap-actions settings-form-actions">
          <button className="primary-button" onClick={() => void handleSave()} type="button">
            保存设置
          </button>
          <button className="secondary-button" disabled={isClearingPreviewCache} onClick={() => void handleClearPreviewCache()} type="button">
            {isClearingPreviewCache ? '清理中…' : '清理预览缓存'}
          </button>
          <span className="muted">{message}</span>
        </div>
      </div>

      <section className="panel stack-gap">
        <div className="section-heading">
          <div>
            <h3>高级功能</h3>
            <p className="muted">包含路径映射等较少使用的本机能力。</p>
          </div>
          <button className="secondary-button" onClick={() => setShowAdvancedTools((current) => !current)} type="button">
            {showAdvancedTools ? '隐藏' : '展开'}
          </button>
        </div>
        {showAdvancedTools ? <PathMappingPage embedded={true} /> : <p className="muted">默认隐藏，按需展开。</p>}
      </section>
    </section>
  );
}
