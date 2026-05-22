import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { createTaskRequestSchema, type MediaTask } from '../../src/types/ipc';
import { TaskQueue } from '../services/task/taskQueue';

const taskQueue = new TaskQueue({
  emitTaskUpdated(task: MediaTask) {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('task:updated', { task });
    }
  },
  emitTaskLog(taskId: string, chunk: string) {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('task:logAppended', { taskId, chunk });
    }
  },
});

export function registerTaskIpc(): void {
  ipcMain.handle('task:create', async (_event, request: unknown) => {
    const parsed = createTaskRequestSchema.parse(request);
    const tasks = await taskQueue.enqueue(parsed.items);

    return {
      success: true,
      taskIds: tasks.map((task) => task.id),
    };
  });

  ipcMain.handle('task:list', async () => taskQueue.list());

  ipcMain.handle('task:listLogs', async () => ({ logs: taskQueue.listLogs() }));

  ipcMain.handle('task:cancel', async (_event, request: { taskId: string }) => taskQueue.cancel(request.taskId));

  ipcMain.handle('task:retry', async (_event, request: { taskId: string }) => taskQueue.retry(request.taskId));

  ipcMain.handle('task:remove', async (_event, request: { taskId: string }) => taskQueue.remove(request.taskId));

  ipcMain.handle('task:clearCompleted', async () => taskQueue.clearCompleted());

  ipcMain.handle('task:openLog', async (_event, request: { taskId: string }) => {
    const task = (await taskQueue.list()).find((entry) => entry.id === request.taskId);
    if (!task?.logPath) {
      return { success: false, error: '当前任务还没有可用日志文件。' };
    }

    shell.showItemInFolder(task.logPath);
    return { success: true };
  });

  ipcMain.handle('task:exportLog', async (_event, request: { taskId: string }) => {
    const logs = taskQueue.listLogs();
    const logLines = logs[request.taskId] ?? [];
    if (logLines.length === 0) {
      return { success: false, error: '当前没有可导出的日志内容。' };
    }

    const targetWindow = BrowserWindow.getFocusedWindow();
    const dialogOptions = {
      defaultPath: `task_${request.taskId}.log`,
      filters: [{ name: '日志文件', extensions: ['log', 'txt'] }],
    };
    const result = targetWindow
      ? await dialog.showSaveDialog(targetWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

    if (result.canceled || !result.filePath) {
      return { success: false, error: '日志导出已取消。' };
    }

    await writeFile(result.filePath, `${logLines.join('\n')}\n`, 'utf8');
    return { success: true };
  });
}
