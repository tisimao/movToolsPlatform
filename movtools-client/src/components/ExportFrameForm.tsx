import type { ExportFrameTaskConfig } from '../types/task';

/**
 * 导出帧设置表单组件属性
 */
interface ExportFrameFormProps {
  /** 当前导出帧任务配置 */
  value: ExportFrameTaskConfig;
  /** 配置变更回调函数 */
  onChange: (value: ExportFrameTaskConfig) => void;
}

/**
 * 导出帧设置表单组件
 * 用于配置视频帧导出的参数，包括导出模式、时间点/间隔和图片格式
 * @param props 表单属性
 * @returns JSX元素
 */
export function ExportFrameForm({ value, onChange }: ExportFrameFormProps) {
  return (
    <section className="section-block form-grid">
      {/* 导出模式选择：单张截图或按间隔导出 */}
      <label className="field">
        <span>导出模式</span>
        <select 
          value={value.mode} 
          onChange={(event) => onChange({ ...value, mode: event.target.value as ExportFrameTaskConfig['mode'] })}
        >
          <option value="single">单张截图</option>
          <option value="interval">按间隔导出</option>
        </select>
      </label>
      
      {/* 根据导出模式显示不同的输入字段 */}
      {value.mode === 'single' ? (
        <label className="field">
          <span>时间点</span>
          <input 
            onChange={(event) => onChange({ ...value, time: event.target.value })} 
            value={value.time ?? '00:00:05.000'}
          />
        </label>
      ) : (
        <label className="field">
          <span>间隔秒数</span>
          <input 
            min={1} 
            onChange={(event) => onChange({ ...value, intervalSeconds: Number(event.target.value) || 5 })} 
            type="number" 
            value={value.intervalSeconds ?? 5} 
          />
        </label>
      )}
      
      {/* 图片格式选择：JPG或PNG */}
      <label className="field">
        <span>图片格式</span>
        <select 
          value={value.imageFormat} 
          onChange={(event) => onChange({ ...value, imageFormat: event.target.value as ExportFrameTaskConfig['imageFormat'] })}
        >
          <option value="jpg">jpg</option>
          <option value="png">png</option>
        </select>
      </label>
    </section>
  );
}
