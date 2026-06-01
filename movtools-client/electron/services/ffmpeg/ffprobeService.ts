import { spawn } from 'node:child_process';

export async function probeDuration(executable: string, inputPath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(executable, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', inputPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || `FFprobe exited with code ${code ?? 'unknown'}`));
        return;
      }

      const value = Number.parseFloat(output.trim());
      resolve(Number.isFinite(value) ? value : 0);
    });
  });
}

export interface ProbedVideoMetadata {
  durationSeconds: number;
  frameCount: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  formatName: string | null;
  codecName: string | null;
  codecLongName: string | null;
  codecProfile: string | null;
  pixelFormat: string | null;
  hasAudio: boolean;
  audioCodecName: string | null;
  audioChannels: number | null;
  audioChannelLayout: string | null;
  audioSampleRate: number | null;
}

export async function probeVideoMetadata(executable: string, inputPath: string): Promise<ProbedVideoMetadata> {
  return new Promise<ProbedVideoMetadata>((resolve, reject) => {
    const child = spawn(executable, [
      '-v', 'error',
      '-show_streams',
      '-show_entries', 'stream=index,codec_type,avg_frame_rate,r_frame_rate,nb_frames,duration,width,height,codec_name,codec_long_name,profile,pix_fmt,channels,channel_layout,sample_rate:format=duration,format_name',
      '-of', 'json',
      inputPath,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || `FFprobe exited with code ${code ?? 'unknown'}`));
        return;
      }

      try {
        const parsed = JSON.parse(output) as {
          streams?: Array<{
            index?: number;
            codec_type?: string;
            avg_frame_rate?: string;
            r_frame_rate?: string;
            nb_frames?: string;
            duration?: string;
            width?: number;
            height?: number;
            codec_name?: string;
            codec_long_name?: string;
            profile?: string;
            pix_fmt?: string;
            channels?: number;
            channel_layout?: string;
            sample_rate?: string;
          }>;
          format?: { duration?: string; format_name?: string };
        };
        const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video');
        const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio');
        const stream = videoStream ?? parsed.streams?.[0];
        const fps = parseRate(stream?.avg_frame_rate) ?? parseRate(stream?.r_frame_rate);
        const durationSeconds = parseNumber(stream?.duration) ?? parseNumber(parsed.format?.duration) ?? 0;
        const parsedFrameCount = parseInteger(stream?.nb_frames);
        const frameCount = parsedFrameCount ?? (fps && durationSeconds > 0 ? Math.round(fps * durationSeconds) : null);
        resolve({
          durationSeconds,
          frameCount,
          fps,
          width: parseNullableNumber(stream?.width),
          height: parseNullableNumber(stream?.height),
          formatName: parseText(parsed.format?.format_name),
          codecName: parseText(stream?.codec_name),
          codecLongName: parseText(stream?.codec_long_name),
          codecProfile: parseText(stream?.profile),
          pixelFormat: parseText(stream?.pix_fmt),
          hasAudio: Boolean(audioStream),
          audioCodecName: parseText(audioStream?.codec_name),
          audioChannels: parseNullableNumber(audioStream?.channels),
          audioChannelLayout: parseText(audioStream?.channel_layout),
          audioSampleRate: parseInteger(audioStream?.sample_rate),
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('解析 FFprobe 视频信息失败。'));
      }
    });
  });
}

function parseNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableNumber(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRate(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  if (value.includes('/')) {
    const [left, right] = value.split('/').map((segment) => Number.parseFloat(segment));
    if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) {
      return null;
    }
    return left / right;
  }

  return parseNumber(value);
}

function parseText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
