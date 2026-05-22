import { access, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export async function ensureDirectoryExists(directoryPath: string): Promise<void> {
  try {
    const existing = await stat(directoryPath);
    if (!existing.isDirectory()) {
      throw new Error('Target path exists but is not a directory.');
    }
  } catch {
    await mkdir(directoryPath, { recursive: true });
  }
}

export async function ensureFileExists(filePath: string): Promise<void> {
  await access(filePath);

  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new Error('Input path must be a file.');
  }
}

export async function readFileAsBase64(filePath: string): Promise<{ fileName: string; mimeType: string; base64: string }> {
  const fileBuffer = await readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
  };
  const mimeType = mimeTypeMap[extension] ?? 'application/octet-stream';

  return {
    fileName: path.basename(filePath),
    mimeType,
    base64: fileBuffer.toString('base64'),
  };
}

export async function createAvailableOutputPath(filePath: string): Promise<string> {
  const directory = path.dirname(filePath);
  const extension = path.extname(filePath);
  const baseName = path.basename(filePath, extension);

  let candidate = filePath;
  let index = 1;

  while (await pathExists(candidate)) {
    candidate = path.join(directory, `${baseName}-${index}${extension}`);
    index += 1;
  }

  return candidate;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
