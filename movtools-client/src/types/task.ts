export type TaskType = 'merge-video' | 'transcode' | 'extract-audio' | 'trim' | 'compress' | 'export-frame';

export type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface BaseTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  inputPath: string;
  sourcePaths?: string[];
  mergeLensCodes?: string[];
  outputPath: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: number;
  errorMessage?: string;
  logPath?: string;
  outputFrameCount?: number;
}

export interface TranscodeTaskConfig {
  format: 'mp4' | 'mov' | 'webm';
  videoCodec: 'h264' | 'hevc' | 'vp9';
  resolution: 'source' | '1080p' | '720p' | 'custom';
  width?: number;
  height?: number;
  fps: 'source' | 24 | 30 | 60;
  rateMode: 'crf' | 'bitrate';
  crf?: number;
  bitrateKbps?: number;
  audioCodec?: 'aac' | 'mp3' | 'copy';
}

export interface ExtractAudioTaskConfig {
  format: 'mp3' | 'aac' | 'wav';
  bitrateKbps?: number;
}

export interface TrimTaskConfig {
  startTime: string;
  endTime: string;
  reencode: boolean;
}

export interface CompressTaskConfig {
  preset: 'high-quality' | 'balanced' | 'small-size';
}

export interface ExportFrameTaskConfig {
  mode: 'single' | 'interval';
  time?: string;
  intervalSeconds?: number;
  imageFormat: 'jpg' | 'png';
}

export interface MergeOverlayStyle {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  fontSize: number;
  fontColor: string;
  fontOpacity: number;
  backgroundColor: string;
  backgroundOpacity: number;
  boxPadding: number;
  offsetX: number;
  offsetY: number;
}

export interface MergeVideoTaskConfig {
  inputPaths: string[];
  mode: 'fast' | 'compatible';
  upscaleMode: 'pad' | 'stretch';
  overlayTexts?: string[];
  overlayStyle?: MergeOverlayStyle;
  outputName: string;
  outputFormat: 'mp4';
}

export type TaskPayload =
  | { type: 'merge-video'; config: MergeVideoTaskConfig }
  | { type: 'transcode'; config: TranscodeTaskConfig }
  | { type: 'extract-audio'; config: ExtractAudioTaskConfig }
  | { type: 'trim'; config: TrimTaskConfig }
  | { type: 'compress'; config: CompressTaskConfig }
  | { type: 'export-frame'; config: ExportFrameTaskConfig };

export interface MediaTask extends BaseTask {
  payload: TaskPayload;
}
