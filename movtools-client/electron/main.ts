/**
 * 萌粒制片管理系统 - Electron 主进程入口
 * 
 * 负责：
 * - 创建主窗口
 * - 注册所有 IPC 处理器
 * - 管理应用生命周期
 */
import { app, BrowserWindow, Menu, protocol } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// IPC 处理器注册
import { registerAppIpc } from './ipc/appIpc';
import { registerDialogIpc } from './ipc/dialogIpc';
import { registerExtractIpc } from './ipc/extractIpc';
import { registerFileIpc } from './ipc/fileIpc';
import { registerFileCheckIpc } from './ipc/fileCheckIpc';
import { registerLensIpc } from './ipc/lensIpc';
import { registerProjectIpc } from './ipc/projectIpc';
import { registerSettingsIpc } from './ipc/settingsIpc';
import { registerTaskIpc } from './ipc/taskIpc';

/** 获取当前模块的文件路径 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'movtools-preview',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function registerPreviewProtocol(): void {
  protocol.registerFileProtocol('movtools-preview', (request, callback) => {
    try {
      const url = new URL(request.url);
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        callback({ error: -6 });
        return;
      }

      callback({ path: filePath });
    } catch {
      callback({ error: -6 });
    }
  });
}

/**
 * 创建并返回主窗口
 * 配置窗口尺寸、预加载脚本和安全策略
 */
function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: '萌粒制片管理系统',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 开发环境加载 URL，生产环境加载本地 HTML
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return window;
}

// 应用准备完成后初始化
app.whenReady().then(() => {
  // 隐藏系统菜单栏
  Menu.setApplicationMenu(null);

  // 注册自定义预览协议
  registerPreviewProtocol();
  
  // 注册所有 IPC 处理器
  registerAppIpc();
  registerDialogIpc();
  registerExtractIpc();
  registerFileIpc();
  registerFileCheckIpc();
  registerLensIpc();
  registerProjectIpc();
  registerSettingsIpc();
  registerTaskIpc();
  
  // 创建主窗口
  createMainWindow();

  // macOS 激活时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// 所有窗口关闭时退出应用（非 macOS）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
