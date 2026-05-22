import type { TranscodeTaskConfig } from '../types/task';

/**
 * 转码设置表单组件属性
 */
interface TranscodeFormProps {
  /** 当前转码任务配置 */
  value: TranscodeTaskConfig;
  /** 配置变更回调函数 */
  onChange: (value: TranscodeTaskConfig) => void;
}

/**
 * 转码设置表单组件
 * 用于配置视频转码的各种参数，包括输出格式、视频编码、分辨率、帧率、码率模式和音频编码
 * @param props 表单属性
 * @returns JSX元素
 */
export function TranscodeForm({ value, onChange }: TranscodeFormProps) {
  return (
    <section className="section-block form-grid">
      {/* 输出格式选择：MP4、MOV或WebM */}
      <label className="field">
        <span>输出格式</span>
        <select 
          value={value.format} 
          onChange={(event) => onChange({ ...value, format: event.target.value as TranscodeTaskConfig['format'] })}
        >
          <option value="mp4">mp4</option>
          <option value="mov">mov</option>
          <option value="webm">webm</option>
        </select>
      </label>
      
      {/* 视频编码选择：H.264、HEVC或VP9 */}
      <label className="field">
        <span>视频编码</span>
        <select 
          value={value.videoCodec} 
          onChange={(event) => onChange({ ...value, videoCodec: event.target.value as TranscodeTaskConfig['videoCodec'] })}
        >
          <option value="h264">h264</option>
          <option value="hevc">hevc</option>
          <option value="vp9">vp9</option>
        </select>
      </label>
      
      {/* 分辨率选择：保持原始、1080p、720p或自定义 */}
      <label className="field">
        <span>分辨率</span>
        <select 
          value={value.resolution} 
          onChange={(event) => onChange({ ...value, resolution: event.target.value as TranscodeTaskConfig['resolution'] })}
        >
          <option value="source">保持原始</option>
          <option value="1080p">1080p</option>
          <option value="720p">720p</option>
          <option value="custom">自定义</option>
        </select>
      </label>
      
      {/* 码率模式选择：CRF（恒定质量）或固定码率 */}
      <label className="field">
        <span>码率模式</span>
        <select 
          value={value.rateMode} 
          onChange={(event) => onChange({ ...value, rateMode: event.target.value as TranscodeTaskConfig['rateMode'] })}
        >
          <option value="crf">CRF</option>
          <option value="bitrate">固定码率</option>
        </select>
      </label>
      
      {/* 帧率选择：保持原始、24fps、30fps或60fps */}
      <label className="field">
        <span>帧率</span>
        <select
          value={String(value.fps)}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange({
              ...value,
              fps: nextValue === 'source' ? 'source' : Number(nextValue) as 24 | 30 | 60,
            });
          }}
        >
          <option value="source">保持原始</option>
          <option value="24">24</option>
          <option value="30">30</option>
          <option value="60">60</option>
        </select>
      </label>
      
      {/* 自定义分辨率的宽度和高度输入框（仅当分辨率为自定义时显示） */}
      {value.resolution === 'custom' ? (
        <>
          <label className="field">
            <span>宽度</span>
            <input 
              min={2} 
              onChange={(event) => onChange({ ...value, width: Number(event.target.value) || 1280 })} 
              type="number" 
              value={value.width ?? 1280} 
            />
          </label>
          <label className="field">
            <span>高度</span>
            <input 
              min={2} 
              onChange={(event) => onChange({ ...value, height: Number(event.target.value) || 720 })} 
              type="number" 
              value={value.height ?? 720} 
            />
          </label>
        </>
      ) : null}
      
      {/* 根据码率模式显示不同的参数输入框 */}
      {value.rateMode === 'crf' ? (
        <label className="field">
          <span>CRF</span>
          <input 
            max={51} 
            min={0} 
            onChange={(event) => onChange({ ...value, crf: Number(event.target.value) || 23 })} 
            type="number" 
            value={value.crf ?? 23} 
          />
        </label>
      ) : (
        <label className="field">
          <span>视频码率 (kbps)</span>
          <input 
            min={100} 
            onChange={(event) => onChange({ ...value, bitrateKbps: Number(event.target.value) || 2500 })} 
            type="number" 
            value={value.bitrateKbps ?? 2500} 
          />
        </label>
      )}
      
      {/* 音频编码选择：AAC、MP3或直接复制 */}
      <label className="field">
        <span>音频编码</span>
        <select 
          value={value.audioCodec ?? 'aac'} 
          onChange={(event) => onChange({ ...value, audioCodec: event.target.value as NonNullable<TranscodeTaskConfig['audioCodec']> })}
        >
          <option value="aac">aac</option>
          <option value="mp3">mp3</option>
          <option value="copy">直接复制</option>
        </select>
      </label>
    </section>
  );
}
