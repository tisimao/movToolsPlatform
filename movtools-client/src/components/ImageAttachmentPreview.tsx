import { useState } from 'react';

interface PreviewImage {
  uid: string;
  url: string;
  fileName: string;
}

interface ImageAttachmentPreviewProps {
  images: PreviewImage[];
  onClose: () => void;
}

export function ImageAttachmentPreview({ images, onClose }: ImageAttachmentPreviewProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex];

  if (images.length === 0 || !active) {
    return null;
  }

  return (
    <div className="lens-detail-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="lens-image-preview-modal panel stack-gap"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-heading">
          <div>
            <h3>图片预览</h3>
            <p className="muted">
              {active.fileName} · {activeIndex + 1} / {images.length}
            </p>
          </div>
          <div className="lens-image-preview-actions">
            <button
              className="secondary-button"
              disabled={images.length <= 1}
              onClick={() =>
                setActiveIndex((i) =>
                  i > 0 ? i - 1 : images.length - 1,
                )
              }
              type="button"
            >
              上一张
            </button>
            <button
              className="secondary-button"
              disabled={images.length <= 1}
              onClick={() =>
                setActiveIndex((i) =>
                  i < images.length - 1 ? i + 1 : 0,
                )
              }
              type="button"
            >
              下一张
            </button>
            <button className="secondary-button" onClick={onClose} type="button">
              关闭
            </button>
          </div>
        </div>
        <div className="lens-image-preview-frame">
          <img
            alt={active.fileName}
            className="lens-image-preview-image"
            src={active.url}
          />
        </div>
      </div>
    </div>
  );
}
