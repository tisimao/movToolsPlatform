/**
 * 文件提取状态管理
 * 
 * 使用 Zustand 管理文件提取的预览和历史记录。
 */
import { create } from 'zustand';
import type { ExtractPreviewItem, ExtractRecordItem } from '../types/extract';

/** 提取状态接口 */
interface ExtractState {
  /** 提取历史记录列表 */
  history: ExtractRecordItem[];
  /** 当前预览会话 ID */
  previewId: string | null;
  /** 当前预览文件列表 */
  previewItems: ExtractPreviewItem[];
  /** 设置历史记录 */
  setHistory: (history: ExtractRecordItem[]) => void;
  /** 设置预览（会话ID和文件列表） */
  setPreview: (payload: { previewId: string | null; previewItems: ExtractPreviewItem[] }) => void;
}

/** 提取状态存储 */
export const useExtractStore = create<ExtractState>((set) => ({
  /** 初始历史记录为空数组 */
  history: [],
  /** 初始预览会话ID为null */
  previewId: null,
  /** 初始预览文件列表为空数组 */
  previewItems: [],
  /** 设置历史记录的更新函数 */
  setHistory: (history) => set({ history }),
  /** 设置预览的更新函数 */
  setPreview: (payload) => set({ previewId: payload.previewId, previewItems: payload.previewItems }),
}));
