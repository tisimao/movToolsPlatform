/**
 * 输入验证工具函数
 * 
 * 提供各类表单输入的验证逻辑，用于前端表单校验。
 */
import { isTimeInput } from './time';

/**
 * 验证裁剪时间范围是否有效
 * @param startTime 起始时间（支持 HH:MM:SS、MM:SS、SS 或纯数字格式）
 * @param endTime 结束时间（支持 HH:MM:SS、MM:SS、SS 或纯数字格式）
 * @returns 是否有效（结束时间必须晚于开始时间）
 */
export function validateTrimRange(startTime: string, endTime: string): boolean {
  if (!isTimeInput(startTime) || !isTimeInput(endTime)) {
    return false;
  }

  return toSeconds(endTime) > toSeconds(startTime);
}

/**
 * 验证自定义分辨率输入
 * @param width 宽度（可选，像素值）
 * @param height 高度（可选，像素值）
 * @returns 是否为有效的正整数分辨率（宽度和高度都必须是正整数）
 */
export function validateCustomResolution(width?: number, height?: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && (width ?? 0) > 0 && (height ?? 0) > 0;
}

/**
 * 验证导出帧输入参数
 * @param mode 导出模式：'single' 表示单帧，'interval' 表示按间隔导出
 * @param time 时间点（单帧模式下，支持 HH:MM:SS、MM:SS、SS 或纯数字格式）
 * @param intervalSeconds 间隔秒数（区间模式下，必须大于0）
 * @returns 是否有效
 */
export function validateFrameExportInput(mode: 'single' | 'interval', time?: string, intervalSeconds?: number): boolean {
  return mode === 'single' ? isTimeInput(time ?? '') : (intervalSeconds ?? 0) > 0;
}

/**
 * 验证视频拼接输入
 * @param inputPaths 输入文件路径列表（至少需要2个文件）
 * @param outputName 输出文件名（不能为空或仅包含空白字符）
 * @returns 是否有效（至少2个输入文件，输出名非空且去除空白后不为空）
 */
export function validateMergeInput(inputPaths: string[], outputName: string): boolean {
  return inputPaths.length >= 2 && outputName.trim().length > 0;
}

/**
 * 将时间字符串转换为秒数（内部工具函数）
 * @param value 时间字符串，支持 HH:MM:SS、MM:SS、SS 或纯数字格式
 * @returns 秒数
 */
function toSeconds(value: string): number {
  const segments = value.split(':');
  if (segments.length === 1) {
    return Number(segments[0]);
  }

  const normalized = [...segments].map((segment) => Number(segment));
  while (normalized.length < 3) {
    normalized.unshift(0);
  }

  const [hours, minutes, seconds] = normalized;
  return hours * 3600 + minutes * 60 + seconds;
}
