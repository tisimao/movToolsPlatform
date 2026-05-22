import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeTaskLog(baseDir: string, taskId: string, content: string): Promise<string> {
  const dateFolder = new Date().toISOString().slice(0, 10);
  const logDir = path.join(baseDir, dateFolder);
  const logPath = path.join(logDir, `task_${taskId}.log`);

  await mkdir(logDir, { recursive: true });
  await writeFile(logPath, content, 'utf8');

  return logPath;
}

export async function appendTaskLog(baseDir: string, taskId: string, content: string): Promise<string> {
  const logPath = await writeTaskLog(baseDir, taskId, '');
  await appendFile(logPath, content, 'utf8');
  return logPath;
}

export async function readTaskLog(logPath: string): Promise<string> {
  return readFile(logPath, 'utf8');
}
