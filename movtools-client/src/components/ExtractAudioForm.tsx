import type { ExtractAudioTaskConfig } from '../types/task';

/**
 * 提取音频设置表单组件属性
 */
interface ExtractAudioFormProps {
  /** 当前提取音频任务配置 */
  value: ExtractAudioTaskConfig;
  /** 配置变更回调函数 */
  onChange: (value: ExtractAudioTaskConfig) => void;
}

/**
 * 提取音频设置表单组件
 * 用于配置音频提取的参数，包括输出格式和码率
 * @param props 表单属性
 * @returns JSX元素
 */
export function ExtractAudioForm({ value, onChange }: ExtractAudioFormProps) {
  return (
    <section className="section-block form-grid">
      {/* 输出格式选择：MP3、AAC或WAV */}
      <label className="field">
        <span>输出格式</span>
        <select 
          value={value.format} 
          onChange={(event) => onChange({ ...value, format: event.target.value as ExtractAudioTaskConfig['format'] })}
        >
          <option value="mp3">mp3</option>
          <option value="aac">aac</option>
          <option value="wav">wav</option>
        </select>
      </label>
      
      {/* 音频码率设置（kbps） */}
      <label className="field">
        <span>码率 (kbps)</span>
        <input 
          min={64} 
          onChange={(event) => onChange({ ...value, bitrateKbps: Number(event.target.value) || 192 })} 
          type="number" 
          value={value.bitrateKbps ?? 192} 
        />
      </label>
    </section>
  );
}
