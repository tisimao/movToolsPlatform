import { randomUUID } from 'node:crypto';
import { app, shell } from 'electron';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { CreateTaskItem, MediaTask } from '../../../src/types/ipc';
import { ensureDirectoryExists, ensureFileExists, createAvailableOutputPath } from '../file/fileService';
import { startFfmpeg, stopFfmpeg, type FfmpegExecution } from '../ffmpeg/ffmpegService';
import { probeDuration } from '../ffmpeg/ffprobeService';
import { parseProgress } from '../ffmpeg/progressParser';
import { appendTaskLog } from '../log/logService';
import { settingsService } from '../settings/settingsService';
import { probeVideoMetadata } from '../ffmpeg/ffprobeService';
import { TaskStore } from './taskStore';
import { TaskRunner } from './taskRunner';

const taskTypeLabels = {
  'merge-video': '视频拼接',
  transcode: '视频转码',
  'extract-audio': '提取音频',
  trim: '视频裁剪',
  compress: '视频压缩',
  'export-frame': '导出画面',
} as const;

interface TaskQueueEvents {
  emitTaskUpdated(task: MediaTask): void;
  emitTaskLog(taskId: string, chunk: string): void;
}

export class TaskQueue {
  private readonly store = new TaskStore();
  private readonly runner = new TaskRunner();
  private readonly taskOrder: string[] = [];
  private readonly logs = new Map<string, string[]>();
  private activeTaskId: string | null = null;
  private activeExecution: FfmpegExecution | null = null;

  constructor(private readonly events: TaskQueueEvents) {}

  async enqueue(items: CreateTaskItem[]): Promise<MediaTask[]> {
    const createdTasks = items.map((item) => {
      const id = randomUUID();
      const task: MediaTask = {
        id,
        type: item.payload.type,
        status: 'queued',
        inputPath: item.inputPath,
        sourcePaths: item.payload.type === 'merge-video' ? item.payload.config.inputPaths : undefined,
        mergeLensCodes: item.payload.type === 'merge-video' ? item.mergeLensCodes : undefined,
        outputPath: this.createPlannedOutputPath(item),
        createdAt: new Date().toISOString(),
        progress: 0,
        payload: item.payload,
      };

      this.store.save(task);
      this.taskOrder.push(task.id);
      this.emitTaskUpdated(task);
      this.appendLog(task.id, item.payload.type === 'merge-video'
        ? `已加入视频拼接任务：共 ${item.payload.config.inputPaths.length} 段视频，输出为 ${path.basename(task.outputPath)}`
        : `已加入${taskTypeLabels[task.type]}任务：${path.basename(task.inputPath)}`);
      return task;
    });

    this.startNextIfIdle();

    return createdTasks;
  }

  async list(): Promise<MediaTask[]> {
    return this.store.list();
  }

  listLogs(): Record<string, string[]> {
    return Object.fromEntries(this.logs.entries());
  }

  cancel(taskId: string): { success: boolean; error?: string } {
    const task = this.store.get(taskId);
    if (!task || (task.status !== 'queued' && task.status !== 'running')) {
      return { success: false, error: '只有排队中或进行中的任务才可以取消。' };
    }

    if (this.activeTaskId === taskId && this.activeExecution) {
      stopFfmpeg(this.activeExecution);
      this.activeExecution = null;
      this.activeTaskId = null;
    }

    removeTaskId(this.taskOrder, taskId);

    const cancelledTask: MediaTask = {
      ...task,
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
    };

    this.store.save(cancelledTask);
    this.emitTaskUpdated(cancelledTask);
    this.appendLog(taskId, '任务已被用户取消。');
    this.startNextIfIdle();
    return { success: true };
  }

  async retry(taskId: string): Promise<{ success: boolean; error?: string }> {
    const task = this.store.get(taskId);
    if (!task || (task.status !== 'failed' && task.status !== 'cancelled' && task.status !== 'success')) {
      return { success: false, error: '只有成功、失败或已取消的任务才可以重试。' };
    }

    const outputDir = path.dirname(task.outputPath);
    await this.enqueue([
      {
        inputPath: task.inputPath,
        outputDir,
        payload: task.payload,
      },
    ]);

    return { success: true };
  }

  remove(taskId: string): { success: boolean; error?: string } {
    const task = this.store.get(taskId);
    if (!task) {
      return { success: false, error: '任务不存在。' };
    }

    if (task.status === 'running') {
      return { success: false, error: '进行中的任务不能移除。' };
    }

    removeTaskId(this.taskOrder, taskId);
    this.store.delete(taskId);
    this.logs.delete(taskId);
    return { success: true };
  }

  clearCompleted(): { success: boolean; error?: string } {
    for (const task of this.store.list()) {
      if (task.status === 'success' || task.status === 'failed' || task.status === 'cancelled') {
        this.store.delete(task.id);
        this.logs.delete(task.id);
        removeTaskId(this.taskOrder, task.id);
      }
    }

    return { success: true };
  }

  private startNextIfIdle(): void {
    if (this.activeTaskId || this.activeExecution) {
      return;
    }

    const nextTask = this.taskOrder
      .map((taskId) => this.store.get(taskId))
      .find((task): task is MediaTask => task !== undefined && task.status === 'queued');

    if (!nextTask) {
      return;
    }

    void this.runTask(nextTask);
  }

