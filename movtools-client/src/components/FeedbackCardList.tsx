import type { ReviewFeedback } from '../types/review';
import type { LocalFeedbackDraft } from '../types/localDraft';
import { resolveImageUrl } from '../lib/imageUrl';

export interface FeedbackListItem {
  itemId: string;
  frameNumber: number;
  timecode: string;
  lensCode: string;
  versionNum: string;
  commentText: string;
  previewPath?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  authorName?: string | null;
  sourceFeedbackId?: string | null;
  draftId?: string | null;
  statusLabel: string;
  statusClassName?: string;
  isPendingDelete?: boolean;
  isSubmitted: boolean;
}

interface FeedbackCardListProps {
  items: FeedbackListItem[];
  activeItemId: string | null;
  onSelect: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  onEdit: (itemId: string) => void;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildFeedbackListItemFromDraft(draft: LocalFeedbackDraft): FeedbackListItem {
  const statusLabel = draft.pendingAction === 'delete'
    ? '待删除'
    : draft.pendingAction === 'update'
      ? '待更新'
      : draft.submitStatus === 'failed'
        ? '提交失败'
        : '本地草稿';

  const statusClassName = draft.pendingAction === 'delete'
    ? 'danger-copy'
    : draft.pendingAction === 'update'
      ? 'warning-copy'
      : draft.submitStatus === 'failed'
        ? 'danger-copy'
        : 'muted';

  return {
    itemId: draft.draftId,
    frameNumber: draft.frameNumber,
    timecode: draft.timecode,
    lensCode: draft.lensCode,
    versionNum: draft.versionNum,
    commentText: draft.commentText,
    previewPath: draft.annotatedImageLocalPath || draft.frameImageLocalPath || draft.thumbnailLocalPath || null,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    sourceFeedbackId: draft.sourceFeedbackId ?? draft.submittedFeedbackId ?? null,
    draftId: draft.draftId,
    statusLabel,
    statusClassName,
    isPendingDelete: draft.pendingAction === 'delete',
    isSubmitted: false,
  };
}

export function buildFeedbackListItemFromSubmitted(feedback: ReviewFeedback): FeedbackListItem {
  return {
    itemId: feedback.feedbackId,
    frameNumber: feedback.frameNumber ?? 0,
    timecode: feedback.timecode || '—',
    lensCode: feedback.lensCode,
    versionNum: feedback.versionNum || '—',
    commentText: feedback.commentText || '',
    previewPath: feedback.annotatedImagePath || feedback.frameImagePath || feedback.thumbnailPath || null,
    createdAt: feedback.createdAtUtc,
    updatedAt: feedback.updatedAtUtc,
    authorName: feedback.createdByDisplayName || null,
    sourceFeedbackId: feedback.feedbackId,
    draftId: null,
    statusLabel: '已提交',
    statusClassName: 'success-copy',
    isPendingDelete: false,
    isSubmitted: true,
  };
}

export function FeedbackCardList({
  items,
  activeItemId,
  onSelect,
  onDelete,
  onEdit,
}: FeedbackCardListProps) {
  if (items.length === 0) {
    return (
      <div className="feedback-card-list-empty">
        <p className="muted">当前镜头暂无反馈</p>
        <p className="muted">暂停视频后可在当前帧添加反馈或绘制。</p>
      </div>
    );
  }

  return (
    <div className="feedback-card-list">
      {items.map((item) => {
        const isActive = item.itemId === activeItemId;
        const previewSrc = resolveImageUrl(item.previewPath);
        return (
          <article
            className={`feedback-card-item ${isActive ? 'active' : ''}`}
            key={item.itemId}
            onClick={() => onSelect(item.itemId)}
          >
            <div className="feedback-card-header">
              <div className="feedback-card-meta">
                <strong>{item.lensCode}</strong>
                <span className="feedback-card-frame">
                  #{item.frameNumber || '—'} · {item.timecode}
                </span>
              </div>
              <span className={`feedback-card-status ${item.statusClassName || ''}`.trim()}>
                {item.statusLabel}
              </span>
            </div>
            {previewSrc ? (
              <img alt="反馈图片" className="feedback-card-thumb" src={previewSrc} />
            ) : null}
            <p className="feedback-card-comment">{item.commentText || (item.isPendingDelete ? '该反馈将被删除' : '—')}</p>
            <div className="feedback-card-footer">
              <small className="muted">
                V{item.versionNum} · {formatTime(item.updatedAt || item.createdAt)}{item.authorName ? ` · ${item.authorName}` : ''}
              </small>
              <div className="feedback-card-actions">
                <button
                  className="ghost-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(item.itemId);
                  }}
                  type="button"
                >
                  编辑
                </button>
                <button
                  className="ghost-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item.itemId);
                  }}
                  type="button"
                >
                  删除
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
