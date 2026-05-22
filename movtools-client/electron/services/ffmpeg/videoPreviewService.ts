import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { ProbedVideoMetadata } from './ffprobeService';
import { startFfmpeg } from './ffmpegService';

export interface VideoPreviewSource {
  previewUrl?: string;
  mode: 'direct' | 'proxy' | 'pending';
  note?: string;
  progressPercent?: number;
}

interface ResolveVideoPreviewOptions {
  ffmpegExecutable: string;
  inputPath: string;
  metadata: ProbedVideoMetadata;
  generationMode?: 'background' | 'disabled' | 'blocking';
  forceProxy?: boolean;
}

interface PreviewJobState {
  promise: Promise<string>;
  progressPercent: number;
  error?: string;
}

const pendingPreviewJobs = new Map<string, PreviewJobState>();
const failedPreviewJobs = new Map<string, string>();
const PREVIEW_CACHE_VERSION = 'v5';

export interface PreviewCacheCleanupResult {
  removedFileCount: number;
}

const PREVIEW_CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function resolveVideoPreviewSource(options: ResolveVideoPreviewOptions): Promise<VideoPreviewSource> {
  const { ffmpegExecutable, inputPath, metadata, generationMode = 'background', forceProxy = false } = options;
  const useProxy = forceProxy || shouldUseProxyPreview(metadata);
  if (!useProxy) {
    return {
      previewUrl: toFileUrl(inputPath),
      mode: 'direct',
    };
  }

  const proxyInfo = await inspectProxyCache(inputPath);
  if (proxyInfo.cachedOutputPath) {
      return {
        previewUrl: toFileUrl(proxyInfo.cachedOutputPath),
        mode: 'proxy',
        note: buildProxyReason(metadata),
      };
  }

  const runningJob = pendingPreviewJobs.get(proxyInfo.cacheKey);
  if (runningJob) {
    if (generationMode === 'blocking') {
      try {
        const outputPath = await runningJob.promise;
        return {
          previewUrl: toFileUrl(outputPath),
          mode: 'proxy',
          note: buildProxyReason(metadata),
        };
      } catch (error) {
        if (forceProxy) {
          return {
            mode: 'proxy',
            note: buildProxyFailureMessage(error),
          };
        }

        return {
          previewUrl: toFileUrl(inputPath),
          mode: 'direct',
          note: buildProxyFailureMessage(error),
        };
      }
    }

    return {
      mode: 'pending',
      note: buildPendingProxyMessage(metadata, runningJob.progressPercent),
      progressPercent: runningJob.progressPercent,
    };
  }

  const failedReason = failedPreviewJobs.get(proxyInfo.cacheKey);
  if (failedReason && generationMode !== 'blocking') {
    if (forceProxy) {
      return {
        mode: 'proxy',
        note: buildProxyFailureMessage(failedReason),
      };
    }

    return {
      previewUrl: toFileUrl(inputPath),
      mode: 'direct',
      note: buildProxyFailureMessage(failedReason),
    };
  }

  if (generationMode === 'disabled') {
    return {
      previewUrl: toFileUrl(inputPath),
      mode: 'direct',
      note: buildProxyReason(metadata),
    };
  }

  if (generationMode === 'blocking') {
    try {
      const outputPath = await ensurePreviewProxy(ffmpegExecutable, inputPath);
      return {
        previewUrl: toFileUrl(outputPath),
        mode: 'proxy',
        note: buildProxyReason(metadata),
      };
    } catch (error) {
      if (forceProxy) {
        return {
          mode: 'proxy',
          note: buildProxyFailureMessage(error),
        };
      }

      return {
        previewUrl: toFileUrl(inputPath),
        mode: 'direct',
        note: buildProxyFailureMessage(error),
      };
    }
  }

  startPreviewProxyJob(ffmpegExecutable, inputPath, metadata, proxyInfo.cacheKey, proxyInfo.outputPath);
  return {
    mode: 'pending',
    note: buildPendingProxyMessage(metadata, 0),
    progressPercent: 0,
  };
}

