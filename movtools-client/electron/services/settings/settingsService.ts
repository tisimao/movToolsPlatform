import { spawn } from 'node:child_process';
import { app } from 'electron';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppSettings, EnvironmentStatus, SettingsValidationResult, UpdateSettingsRequest } from '../../../src/types/ipc';
import { getBundledToolPath, resolveExecutablePath, validateExecutable } from '../runtime/runtimeResolver';
import { clearPreviewCache, pruneExpiredPreviewCache } from '../ffmpeg/videoPreviewService';
import { DEFAULT_SERVER_BASE_URL, normalizeServerBaseUrl, validateServerBaseUrl } from '../../../src/config/serverBaseUrl';

const defaultSettings: AppSettings = {
  serverBaseUrl: DEFAULT_SERVER_BASE_URL,
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  defaultOutputDir: '',
  autoOpenOutputDir: false,
  logRetentionDays: 7,
};

class SettingsService {
  private readonly settingsPath = path.join(app.getPath('userData'), 'settings.json');
  private readonly runtimeRoot = path.join(app.getPath('userData'), 'runtime-tools');
  private readonly autoInstallRoot = path.join(this.runtimeRoot, 'ffmpeg');
  private readonly downloadZipPath = path.join(this.runtimeRoot, 'ffmpeg-release-essentials.zip');
  private setupState: EnvironmentStatus['setupState'] = 'idle';
  private setupMessage = '启动时会自动检测 FFmpeg 和 FFprobe。';
  private runtimeSetupPromise: Promise<AppSettings> | null = null;

  async getSettings(): Promise<AppSettings> {
    void pruneExpiredPreviewCache();
    const storedSettings = await this.readStoredSettings();
    return this.ensureRuntimeDependencies(storedSettings);
  }

  async updateSettings(request: UpdateSettingsRequest): Promise<AppSettings> {
    const nextSettings = {
      ...(await this.readStoredSettings()),
      ...request,
    };

    if (typeof nextSettings.serverBaseUrl === 'string') {
      const validation = validateServerBaseUrl(nextSettings.serverBaseUrl);
      if (!validation.success || !validation.normalized) {
        throw new Error(validation.error ?? '服务端地址无效。');
      }
      nextSettings.serverBaseUrl = validation.normalized;
    }

    await this.writeSettings(nextSettings);
    this.runtimeSetupPromise = null;

    return nextSettings;
  }

  async validateSettings(request: UpdateSettingsRequest): Promise<SettingsValidationResult> {
    const nextSettings = {
      ...(await this.getSettings()),
      ...request,
    };

    const ffmpegResult = await validateExecutable(nextSettings.ffmpegPath, ['-version']);
    if (!ffmpegResult.success) {
      return {
        success: false,
        error: `FFmpeg 路径无效：${ffmpegResult.error}`,
      };
    }

    const ffprobeResult = await validateExecutable(nextSettings.ffprobePath, ['-version']);
    if (!ffprobeResult.success) {
      return {
        success: false,
        error: `FFprobe 路径无效：${ffprobeResult.error}`,
      };
    }

    return { success: true };
  }

  async getEnvironmentStatus(): Promise<EnvironmentStatus> {
    const settings = await this.getSettings();
    const ffmpeg = await validateExecutable(settings.ffmpegPath, ['-version']);
    const ffprobe = await validateExecutable(settings.ffprobePath, ['-version']);
    const hasDefaultOutputDir = settings.defaultOutputDir.trim().length > 0;
    const defaultOutputDirStatus = hasDefaultOutputDir
      ? await validateDirectoryWritable(settings.defaultOutputDir)
      : { writable: false, error: undefined };
    const recommendations: string[] = [];

    if (!ffmpeg.success) {
      recommendations.push('请先在设置页中配置有效的 FFmpeg 路径，再开始执行媒体任务。');
    }

    if (!ffprobe.success) {
      recommendations.push('请先在设置页中配置有效的 FFprobe 路径，这样时长和进度解析才会正常工作。');
    }

    if (!hasDefaultOutputDir) {
      recommendations.push('建议设置默认输出目录，这样每次测试时就不用重复选择文件夹。');
    } else if (!defaultOutputDirStatus.writable) {
      recommendations.push('默认输出目录当前不可写，请改为当前账号可写的本地目录。');
    }

    return {
      isReady: ffmpeg.success && ffprobe.success && defaultOutputDirStatus.writable,
      ffmpeg: {
        path: settings.ffmpegPath,
        available: ffmpeg.success,
        error: ffmpeg.error,
      },
      ffprobe: {
        path: settings.ffprobePath,
        available: ffprobe.success,
        error: ffprobe.error,
      },
      hasDefaultOutputDir,
      defaultOutputDir: settings.defaultOutputDir,
      defaultOutputDirWritable: hasDefaultOutputDir ? defaultOutputDirStatus.writable : false,
      defaultOutputDirError: defaultOutputDirStatus.error,
      recommendations,
      setupState: this.setupState,
      setupMessage: this.setupMessage,
    };
  }

