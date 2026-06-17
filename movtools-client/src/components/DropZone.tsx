import type { DragEvent } from 'react';

/**
 * 拖放区域组件属性
 */
interface DropZoneProps {
  /** 是否允许多文件选择 */
  multiple?: boolean;
  /** 已选中的文件路径列表 */
  selectedFiles: string[];
  /** 文件选择回调函数 */
  onFilesSelected: (files: string[]) => void;
}

/**
 * 拖放的文件接口（扩展原生File对象）
 */
interface DroppedFile extends File {
  /** 文件路径（如果可用） */
  path?: string;
}

/**
 * 拖放文件上传区域组件
 * 支持点击选择文件和拖拽上传两种方式
 * @param props 组件属性
 * @returns JSX元素
 */
export function DropZone({ multiple = true, selectedFiles, onFilesSelected }: DropZoneProps) {
  /**
   * 去重文件数组
   * @param files 文件路径数组
   * @returns 去重后的文件路径数组
   */
  const uniqueFiles = (files: string[]) => Array.from(new Set(files));

  /**
   * 处理点击选择文件
   * 通过系统文件选择器选择文件
   */
  async function handlePickFiles(): Promise<void> {
    const filePaths = await window.movtools.dialog.pickFiles();
    onFilesSelected(uniqueFiles(multiple ? filePaths : filePaths.slice(0, 1)));
  }

  /**
   * 处理文件拖放事件
   * @param event 拖放事件
   */
  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    const bridgedPaths = window.movtools.dialog.getDroppedFilePaths?.(files) ?? [];
    const filePaths = bridgedPaths.length > 0
      ? bridgedPaths
      : files
        .map((file) => (file as DroppedFile).path)
        .filter((filePath): filePath is string => Boolean(filePath));

    if (filePaths.length > 0) {
      onFilesSelected(uniqueFiles(multiple ? filePaths : filePaths.slice(0, 1)));
    }
  }

  return (
    <section className="section-block">
      <div className="section-heading">
        <h3>输入文件</h3>
        <button className="secondary-button" onClick={() => void handlePickFiles()} type="button">
          选择文件
        </button>
      </div>

      <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <p>把本地媒体文件拖到这里，或使用系统文件选择器。</p>
        <ul className="file-list">
          {selectedFiles.length > 0 ? selectedFiles.map((filePath) => <li key={filePath}>{filePath}</li>) : <li>暂时还没有选择文件。</li>}
        </ul>
      </div>
    </section>
  );
}
