import type { CompressTaskConfig } from '../types/task';

/**
 * 压缩设置表单组件
 * 用于选择视频压缩预设
 */
interface CompressFormProps {
  /** 当前压缩任务配置 */
  value: CompressTaskConfig;
  /** 配置变更回调函数 */
  onChange: (value: CompressTaskConfig) => void;
}

/**
 * 压缩预设选择表单
 * @param props 表单属性
 * @returns JSX元素
 */
export function CompressForm({ value, onChange }: CompressFormProps) {
  return (
    <section className="section-block form-grid">
      <label className="field">
        <span>压缩预设</span>
        <select 
          value={value.preset} 
          onChange={(event) => onChange({ ...value, preset: event.target.value as CompressTaskConfig['preset'] })}
        >
          <option value="high-quality">高质量</option>
          <option value="balanced">平衡</option>
          <option value="small-size">小体积</option>
        </select>
      </label>
    </section>
  );
}