  async clearPreviewCache(): Promise<{ success: boolean; removedFileCount: number; error?: string }> {
    try {
      const result = await clearPreviewCache();
      return {
        success: true,
        removedFileCount: result.removedFileCount,
      };
    } catch (error) {
      return {
        success: false,
        removedFileCount: 0,
        error: error instanceof Error ? error.message : '清理预览缓存失败。',
      };
    }
  }

  private async readStoredSettings(): Promise<AppSettings> {
    try {
      const content = await readFile(this.settingsPath, 'utf8');
      const parsed = JSON.parse(content) as Partial<AppSettings>;
      return {
        ...defaultSettings,
        ...parsed,
        serverBaseUrl: normalizeServerBaseUrl(parsed.serverBaseUrl || defaultSettings.serverBaseUrl),
      };
    } catch {
      return defaultSettings;
    }
  }

  private async writeSettings(settings: AppSettings): Promise<void> {
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  private async ensureRuntimeDependencies(settings: AppSettings): Promise<AppSettings> {
    if (this.runtimeSetupPromise) {
      return this.runtimeSetupPromise;
    }

    this.runtimeSetupPromise = this.ensureRuntimeDependenciesInner(settings).finally(() => {
      this.runtimeSetupPromise = null;
    });

    return this.runtimeSetupPromise;
  }

  private async ensureRuntimeDependenciesInner(settings: AppSettings): Promise<AppSettings> {
    const nextSettings = { ...settings };
    this.setupState = 'idle';
    this.setupMessage = '正在检查 FFmpeg 和 FFprobe 环境。';

    const detectedPaths = await detectRuntimePaths(nextSettings.ffmpegPath, nextSettings.ffprobePath, this.autoInstallRoot);
    if (detectedPaths.ffmpegPath && detectedPaths.ffprobePath) {
      const finalSettings = {
        ...nextSettings,
        ffmpegPath: detectedPaths.ffmpegPath,
        ffprobePath: detectedPaths.ffprobePath,
      } satisfies AppSettings;

      if (finalSettings.ffmpegPath !== settings.ffmpegPath || finalSettings.ffprobePath !== settings.ffprobePath) {
        await this.writeSettings(finalSettings);
      }

      this.setupState = 'detected';
      this.setupMessage = '已自动识别到内置或系统 FFmpeg/FFprobe，可直接开始使用。';
      return finalSettings;
    }

    if (process.platform !== 'win32') {
      this.setupState = 'failed';
      this.setupMessage = '当前仅对 Windows 自动安装 FFmpeg/FFprobe，其它系统请手动配置。';
      return nextSettings;
    }

    this.setupState = 'installing';
    this.setupMessage = '未检测到 FFmpeg/FFprobe，正在自动下载安装便携版工具...';

    try {
      const installedPaths = await installPortableFfmpegBundle(this.runtimeRoot, this.autoInstallRoot, this.downloadZipPath);
      const finalSettings = {
        ...nextSettings,
        ffmpegPath: installedPaths.ffmpegPath,
        ffprobePath: installedPaths.ffprobePath,
      } satisfies AppSettings;

      await this.writeSettings(finalSettings);
      this.setupState = 'installed';
      this.setupMessage = '已自动安装 FFmpeg/FFprobe 到应用运行目录，并完成路径配置。';
      return finalSettings;
    } catch (error) {
      this.setupState = 'failed';
      this.setupMessage = `自动安装 FFmpeg/FFprobe 失败：${error instanceof Error ? error.message : '未知错误'}`;
      return nextSettings;
    }
  }
}

export const settingsService = new SettingsService();

async function detectRuntimePaths(ffmpegPath: string, ffprobePath: string, autoInstallRoot: string): Promise<{ ffmpegPath: string | null; ffprobePath: string | null }> {
  const detectedFfmpegPath = await resolveExecutablePath({
    commandName: 'ffmpeg',
    validationArgs: ['-version'],
    candidates: [
      ffmpegPath,
      getBundledToolPath('ffmpeg', 'bin', executableName('ffmpeg')),
      path.join(autoInstallRoot, 'bin', executableName('ffmpeg')),
      ...commonExecutableCandidates('ffmpeg'),
    ],
  });
  const detectedFfprobePath = await resolveExecutablePath({
    commandName: 'ffprobe',
    validationArgs: ['-version'],
    candidates: [
      ffprobePath,
      getBundledToolPath('ffmpeg', 'bin', executableName('ffprobe')),
      path.join(autoInstallRoot, 'bin', executableName('ffprobe')),
      ...commonExecutableCandidates('ffprobe'),
    ],
  });

  return {
    ffmpegPath: detectedFfmpegPath,
    ffprobePath: detectedFfprobePath,
  };
}

async function installPortableFfmpegBundle(runtimeRoot: string, installRoot: string, zipPath: string): Promise<{ ffmpegPath: string; ffprobePath: string }> {
  await mkdir(runtimeRoot, { recursive: true });
  await rm(installRoot, { recursive: true, force: true });

  const response = await fetch('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip');
  if (!response.ok) {
    throw new Error(`下载失败（HTTP ${response.status}）`);
  }

  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  await writeFile(zipPath, archiveBuffer);

  const extractCommand = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Expand-Archive -Path '${windowsSafePath(zipPath)}' -DestinationPath '${windowsSafePath(installRoot)}' -Force`,
  ];

  const extractResult = await runCommand('powershell', extractCommand);
  if (!extractResult.success) {
    throw new Error(extractResult.stderr || '解压 FFmpeg 压缩包失败。');
  }

  const ffmpegPath = await findFileRecursively(installRoot, executableName('ffmpeg'));
  const ffprobePath = await findFileRecursively(installRoot, executableName('ffprobe'));

  if (!ffmpegPath || !ffprobePath) {
    throw new Error('自动安装完成后仍未找到 ffmpeg.exe 或 ffprobe.exe。');
  }

  const ffmpegValidation = await validateExecutable(ffmpegPath, ['-version']);
  const ffprobeValidation = await validateExecutable(ffprobePath, ['-version']);
  if (!ffmpegValidation.success || !ffprobeValidation.success) {
    throw new Error('自动安装后的 FFmpeg/FFprobe 无法正常执行。');
  }

  return { ffmpegPath, ffprobePath };
}

async function findFileRecursively(rootDir: string, fileName: string): Promise<string | null> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return entryPath;
    }

    if (entry.isDirectory()) {
      const nested = await findFileRecursively(entryPath, fileName);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function commonExecutableCandidates(commandName: 'ffmpeg' | 'ffprobe'): string[] {
  if (process.platform !== 'win32') {
    return [];
  }

  return [
    path.join('C:\\ffmpeg\\bin', executableName(commandName)),
    path.join('D:\\ffmpeg\\bin', executableName(commandName)),
    path.join('D:\\ComfyUI3.12windows-portable\\python_embeded\\Scripts', executableName(commandName)),
  ];
}

function executableName(commandName: string): string {
  return process.platform === 'win32' ? `${commandName}.exe` : commandName;
}

function windowsSafePath(value: string): string {
  return value.replace(/'/g, "''");
}

async function validateDirectoryWritable(directoryPath: string): Promise<{ writable: boolean; error?: string }> {
  try {
    await access(directoryPath, fsConstants.W_OK);
    return { writable: true };
  } catch (error) {
    return { writable: false, error: error instanceof Error ? error.message : '目录不可写' };
  }
}

async function runCommand(command: string, args: string[]): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({ success: false, stdout, stderr: error.message });
    });

    child.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr });
    });
  });
}
