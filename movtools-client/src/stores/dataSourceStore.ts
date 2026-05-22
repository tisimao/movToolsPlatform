/**
 * 数据源上下文
 * 
 * 提供全局数据源切换能力。
 */
import { create } from 'zustand';
import type { DataSourceType } from '../repositories/types';
import { switchDataSource, getDataSource } from '../services/repositoryService';

interface DataSourceState {
  dataSource: DataSourceType;
  /** 切换数据源 */
  setDataSource: (source: DataSourceType) => void;
}

export const useDataSourceStore = create<DataSourceState>((set) => ({
  dataSource: getDataSource(),
  setDataSource: (source) => {
    switchDataSource(source);
    set({ dataSource: source });
  },
}));

export { getDataSource } from '../services/repositoryService';
export { switchDataSource } from '../services/repositoryService';