import type { TrimTaskConfig } from '../types/task';

/**
 * 裁剪设置表单组件属性
 */
interface TrimFormProps {
  /** 当前裁剪任务配置 */
  value: TrimTaskConfig;
  /** 配置变更回调函数 */
  onChange: (value: TrimTaskConfig) => void;
}

/**
 * 裁剪设置表单组件
 * 用于配置视频裁剪的参数，包括开始时间、结束时间和是否重新编码
 * @param props 表单属性
 * @returns JSX元素
 */
export function TrimForm({ value, onChange }: TrimFormProps) {
  return (
    <section className="section-block form-grid">
      {/* 开始时间输入框 */}
      <label className="field">
        <span>开始时间</span>
        <input 
          onChange={(event) => onChange({ ...value, startTime: event.target.value })} 
          value={value.startTime} 
        />
      </label>
      
      {/* 结束时间输入框 */}
      <label className="field">
        <span>结束时间</span>
        <input 
          onChange={(event) => onChange({ ...value, endTime: event.target.value })} 
          value={value.endTime} 
        />
      </label>
      
      {/* 重新编码选项：勾选后将重新编码视频以获得更精准的裁剪（但处理时间更长） */}
      <label className="checkbox-field">
        <input 
          checked={value.reencode} 
          onChange={(event) => onChange({ ...value, reencode: event.target.checked })} 
          type="checkbox" 
        />
        <span>重新编码以获得更精准裁剪</span>
      </label>
    </section>
  );
}
