import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectSummary } from '../../../src/types/project';

const invalidFolderNamePattern = /[<>:"/\\|?*\u0000-\u001F]/;
const reservedFolderNames = new Set(['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9']);

export function resolveLensFolderRootPath(project: ProjectSummary): string {
  return project.lensFolderRootPath?.trim() ?? '';
}

export function resolveLensFolderName(lensName: string, lensCode?: string): string {
  return (lensName.trim() || lensCode?.trim() || '').trim();
}

export function validateLensFolderName(folderName: string): string | null {
  const normalized = folderName.trim();
  if (!normalized) {
    return '镜头名称不能为空，无法同步创建镜头文件夹。';
  }

  if (invalidFolderNamePattern.test(normalized)) {
    return `镜头名称「${normalized}」包含 Windows 文件夹不允许的字符。`;
  }

  if (normalized.endsWith('.') || normalized.endsWith(' ')) {
    return `镜头名称「${normalized}」不能以空格或句点结尾。`;
  }

  if (reservedFolderNames.has(normalized.toUpperCase())) {
    return `镜头名称「${normalized}」是 Windows 保留名称，不能用于创建文件夹。`;
  }

  return null;
}

export async function ensureLensRootDirectory(rootPath: string): Promise<void> {
  await mkdir(rootPath, { recursive: true });
}

export async function ensureLensFolder(rootPath: string, folderName: string): Promise<{ created: boolean; folderPath: string }> {
  const folderPath = path.join(rootPath, folderName);

  try {
    const existing = await stat(folderPath);
    if (!existing.isDirectory()) {
      throw new Error(`路径已存在但不是文件夹：${folderPath}`);
    }
    return { created: false, folderPath };
  } catch (error) {
    if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) {
      throw error;
    }
    await mkdir(folderPath, { recursive: false });
    return { created: true, folderPath };
  }
}

export async function removeCreatedLensFolders(folderPaths: string[]): Promise<void> {
  await Promise.allSettled(folderPaths.map((folderPath) => rm(folderPath, { recursive: true, force: true })));
}

export async function assertLensFolderIsEmptyOrMissing(rootPath: string, folderName: string): Promise<void> {
  const folderPath = path.join(rootPath, folderName);

  try {
    const existing = await stat(folderPath);
    if (!existing.isDirectory()) {
      throw new Error(`镜头文件路径不是文件夹：${folderPath}`);
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const entries = await readdir(folderPath);
  if (entries.length > 0) {
    throw new Error(`镜头文件夹「${folderName}」内已有文件，请先手动处理后再删除镜头。`);
  }
}

export async function deleteEmptyLensFolder(rootPath: string, folderName: string): Promise<void> {
  const folderPath = path.join(rootPath, folderName);
  await assertLensFolderIsEmptyOrMissing(rootPath, folderName);

  await rm(folderPath, { recursive: false, force: true });
}
