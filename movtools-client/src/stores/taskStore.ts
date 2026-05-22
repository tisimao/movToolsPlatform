/**
 * 任务状态管理
 * 
 * 使用 Zustand 管理媒体处理任务列表和默认配置。
 */
import { create } from 'zustand';
import type { CreateTaskResponse, MediaTask, TaskPayload, TaskType } from '../types/ipc';
import type {
  CompressTaskConfig,
  ExportFrameTaskConfig,
  ExtractAudioTaskConfig,
  MergeVideoTaskConfig,
  TranscodeTaskConfig,
  TrimTaskConfig,
} from '../types/task';

/** 任务状态接口 */
interface TaskState {
  tasks: MediaTask[];           // 当前任务列表
  setTasks: (tasks: MediaTask[]) => void;    // 设置整个任务列表
  upsertTask: (task: MediaTask) => void;     // 插入或更新单个任务
}

/** 空的任务创建响应（默认值） */
export const emptyCreateTaskResponse: CreateTaskResponse = {
  success: true,
  taskIds: [],
};

/**
 * 获取指定任务类型的默认配置
 * @param taskType 任务类型
 * @returns 该类型的默认配置对象
 */
export function defaultTaskConfigFor(taskType: 'merge-video'): MergeVideoTaskConfig;
export function defaultTaskConfigFor(taskType: 'transcode'): TranscodeTaskConfig;
export function defaultTaskConfigFor(taskType: 'extract-audio'): ExtractAudioTaskConfig;
export function defaultTaskConfigFor(taskType: 'trim'): TrimTaskConfig;
export function defaultTaskConfigFor(taskType: 'compress'): CompressTaskConfig;
export function defaultTaskConfigFor(taskType: 'export-frame'): ExportFrameTaskConfig;
export function defaultTaskConfigFor(taskType: TaskType): TaskPayload['config'] {
  switch (taskType) {
    case 'merge-video':
      return {
        inputPaths: [],
        mode: 'compatible',
        upscaleMode: 'pad',
        overlayTexts: [],
        overlayStyle: {
          position: 'top-left',
          fontSize: 36,
          fontColor: '#FFFFFF',
          fontOpacity: 100,
          backgroundColor: '#000000',
          backgroundOpacity: 55,
          boxPadding: 16,
          offsetX: 24,
          offsetY: 24,
        },
        outputName: 'merged-video',
        outputFormat: 'mp4',
      };
    case 'transcode':
      return {
        format: 'mp4',
        videoCodec: 'h264',
        resolution: 'source',
        fps: 'source',
        rateMode: 'crf',
        crf: 23,
        audioCodec: 'aac',
      };
    case 'extract-audio':
      return {
        format: 'mp3',
        bitrateKbps: 192,
      };
    case 'trim':
      return {
        startTime: '00:00:00',
        endTime: '00:00:30',
        reencode: true,
      };
    case 'compress':
      return {
        preset: 'balanced',
      };
    case 'export-frame':
      return {
        mode: 'single',
        time: '00:00:05.000',
        imageFormat: 'jpg',
      };
  }
}

/**
 * 创建指定类型的默认任务载荷
 * @param taskType 任务类型
 * @returns 包含类型和默认配置的完整载荷
 */
export function createDefaultTaskPayload(taskType: TaskType): TaskPayload {
  switch (taskType) {
    case 'merge-video':
      return { type: 'merge-video', config: defaultTaskConfigFor('merge-video') };
    case 'transcode':
      return { type: 'transcode', config: defaultTaskConfigFor('transcode') };
    case 'extract-audio':
      return { type: 'extract-audio', config: defaultTaskConfigFor('extract-audio') };
    case 'trim':
      return { type: 'trim', config: defaultTaskConfigFor('trim') };
    case 'compress':
      return { type: 'compress', config: defaultTaskConfigFor('compress') };
    case 'export-frame':
      return { type: 'export-frame', config: defaultTaskConfigFor('export-frame') };
  }
}

/** 任务状态存储 */
export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  upsertTask: (task) =>
    set((state) => {
      const existing = state.tasks.find((entry) => entry.id === task.id);
      if (!existing) {
        return { tasks: [task, ...state.tasks] };
      }

      return {
        tasks: state.tasks.map((entry) => (entry.id === task.id ? task : entry)),
      };
    }),
}));
