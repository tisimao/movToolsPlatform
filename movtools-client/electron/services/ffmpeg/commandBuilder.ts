import type { TaskPayload } from '../../../src/types/task';

const DEFAULT_OVERLAY_STYLE = {
  position: 'top-left',
  fontSize: 36,
  fontColor: '#FFFFFF',
  fontOpacity: 100,
  backgroundColor: '#000000',
  backgroundOpacity: 55,
  boxPadding: 16,
  offsetX: 24,
  offsetY: 24,
};

interface CommandBuilderContext {
  concatFilePath?: string;
  mergeInputs?: Array<{
    path: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
    hasAudio?: boolean;
    overlayText?: string;
    fileNameText?: string;
  }>;
}

interface OverlayTextSpec {
  text: string;
  position: typeof DEFAULT_OVERLAY_STYLE.position | 'bottom-center';
  fontSize?: number;
  stackIndex?: number;
}

export function buildCommandArguments(payload: TaskPayload, inputPath: string, outputPath: string, context: CommandBuilderContext = {}): string[] {
  switch (payload.type) {
    case 'merge-video':
      return buildMergeVideoArguments(payload, outputPath, context);
    case 'transcode':
      return buildTranscodeArguments(payload, inputPath, outputPath);
    case 'extract-audio':
      return buildExtractAudioArguments(payload, inputPath, outputPath);
    case 'trim':
      return buildTrimArguments(payload, inputPath, outputPath);
    case 'compress':
      return buildCompressArguments(payload, inputPath, outputPath);
    case 'export-frame':
      return buildExportFrameArguments(payload, inputPath, outputPath);
  }
}

