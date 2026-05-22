/**
 * 时间相关工具函数
 */

/**
 * 验证时间输入格式是否有效
 * 支持格式：HH:MM:SS、MM:SS、SS 或纯数字
 * @param value 待验证的时间字符串
 * @returns 是否为有效的时间格式
 */
export function isTimeInput(value: string): boolean {
  return /^(\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?$/.test(value) || /^\d+$/.test(value);
}