  private async runTask(task: MediaTask): Promise<void> {
    this.activeTaskId = task.id;
    let cleanupPaths: string[] = [];
    try {
      await ensureFileExists(task.inputPath);
      if (task.payload.type === 'merge-video') {
        for (const sourcePath of task.payload.config.inputPaths) {
          await ensureFileExists(sourcePath);
        }
      }

      const settings = await settingsService.getSettings();
      await ensureDirectoryExists(path.dirname(task.outputPath));
      const outputPath = await createAvailableOutputPath(task.outputPath);
      const prepared = await this.runner.prepare({ ...task, outputPath }, settings.ffmpegPath, settings.ffprobePath);
      cleanupPaths = prepared.cleanupPaths ?? [];
      const logsBaseDir = path.join(app.getPath('userData'), 'logs');

      let durationSeconds = 0;
      try {
        durationSeconds = await probeDuration(settings.ffprobePath, task.inputPath);
      } catch {
        durationSeconds = 0;
      }

      const runningTask = this.updateTask(task.id, {
        status: 'running',
        startedAt: new Date().toISOString(),
        progress: 0,
        outputPath: prepared.outputPath,
      });
       this.appendLog(task.id, `开始执行：${prepared.commandExecutable} ${prepared.commandArguments.join(' ')}`);

      const stderrChunks: string[] = [];
      this.activeExecution = startFfmpeg({
        executable: prepared.commandExecutable,
        args: prepared.commandArguments,
        onStdout: (chunk) => {
          this.appendLog(task.id, chunk.trimEnd());
        },
        onStderr: (chunk) => {
          stderrChunks.push(chunk);
          const nextProgress = parseProgress(chunk, durationSeconds);
          if (nextProgress !== null) {
            this.updateTask(task.id, { progress: nextProgress });
          }
          this.appendLog(task.id, chunk.trimEnd());
        },
      });

      await this.activeExecution.completion;

       let outputFrameCount: number | undefined;
       if (task.payload.type === 'merge-video') {
         try {
           const metadata = await probeVideoMetadata(settings.ffprobePath, prepared.outputPath);
           outputFrameCount = metadata.frameCount ?? undefined;
         } catch {
           outputFrameCount = undefined;
         }
       }

       this.appendLog(task.id, outputFrameCount ? `任务执行成功。输出总帧数：${outputFrameCount}` : '任务执行成功。');
      const successTask = this.updateTask(task.id, {
        status: 'success',
        progress: 100,
        finishedAt: new Date().toISOString(),
        outputFrameCount,
      });
      const logPath = await this.flushLogs(successTask.id, logsBaseDir);
      this.updateTask(task.id, { logPath });

      if (settings.autoOpenOutputDir) {
        void shell.showItemInFolder(successTask.outputPath);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '发生未知任务错误。';
      const wasCancelled = this.store.get(task.id)?.status === 'cancelled';
      this.appendLog(task.id, wasCancelled ? '任务已被用户取消。' : errorMessage);
      const failedTask = this.updateTask(task.id, {
        status: wasCancelled ? 'cancelled' : 'failed',
        finishedAt: new Date().toISOString(),
        errorMessage: wasCancelled ? undefined : errorMessage,
      });
      const logPath = await this.flushLogs(failedTask.id, path.join(app.getPath('userData'), 'logs'));
      this.updateTask(task.id, { logPath });
    } finally {
      for (const cleanupPath of cleanupPaths) {
        await rm(cleanupPath, { force: true });
      }
      this.activeExecution = null;
      this.activeTaskId = null;
      removeTaskId(this.taskOrder, task.id);
      this.startNextIfIdle();
    }
  }

  private emitTaskUpdated(task: MediaTask): void {
    this.events.emitTaskUpdated(task);
  }

  private appendLog(taskId: string, chunk: string): void {
    if (chunk.length === 0) {
      return;
    }

    const currentLogs = this.logs.get(taskId) ?? [];
    currentLogs.push(chunk);
    this.logs.set(taskId, currentLogs);
    this.events.emitTaskLog(taskId, `${chunk}\n`);
  }

  private createPlannedOutputPath(item: CreateTaskItem): string {
    if (item.payload.type === 'merge-video') {
      return path.join(item.outputDir, `${sanitizeOutputBaseName(item.payload.config.outputName)}.${defaultExtensionFor(item.payload)}`);
    }

    return path.join(item.outputDir, `${path.parse(item.inputPath).name}.${defaultExtensionFor(item.payload)}`);
  }

  private updateTask(taskId: string, patch: Partial<MediaTask>): MediaTask {
    const currentTask = this.store.get(taskId);
    if (!currentTask) {
      throw new Error(`未找到任务：${taskId}`);
    }

    const nextTask = {
      ...currentTask,
      ...patch,
    } satisfies MediaTask;

    this.store.save(nextTask);
    this.emitTaskUpdated(nextTask);
    return nextTask;
  }

  private async flushLogs(taskId: string, logsBaseDir: string): Promise<string> {
    const content = (this.logs.get(taskId) ?? []).join('\n');
    return appendTaskLog(logsBaseDir, taskId, `${content}\n`);
  }
}

function defaultExtensionFor(payload: CreateTaskItem['payload']): string {
  switch (payload.type) {
    case 'merge-video':
      return payload.config.outputFormat;
    case 'transcode':
      return payload.config.format;
    case 'extract-audio':
      return payload.config.format;
    case 'trim':
    case 'compress':
      return 'mp4';
    case 'export-frame':
      return payload.config.imageFormat;
  }
}

function sanitizeOutputBaseName(value: string): string {
  const normalized = value.trim().replace(/[<>:"/\\|?*]+/g, '-');
  return normalized.length > 0 ? normalized : 'merged-video';
}

function removeTaskId(taskOrder: string[], taskId: string): void {
  const index = taskOrder.indexOf(taskId);
  if (index >= 0) {
    taskOrder.splice(index, 1);
  }
}