function buildMergeVideoArguments(payload: Extract<TaskPayload, { type: 'merge-video' }>, outputPath: string, context: CommandBuilderContext): string[] {
  if (payload.config.mode === 'fast') {
    if (!context.concatFilePath) {
      throw new Error('视频拼接缺少 concat 清单文件。');
    }

    return ['-y', '-f', 'concat', '-safe', '0', '-i', context.concatFilePath, '-c', 'copy', outputPath];
  }

  if (!context.mergeInputs || context.mergeInputs.length === 0) {
    throw new Error('视频拼接缺少 concat 清单文件。');
  }

  const targetWidth = toEven(Math.max(...context.mergeInputs.map((input) => input.width ?? 0), 1920));
  const targetHeight = toEven(Math.max(...context.mergeInputs.map((input) => input.height ?? 0), 1080));
  const overlayStyle = payload.config.overlayStyle ?? DEFAULT_OVERLAY_STYLE;
  const filterSegments = context.mergeInputs.map((input, index) => buildMergeVideoFilterSegment(input, index, targetWidth, targetHeight, payload.config.upscaleMode, overlayStyle));
  const concatInputs = context.mergeInputs.map((_, index) => `[v${index}]`).join('');
  const hasAnyAudio = context.mergeInputs.some((input) => input.hasAudio);
  const filterComplexParts = [...filterSegments];

  if (hasAnyAudio) {
    const audioSegments = context.mergeInputs.map((input, index) => {
      const duration = formatDurationSeconds(input.durationSeconds);
      if (input.hasAudio) {
        return `[${index}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=async=1:first_pts=0,atrim=duration=${duration},apad=whole_dur=${duration}[a${index}]`;
      }

      return `anullsrc=r=48000:cl=stereo:d=${duration}[a${index}]`;
    });
    const concatAudioInputs = context.mergeInputs.map((_, index) => `[a${index}]`).join('');
    filterComplexParts.push(...audioSegments);
    filterComplexParts.push(`${concatAudioInputs}concat=n=${context.mergeInputs.length}:v=0:a=1[aout]`);
  }

  filterComplexParts.push(`${concatInputs}concat=n=${context.mergeInputs.length}:v=1:a=0[vout]`);

  return [
    '-y',
    ...context.mergeInputs.flatMap((input) => ['-i', input.path]),
    '-filter_complex', filterComplexParts.join(';'),
    '-map', '[vout]',
    ...(hasAnyAudio ? ['-map', '[aout]'] : []),
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    ...(hasAnyAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
    '-movflags', '+faststart',
    outputPath,
  ];
}

function buildMergeVideoFilterSegment(
  input: NonNullable<CommandBuilderContext['mergeInputs']>[number],
  index: number,
  targetWidth: number,
  targetHeight: number,
  upscaleMode: 'pad' | 'stretch',
  overlayStyle: typeof DEFAULT_OVERLAY_STYLE,
): string {
  const base = upscaleMode === 'stretch'
    ? `[${index}:v]scale=${targetWidth}:${targetHeight},setsar=1`
    : `[${index}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;

  const noteText = input.overlayText?.trim();
  const fileNameText = input.fileNameText?.trim();
  const overlaySpecs: OverlayTextSpec[] = [];

  if (noteText) {
    overlaySpecs.push({
      text: noteText,
      position: overlayStyle.position,
      stackIndex: overlayStyle.position.startsWith('bottom') && fileNameText ? 1 : 0,
    });
  }

  if (fileNameText) {
    overlaySpecs.push({
      text: fileNameText,
      position: 'bottom-center',
      fontSize: Math.max(20, overlayStyle.fontSize - 8),
      stackIndex: 0,
    });
  }

  if (overlaySpecs.length === 0) {
    return `${base}[v${index}]`;
  }

  const drawtextSegments = overlaySpecs.map((spec) => buildDrawtextSegment(spec, overlayStyle, targetWidth, targetHeight)).join(',');
  return `${base},${drawtextSegments}[v${index}]`;
}

function buildDrawtextCoordinates(
  position: typeof DEFAULT_OVERLAY_STYLE.position | 'bottom-center',
  offsetX: number,
  offsetY: number,
  targetWidth: number,
  targetHeight: number,
  stackIndex = 0,
  lineHeight = 0,
): { x: string; y: string } {
  const normalizedOffsetX = Math.max(0, offsetX);
  const normalizedOffsetY = Math.max(0, offsetY);
  const stackedOffsetY = normalizedOffsetY + Math.max(0, stackIndex) * Math.max(0, lineHeight);
  const leftX = String(normalizedOffsetX);
  const centerX = `(${targetWidth}-text_w)/2`;
  const topY = String(stackedOffsetY);
  const rightX = `${targetWidth}-text_w-${normalizedOffsetX}`;
  const bottomY = `${targetHeight}-text_h-${stackedOffsetY}`;

  switch (position) {
    case 'top-right':
      return { x: rightX, y: topY };
    case 'bottom-left':
      return { x: leftX, y: bottomY };
    case 'bottom-center':
      return { x: centerX, y: bottomY };
    case 'bottom-right':
      return { x: rightX, y: bottomY };
    case 'top-left':
    default:
      return { x: leftX, y: topY };
  }
}

function buildDrawtextSegment(
  overlay: OverlayTextSpec,
  overlayStyle: typeof DEFAULT_OVERLAY_STYLE,
  targetWidth: number,
  targetHeight: number,
): string {
  const fontSize = overlay.fontSize ?? overlayStyle.fontSize;
  const coordinates = buildDrawtextCoordinates(
    overlay.position,
    overlayStyle.offsetX,
    overlayStyle.offsetY,
    targetWidth,
    targetHeight,
    overlay.stackIndex,
    fontSize + overlayStyle.boxPadding * 2 + 8,
  );

  return `drawtext=fontfile='C\\:/Windows/Fonts/msyh.ttc':text='${escapeDrawtext(overlay.text)}':x=${coordinates.x}:y=${coordinates.y}:fontsize=${fontSize}:fontcolor=${normalizeDrawtextColor(overlayStyle.fontColor)}@${formatOpacity(overlayStyle.fontOpacity)}:box=1:boxcolor=${normalizeDrawtextColor(overlayStyle.backgroundColor)}@${formatOpacity(overlayStyle.backgroundOpacity)}:boxborderw=${Math.max(0, overlayStyle.boxPadding)}`;
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ');
}

function normalizeDrawtextColor(value: string): string {
  return value.startsWith('#') ? `0x${value.slice(1)}` : value;
}

function formatOpacity(value: number): string {
  const normalized = Math.max(0, Math.min(100, value));
  return (normalized / 100).toFixed(2);
}

function buildTranscodeArguments(payload: Extract<TaskPayload, { type: 'transcode' }>, inputPath: string, outputPath: string): string[] {
  const args = ['-y', '-i', inputPath, '-c:v', mapVideoCodec(payload.config.videoCodec)];

  if (payload.config.rateMode === 'crf') {
    args.push('-crf', String(payload.config.crf ?? defaultCrfFor(payload.config.videoCodec)));
  } else {
    args.push('-b:v', `${payload.config.bitrateKbps ?? 2500}k`);
  }

  if (payload.config.resolution !== 'source') {
    const scale = payload.config.resolution === 'custom'
      ? `${toEven(payload.config.width ?? 1280)}:${toEven(payload.config.height ?? 720)}`
      : payload.config.resolution === '1080p'
        ? '1920:1080'
        : '1280:720';
    args.push('-vf', `scale=${scale}`);
  }

  if (payload.config.fps !== 'source') {
    args.push('-r', String(payload.config.fps));
  }

  const audioCodec = payload.config.format === 'webm' ? 'libopus' : payload.config.audioCodec === 'mp3' ? 'libmp3lame' : payload.config.audioCodec === 'copy' ? 'copy' : 'aac';
  args.push('-c:a', audioCodec);
  args.push(outputPath);

  return args;
}

function buildExtractAudioArguments(payload: Extract<TaskPayload, { type: 'extract-audio' }>, inputPath: string, outputPath: string): string[] {
  const args = ['-y', '-i', inputPath, '-vn'];

  if (payload.config.format === 'mp3') {
    args.push('-c:a', 'libmp3lame', '-b:a', `${payload.config.bitrateKbps ?? 192}k`);
  } else if (payload.config.format === 'aac') {
    args.push('-c:a', 'aac', '-b:a', `${payload.config.bitrateKbps ?? 192}k`);
  } else {
    args.push('-c:a', 'pcm_s16le');
  }

  args.push(outputPath);
  return args;
}

function buildTrimArguments(payload: Extract<TaskPayload, { type: 'trim' }>, inputPath: string, outputPath: string): string[] {
  const args = ['-y', '-ss', payload.config.startTime, '-to', payload.config.endTime, '-i', inputPath];

  if (payload.config.reencode) {
    args.push('-c:v', 'libx264', '-c:a', 'aac');
  } else {
    args.push('-c', 'copy');
  }

  args.push(outputPath);
  return args;
}

function buildCompressArguments(payload: Extract<TaskPayload, { type: 'compress' }>, inputPath: string, outputPath: string): string[] {
  const preset = payload.config.preset === 'high-quality'
    ? { crf: '20', speed: 'medium', audio: '192k' }
    : payload.config.preset === 'small-size'
      ? { crf: '28', speed: 'slow', audio: '96k' }
      : { crf: '24', speed: 'medium', audio: '128k' };

  return ['-y', '-i', inputPath, '-c:v', 'libx264', '-preset', preset.speed, '-crf', preset.crf, '-c:a', 'aac', '-b:a', preset.audio, outputPath];
}

function buildExportFrameArguments(payload: Extract<TaskPayload, { type: 'export-frame' }>, inputPath: string, outputPath: string): string[] {
  if (payload.config.mode === 'single') {
    return ['-y', '-ss', payload.config.time ?? '00:00:01.000', '-i', inputPath, '-frames:v', '1', outputPath];
  }

  return ['-y', '-i', inputPath, '-vf', `fps=1/${payload.config.intervalSeconds ?? 5}`, outputPath];
}

function formatDurationSeconds(value?: number): string {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return '0.1';
  }

  return Math.max(0.1, value).toFixed(3);
}

function mapVideoCodec(codec: 'h264' | 'hevc' | 'vp9'): string {
  switch (codec) {
    case 'hevc':
      return 'libx265';
    case 'vp9':
      return 'libvpx-vp9';
    case 'h264':
      return 'libx264';
  }
}

function defaultCrfFor(codec: 'h264' | 'hevc' | 'vp9'): number {
  switch (codec) {
    case 'hevc':
      return 28;
    case 'vp9':
      return 32;
    case 'h264':
      return 23;
  }
}

function toEven(value: number): number {
  return value % 2 === 0 ? value : value - 1;
}
