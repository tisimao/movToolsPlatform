import { createWriteStream } from 'node:fs';
import { access, copyFile, cp, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const buildRoot = path.join(projectRoot, 'build');
const runtimeRoot = path.join(buildRoot, 'runtime');
const tempRoot = path.join(buildRoot, '.tmp-runtime');
const vendorRoot = path.join(projectRoot, 'vendor', 'runtime');

const ffmpegArchiveUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const ffmpegArchivePath = path.join(vendorRoot, 'ffmpeg-release-essentials.zip');
const ffmpegOutputPath = path.join(runtimeRoot, 'ffmpeg');

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });

await prepareFfmpegRuntime();

console.log(`Runtime resources prepared at ${runtimeRoot}`);

async function prepareFfmpegRuntime() {
  const bundledDir = await firstExistingPath([
    process.env.MOVTOOLS_FFMPEG_RUNTIME_DIR,
    path.join(vendorRoot, 'ffmpeg'),
  ]);

  if (bundledDir) {
    await copyDirectoryContents(bundledDir, ffmpegOutputPath);
    await ensureFileExists(path.join(ffmpegOutputPath, 'bin', executableName('ffmpeg')));
    await ensureFileExists(path.join(ffmpegOutputPath, 'bin', executableName('ffprobe')));
    console.log(`FFmpeg runtime copied from ${bundledDir}`);
    return;
  }

  const archivePath = await ensureFfmpegArchive();
  await extractArchive(archivePath, ffmpegOutputPath);

  const normalizedRoot = await normalizeExtractedRuntimeRoot(ffmpegOutputPath, executableName('ffmpeg'));
  const ffmpegPath = await findFileRecursively(normalizedRoot, executableName('ffmpeg'));
  const ffprobePath = await findFileRecursively(normalizedRoot, executableName('ffprobe'));
  if (!ffmpegPath || !ffprobePath) {
    throw new Error('FFmpeg runtime prepare failed: ffmpeg/ffprobe executable not found after extraction.');
  }

  const ffmpegBinDir = path.dirname(ffmpegPath);
  if (path.normalize(ffmpegBinDir) !== path.normalize(path.join(ffmpegOutputPath, 'bin'))) {
    await mkdir(path.join(ffmpegOutputPath, 'bin'), { recursive: true });
    await copyFile(ffmpegPath, path.join(ffmpegOutputPath, 'bin', executableName('ffmpeg')));
    await copyFile(ffprobePath, path.join(ffmpegOutputPath, 'bin', executableName('ffprobe')));
  }

  await flattenRuntimeLayout(ffmpegOutputPath, ffmpegPath);

  console.log(`FFmpeg runtime prepared from archive ${archivePath}`);
}

async function ensureFfmpegArchive() {
  const existingArchive = await firstExistingPath([
    process.env.MOVTOOLS_FFMPEG_RUNTIME_ARCHIVE,
    ffmpegArchivePath,
  ]);

  if (existingArchive) {
    return existingArchive;
  }

  await mkdir(vendorRoot, { recursive: true });
  console.log(`Downloading FFmpeg runtime from ${ffmpegArchiveUrl}`);

  await downloadFile(ffmpegArchiveUrl, ffmpegArchivePath);
  return ffmpegArchivePath;
}

async function firstExistingPath(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    const resolved = path.resolve(candidate);
    if (await pathExists(resolved)) {
      return resolved;
    }
  }

  return null;
}

async function copyDirectoryContents(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  await Promise.all(entries.map((entry) => cp(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), { recursive: true, force: true })));
}

async function normalizeExtractedRuntimeRoot(outputDir, executableFileName) {
  const directBinDir = path.join(outputDir, 'bin');
  if (await pathExists(directBinDir)) {
    const directExecutable = await findFileRecursively(directBinDir, executableFileName);
    if (directExecutable) {
      return outputDir;
    }
  }

  const entries = await readdir(outputDir, { withFileTypes: true });
  const nestedRoots = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(outputDir, entry.name));

  for (const nestedRoot of nestedRoots) {
    const nestedExecutable = await findFileRecursively(nestedRoot, executableFileName);
    if (!nestedExecutable) {
      continue;
    }

    await copyDirectoryContents(nestedRoot, outputDir);
    return outputDir;
  }

  return outputDir;
}

async function flattenRuntimeLayout(outputDir, executablePath) {
  const sourceBinDir = path.dirname(executablePath);
  const sourceRoot = path.dirname(sourceBinDir);
  const tempDir = path.join(tempRoot, `${path.basename(outputDir)}-${Date.now()}`);

  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  await copyDirectoryContents(sourceBinDir, path.join(tempDir, 'bin'));

  const licensesDir = path.join(sourceRoot, 'Licenses');
  if (await pathExists(licensesDir)) {
    await copyDirectoryContents(licensesDir, path.join(tempDir, 'Licenses'));
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(path.dirname(outputDir), { recursive: true });
  await rename(tempDir, outputDir);
}

async function extractArchive(archivePath, outputDir) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const extractCommand = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Expand-Archive -Path '${windowsSafePath(archivePath)}' -DestinationPath '${windowsSafePath(outputDir)}' -Force`,
  ];

  const result = await runCommand('powershell', extractCommand);
  if (!result.success) {
    throw new Error(result.stderr || `Failed to extract archive: ${archivePath}`);
  }
}

async function extractEmbeddedMsiIfNeeded(outputDir) {
  const msiPath = await findFileRecursively(outputDir, '.msi', true);
  if (!msiPath) {
    return;
  }

  const extractedDir = path.join(outputDir, '__msi_extract__');
  await rm(extractedDir, { recursive: true, force: true });
  await mkdir(extractedDir, { recursive: true });

  const result = await runCommand('msiexec', [
    '/a',
    msiPath,
    '/qn',
    `TARGETDIR=${extractedDir}`,
  ]);

  if (!result.success) {
    throw new Error(result.stderr || `Failed to extract MSI package: ${msiPath}`);
  }

  await copyDirectoryContents(extractedDir, outputDir);
}

async function findFileRecursively(rootDir, fileName, matchBySuffix = false) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    const entryName = entry.name.toLowerCase();
    const lookupName = fileName.toLowerCase();
    if (entry.isFile() && (matchBySuffix ? entryName.endsWith(lookupName) : entryName === lookupName)) {
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

async function ensureFileExists(filePath) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Required file not found: ${filePath}`);
  }
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download file: ${url} (HTTP ${response.status})`);
  }

  await pipeline(response.body, createWriteStream(destinationPath));
}

function executableName(commandName) {
  return process.platform === 'win32' ? `${commandName}.exe` : commandName;
}

function windowsSafePath(value) {
  return value.replace(/'/g, "''");
}

async function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
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