function shouldUseProxyPreview(metadata: ProbedVideoMetadata): boolean {
  const codec = metadata.codecName?.trim().toLowerCase() ?? '';
  const pixelFormat = metadata.pixelFormat?.trim().toLowerCase() ?? '';
  const formatName = metadata.formatName?.trim().toLowerCase() ?? '';
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width >= 3840 || height >= 2160) {
    return true;
  }

  if (!codec) {
    return false;
  }

  if (['png', 'prores', 'dnxhd', 'dnxhr', 'rawvideo', 'jpeg2000', 'targa', 'cineform', 'ffvhuff', 'ffv1'].some((value) => codec.includes(value))) {
    return true;
  }

  if (codec.includes('hevc') || codec.includes('h265') || codec.includes('mjpeg') || codec.includes('vc1') || codec.includes('mpeg2video')) {
    return true;
  }

  if (formatName.includes('mov') || formatName.includes('mkv') || formatName.includes('matroska')) {
    return true;
  }

  if (pixelFormat.includes('rgb') || pixelFormat.includes('bgr') || pixelFormat.includes('gbr')) {
    return true;
  }

  if (pixelFormat.includes('10') || pixelFormat.includes('12') || pixelFormat.includes('16')) {
    return true;
  }

  if (pixelFormat.includes('422') || pixelFormat.includes('444') || pixelFormat.includes('yuvj')) {
    return true;
  }

  return false;
}

function buildProxyFailureMessage(reason: unknown): string {
  const detail = typeof reason === 'string'
    ? reason
    : reason instanceof Error
      ? reason.message
      : '未知错误';
  return `兼容预览副本生成失败：${detail}`;
}

function buildProxyReason(metadata: ProbedVideoMetadata): string {
  const reasons: string[] = [];

  if ((metadata.width ?? 0) >= 3840 || (metadata.height ?? 0) >= 2160) {
    reasons.push('4K 规格');
  }

  const codec = metadata.codecName?.trim().toLowerCase() ?? '';
  const pixelFormat = metadata.pixelFormat?.trim().toLowerCase() ?? '';
  const formatName = metadata.formatName?.trim().toLowerCase() ?? '';
  if (codec) {
    reasons.push(`编码 ${codec}`);
  }
  if (pixelFormat) {
    reasons.push(`像素格式 ${pixelFormat}`);
  }
  if (formatName) {
    reasons.push(`封装 ${formatName}`);
  }

  return reasons.length > 0
    ? `已自动生成兼容预览副本（${reasons.join('，')}）。`
    : '已自动生成兼容预览副本。';
}

async function ensurePreviewProxy(ffmpegExecutable: string, inputPath: string): Promise<string> {
  const proxyInfo = await inspectProxyCache(inputPath);
  if (proxyInfo.cachedOutputPath) {
    return proxyInfo.cachedOutputPath;
  }

  const runningJob = pendingPreviewJobs.get(proxyInfo.cacheKey);
  if (runningJob) {
    return runningJob.promise;
  }

  return startPreviewProxyJob(ffmpegExecutable, inputPath, undefined, proxyInfo.cacheKey, proxyInfo.outputPath).promise;
}

export async function clearPreviewCache(): Promise<PreviewCacheCleanupResult> {
  const outputDirectory = getPreviewCacheDirectory();
  failedPreviewJobs.clear();
  if (!existsSync(outputDirectory)) {
    return { removedFileCount: 0 };
  }

  const entries = await readdir(outputDirectory, { withFileTypes: true });
  let removedFileCount = 0;
  await Promise.all(entries.map(async (entry) => {
    const targetPath = path.join(outputDirectory, entry.name);
    await rm(targetPath, { recursive: true, force: true });
    removedFileCount += 1;
  }));

  return { removedFileCount };
}

