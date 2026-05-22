import type { MergeVideoTaskConfig } from '../types/task';

/**
 * 合并视频设置表单组件属性
 */
interface MergeVideoFormProps {
  /** 输入文件路径数组 */
  inputPaths: string[];
  /** 向下移动项的回调函数 */
  onMoveDown: (index: number) => void;
  /** 向上移动项的回调函数 */
  onMoveUp: (index: number) => void;
  /** 移除项的回调函数 */
  onRemove: (index: number) => void;
  /** 配置变更回调函数 */
  onChange: (value: MergeVideoTaskConfig) => void;
  /** 当前合并视频任务配置 */
  value: MergeVideoTaskConfig;
}

/**
 * 合并视频设置表单组件
 * 用于配置视频合并的参数，包括输入文件排序、拼接模式和输出文件名
 * @param props 表单属性
 * @returns JSX元素
 */
export function MergeVideoForm({ inputPaths, onMoveDown, onMoveUp, onRemove, onChange, value }: MergeVideoFormProps) {
  return (
    <section className="section-block stack-gap">
      <div className="section-heading">
        <div>
          <h3>拼接设置</h3>
          <p className="muted">先按顺序整理视频，再选择拼接模式。</p>
        </div>
        <span className="muted">共 {inputPaths.length} 段</span>
      </div>

      <div className="form-grid">
        {/* 拼接模式选择：快速拼接或兼容拼接 */}
        <label className="field">
          <span>拼接模式</span>
          <select 
            value={value.mode} 
            onChange={(event) => onChange({ ...value, mode: event.target.value as MergeVideoTaskConfig['mode'] })}
          >
            <option value="fast">快速拼接（编码一致时速度更快）</option>
            <option value="compatible">兼容拼接（先统一编码，更稳）</option>
          </select>
        </label>

        {/* 输出文件名输入框 */}
        <label className="field">
          <span>输出文件名</span>
          <input 
            onChange={(event) => onChange({ ...value, outputName: event.target.value })} 
            value={value.outputName} 
          />
        </label>
      </div>

      {/* 输入文件列表及操作按钮 */}
      <div className="merge-list">
        {inputPaths.length > 0 ? (
          inputPaths.map((filePath, index) => (
            <div className="merge-item" key={`${filePath}-${index}`}>
              <div>
                <strong>第 {index + 1} 段</strong>
                <p className="muted file-name">{filePath}</p>
              </div>
              <div className="actions-row compact-actions">
                {/* 上移按钮：第一项不可用 */}
                <button 
                  className="secondary-button" 
                  disabled={index === 0} 
                  onClick={() => onMoveUp(index)} 
                  type="button"
                >
                  上移
                </button>
                {/* 下移按钮：最后一项不可用 */}
                <button 
                  className="secondary-button" 
                  disabled={index === inputPaths.length - 1} 
                  onClick={() => onMoveDown(index)} 
                  type="button"
                >
                  下移
                </button>
                {/* 移除按钮 */}
                <button 
                  className="secondary-button" 
                  onClick={() => onRemove(index)} 
                  type="button"
                >
                  移除
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="muted">请先选择至少两段视频，再进行排序和拼接。</p>
        )}
      </div>
    </section>
  );
}
