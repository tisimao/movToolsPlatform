/**
 * 输出目录选择器组件属性
 */
interface OutputDirectoryPickerProps {
  /** 当前输出目录路径 */
  outputDir: string;
  /** 输出目录变更回调函数 */
  onOutputDirChange: (outputDir: string) => void;
}

/**
 * 输出目录选择器组件
 * 用于选择和显示输出目录路径，支持通过系统文件夹选择器选择目录
 * @param props 组件属性
 * @returns JSX元素
 */
export function OutputDirectoryPicker({ outputDir, onOutputDirChange }: OutputDirectoryPickerProps) {
  /**
   * 处理选择目录按钮点击事件
   * 调用系统文件夹选择器并更新输出目录
   */
  async function handlePickDirectory(): Promise<void> {
    const nextPath = await window.movtools.dialog.pickDirectory();
    if (nextPath) {
      onOutputDirChange(nextPath);
    }
  }

  return (
    <section className="section-block output-directory-block">
      <div className="section-heading output-directory-header">
        <h3>输出目录</h3>
        <button 
          className="secondary-button" 
          onClick={() => void handlePickDirectory()} 
          type="button"
        >
          选择文件夹
        </button>
      </div>
      {/* 显示当前输出目录路径或提示信息 */}
      <p className="path-copy">{outputDir || '暂时还没有选择输出目录。'}</p>
    </section>
  );
}
