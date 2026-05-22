import { useCallback } from 'react';
import type { ClipboardEvent as ReactClipboardEvent } from 'react';
import {
  type ImageAttachmentItem,
  pickImageFiles,
  extractPastedImages,
  addPendingPaths,
  removeItem,
  moveItem,
  getBaseName,
} from '../lib/imageAttachment';

interface ImageAttachmentEditorProps {
  items: ImageAttachmentItem[];
  onChange: (items: ImageAttachmentItem[]) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function ImageAttachmentEditor({
  items,
  onChange,
  disabled = false,
  compact = false,
}: ImageAttachmentEditorProps) {
  const handlePick = useCallback(async () => {
    const paths = await pickImageFiles();
    if (paths.length === 0) return;
    onChange(addPendingPaths(items, paths));
  }, [items, onChange]);

  const handlePaste = useCallback(
    async (event: ReactClipboardEvent<HTMLElement>) => {
      const paths = await extractPastedImages(event.clipboardData.items);
      if (paths.length === 0) return;
      event.preventDefault();
      onChange(addPendingPaths(items, paths));
    },
    [items, onChange],
  );

  const handleRemove = useCallback(
    (uid: string) => {
      const name = items.find((i) => i.uid === uid)?.fileName || '图片';
      if (!window.confirm(`确认移除「${name}」吗？`)) return;
      onChange(removeItem(items, uid));
    },
    [items, onChange],
  );

  const handleMove = useCallback(
    (uid: string, direction: 'up' | 'down') => {
      onChange(moveItem(items, uid, direction));
    },
    [items, onChange],
  );

  if (!compact) {
    return (
      <div className="image-attachment-editor" onPaste={handlePaste}>
        <div className="section-heading">
          <div>
            <span>图片</span>
            <p className="muted">
              支持 Ctrl+V 粘贴截图，已上传图片可排序和移除。
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={disabled}
            onClick={handlePick}
            type="button"
          >
            选择图片
          </button>
        </div>

        {items.length > 0 ? (
          <div className="image-attachment-grid">
            {items.map((item, index) => (
              <div className="image-attachment-card" key={item.uid}>
                {item.localPath ? (
                  <img
                    alt={item.fileName}
                    className="image-attachment-thumb"
                    src={`file://${item.localPath}`}
                  />
                ) : item.previewUrl ? (
                  <img
                    alt={item.fileName}
                    className="image-attachment-thumb"
                    src={item.previewUrl}
                  />
                ) : (
                  <div className="image-attachment-placeholder" />
                )}
                <span className="image-attachment-name">{item.fileName}</span>
                <span className={`image-attachment-status status-${item.status}`}>
                  {item.status === 'pending'
                    ? '待上传'
                    : item.status === 'uploading'
                      ? '上传中…'
                      : item.status === 'uploaded'
                        ? '已上传'
                        : '上传失败'}
                </span>
                <div className="image-attachment-actions">
                  <button
                    className="secondary-button"
                    disabled={index === 0 || disabled}
                    onClick={() => handleMove(item.uid, 'up')}
                    type="button"
                  >
                    上移
                  </button>
                  <button
                    className="secondary-button"
                    disabled={index === items.length - 1 || disabled}
                    onClick={() => handleMove(item.uid, 'down')}
                    type="button"
                  >
                    下移
                  </button>
                  <button
                    className="secondary-button"
                    disabled={disabled}
                    onClick={() => handleRemove(item.uid)}
                    type="button"
                  >
                    移除
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">当前未选择图片。</p>
        )}
      </div>
    );
  }

  return (
    <div className="image-attachment-editor" onPaste={handlePaste}>
      <div className="section-heading">
        <span>图片附件</span>
        <button
          className="secondary-button"
          disabled={disabled}
          onClick={handlePick}
          type="button"
        >
          选择
        </button>
      </div>
      {items.length > 0 ? (
        <div className="image-attachment-compact-list">
          {items.map((item) => (
            <div className="image-attachment-compact-item" key={item.uid}>
              <span>{item.fileName}</span>
              <button
                className="ghost-button"
                disabled={disabled}
                onClick={() => handleRemove(item.uid)}
                type="button"
              >
                移除
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">暂无图片。</p>
      )}
    </div>
  );
}