export async function pruneExpiredPreviewCache(): Promise<PreviewCacheCleanupResult> {
  const outputDirectory = getPreviewCacheDirectory();
  if (!existsSync(outputDirectory)) {
    return { removedFileCount: 0 };
  }

  const now = Date.now();
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  let removedFileCount = 0;
  await Promise.all(entries.map(async (entry) => {
    const targetPath = path.join(outputDirectory, entry.name);
    try {
      const targetStat = await stat(targetPath);
      if (now - targetStat.mtimeMs < PREVIEW_CACHE_RETENTION_MS) {
        return;
      }

      await rm(targetPath, { recursive: true, force: true });
      removedFileCount += 1;
    } catch {
      // Ignore per-entry cleanup failures to avoid blocking startup/config flows.
    }
  }));

  return { removedFileCount };
}

function getPreviewCacheDirectory(): string {
  return path.join(app.getPath('userData'), 'preview-cache');
}

async function inspectProxyCache(inputPath: string): Promise<{ cacheKey: string; outputPath: string; cachedOutputPath?: string }> {
  const inputStats = await stat(inputPath);
  const cacheKey = createHash('sha1')
    .update(JSON.stringify({
      previewCacheVersion: PREVIEW_CACHE_VERSION,
      inputPath,
      size: inputStats.size,
      mtimeMs: inputStats.mtimeMs,
    }))
    .digest('hex');
  const outputPath = path.join(getPreviewCacheDirectory(), `${cacheKey}.mp4`);
  return {
    cacheKey,
    outputPath,
    cachedOutputPath: existsSync(outputPath) ? outputPath : undefined,
  };
}

function startPreviewProxyJob(
  ffmpegExecutable: string,
  inputPath: string,
  metadata: ProbedVideoMetadata | undefined,
  cacheKey: string,
  outputPath: string,
): PreviewJobState {
  const outputDirectory = getPreviewCacheDirectory();
  const durationSeconds = metadata?.durationSeconds ?? 0;
  const jobState = {} as PreviewJobState;
  const jobPromise = (async () => {
    await mkdir(outputDirectory, { recursive: true });
    const execution = startFfmpeg({
      executable: ffmpegExecutable,
      args: [
        '-y',
        '-i', inputPath,
        '-map', '0:v:0',
        '-vf', 'scale=1920:-2:force_original_aspect_ratio=decrease',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-profile:v', 'baseline',
        '-level', '3.1',
        '-pix_fmt', 'yuv420p',
        '-an',
        '-movflags', '+faststart',
        '-progress', 'pipe:2',
        '-nostats',
        outputPath,
      ],
      onStderr: (chunk) => {
        if (!durationSeconds || durationSeconds <= 0) {
          return;
        }

        const match = chunk.match(/out_time_ms=(\d+)/);
        if (!match) {
          return;
        }

        const outTimeMs = Number.parseInt(match[1], 10);
        if (!Number.isFinite(outTimeMs) || outTimeMs <= 0) {
          return;
        }

        const ratio = Math.max(0, Math.min(0.99, outTimeMs / (durationSeconds * 1_000_000)));
        jobState.progressPercent = Math.max(jobState.progressPercent, Math.round(ratio * 100));
      },
    });
    await execution.completion;
    jobState.progressPercent = 100;
    return outputPath;
  })();

  jobState.promise = jobPromise;
  jobState.progressPercent = 0;
  failedPreviewJobs.delete(cacheKey);
  pendingPreviewJobs.set(cacheKey, jobState);
  void jobPromise.catch((error: unknown) => {
    jobState.error = error instanceof Error ? error.message : '未知错误';
    failedPreviewJobs.set(cacheKey, jobState.error);
  }).finally(() => {
    pendingPreviewJobs.delete(cacheKey);
  });
  return jobState;
}

function buildPendingProxyMessage(metadata: ProbedVideoMetadata, progressPercent: number): string {
  const baseMessage = buildProxyReason(metadata).replace('已自动生成', '正在生成');
  return progressPercent > 0 ? `${baseMessage} 当前进度约 ${progressPercent}%。` : `${baseMessage} 当前进度准备中。`;
}

function toFileUrl(absolutePath: string): string {
  const previewUrl = new URL('movtools-preview://video');
  previewUrl.searchParams.set('path', absolutePath);
  return previewUrl.toString();
}
