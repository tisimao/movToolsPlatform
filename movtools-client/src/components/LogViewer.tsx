/**
 * 日志查看器组件属性
 */
interface LogViewerProps {
  /** 日志行数组 */
  lines: string[];
}

/**
 * 日志查看器组件
 * 用于显示多行日志内容，保持原始格式和换行
 * @param props 组件属性
 * @returns JSX元素
 */
export function LogViewer({ lines }: LogViewerProps) {
  return (
    <section className="panel stack-gap logs-viewer-panel">
      <div className="section-heading">
        <div>
          <h3>日志内容</h3>
          <div className="section-heading-tags">
            <span className="section-heading-tag">实时文本</span>
          </div>
        </div>
      </div>
      {/* 使用pre标签保持换行和空格格式 */}
      <pre className="log-viewer">{lines.join('\n')}</pre>
    </section>
  );
}
