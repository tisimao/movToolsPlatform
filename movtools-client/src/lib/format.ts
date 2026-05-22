/**
 * 格式化工具函数
 */

/**
 * 将任务类型标签中的连字符替换为空格
 * 例如：extract-audio -> extract audio
 * @param value 任务类型字符串
 * @returns 格式化后的显示文本
 */
export function formatTaskTypeLabel(value: string): string {
  return value.replace(/-/g, ' ');
}
