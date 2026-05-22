/**
 * 显示文本映射
 * 
 * 用于将枚举值映射为用户可读的中文标签。
 */
import type { TaskStatus, TaskType } from '../types/task';

/** 任务类型的中文标签映射 */
export const taskTypeLabels: Record<TaskType, string> = {
  'merge-video': '视频拼接',
  transcode: '视频转码',
  'extract-audio': '提取音频',
  trim: '视频裁剪',
  compress: '视频压缩',
  'export-frame': '导出画面',
};

/** 任务状态的中文标签映射 */
export const taskStatusLabels: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '进行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
};
