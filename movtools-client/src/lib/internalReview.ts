import type { AppRole } from '../auth/permissions';

/**
 * 镜头二级状态（内部审片状态）类型定义
 *
 * 稳定码集合，对应协议文档第 4.1.3.3 节。
 * 注意：不要与审片任务状态 (ReviewTaskStatus) 混淆。
 *
 * 六种状态的业务含义：
 * - NOT_IN_REVIEW:        未进入审片 — 镜头尚未纳入导演审片流程
 * - READY_FOR_REVIEW:     待提审 — 具备入任务条件，等待制片派工
 * - IN_DIRECTOR_REVIEW:   审片中 — 已进入正式审片任务，导演可审
 * - PENDING_FEEDBACK_FIX: 待处理反馈 — 导演已给出反馈，制作人员待处理
 * - FIX_UPDATED:          已按反馈修改 — 制作人员确认本轮反馈已处理完成
 * - DIRECTOR_APPROVED:    内部通过 — 导演确认当前版本通过
 *
 * 关键规则（禁止违背）：
 * 1. 版本变化不自动重置状态：处于 PENDING_FEEDBACK_FIX 的镜头，
 *    新版本产出后仍保持 PENDING_FEEDBACK_FIX。
 * 2. 草稿任务不改变状态：镜头加入草稿任务时保持原状态。
 * 3. DIRECTOR_APPROVED 保持通过态：
 *    - 不会被草稿任务装配、普通任务刷新、正式提交误推进为 IN_DIRECTOR_REVIEW
 *    - 导演可手动撤销通过，将其回退到 IN_DIRECTOR_REVIEW 重新评审
 *    - 只有导演新的反馈动作才使其回到 PENDING_FEEDBACK_FIX
 * 4. 正式提交任务时，只推动 READY_FOR_REVIEW / FIX_UPDATED 的镜头进入 IN_DIRECTOR_REVIEW
 */
export type InternalReviewStatusCode =
  | 'NOT_IN_REVIEW'
  | 'READY_FOR_REVIEW'
  | 'IN_DIRECTOR_REVIEW'
  | 'PENDING_FEEDBACK_FIX'
  | 'FIX_UPDATED'
  | 'DIRECTOR_APPROVED';

export const INTERNAL_REVIEW_STATUS_LABELS: Record<InternalReviewStatusCode, string> = {
  NOT_IN_REVIEW: '未进入审片',
  READY_FOR_REVIEW: '待提审',
  IN_DIRECTOR_REVIEW: '审片中',
  PENDING_FEEDBACK_FIX: '待处理反馈',
  FIX_UPDATED: '已按反馈修改',
  DIRECTOR_APPROVED: '内部通过',
};

/** 允许正式提交的唯一二级状态 */
export const INTERNAL_REVIEW_SUBMIT_READY_STATUS: InternalReviewStatusCode = 'DIRECTOR_APPROVED';

export function getInternalReviewStatusLabel(status?: InternalReviewStatusCode | null, fallback?: string | null): string {
  if (!status) {
    return fallback?.trim() || '未进入审片';
  }

  return INTERNAL_REVIEW_STATUS_LABELS[status] ?? (fallback?.trim() || status);
}

export function canSubmitLens(internalReviewStatusCode?: InternalReviewStatusCode | null, submissionAllowed?: boolean | null): boolean {
  return internalReviewStatusCode === INTERNAL_REVIEW_SUBMIT_READY_STATUS && submissionAllowed === true;
}

export function getSubmissionDisabledReason(lens: {
  internalReviewStatusCode?: InternalReviewStatusCode | null;
  internalReviewStatusName?: string | null;
  submissionAllowed?: boolean | null;
}): string {
  if (lens.submissionAllowed === false) {
    return '服务端判定当前版本暂不可正式提交。';
  }

  if (lens.submissionAllowed !== true) {
    return '提交判定未返回，暂不可提交。';
  }

  if (lens.internalReviewStatusCode !== INTERNAL_REVIEW_SUBMIT_READY_STATUS) {
    return `当前二级状态为 ${getInternalReviewStatusLabel(lens.internalReviewStatusCode, lens.internalReviewStatusName)}。`;
  }

  return '当前不可提交。';
}

// ==========================================
// 角色权限统一检查函数
// 所有页面的按钮显示条件必须通过此层收口
// ==========================================

/**
 * 制片“标记待提审”：将 NOT_IN_REVIEW 推进到 READY_FOR_REVIEW
 */
export function canMarkReadyForReview(role: AppRole, status?: InternalReviewStatusCode | null): boolean {
  return (role === 'producer' || role === 'admin' || role === 'system-admin') && status === 'NOT_IN_REVIEW';
}

/**
 * 制片“重新提审”：将 FIX_UPDATED 重新推进到 READY_FOR_REVIEW
 */
export function canResubmitForReview(role: AppRole, status?: InternalReviewStatusCode | null): boolean {
  return (role === 'producer' || role === 'admin' || role === 'system-admin') && status === 'FIX_UPDATED';
}

/**
 * 制作人员“已按反馈修改”：将 PENDING_FEEDBACK_FIX 推进到 FIX_UPDATED
 * 按钮只应在此条件为 true 时显示。
 */
export function canMarkFixUpdated(role: AppRole, status?: InternalReviewStatusCode | null): boolean {
  console.log('canMarkFixUpdated role:', role);
  return role === 'maker' && status === 'PENDING_FEEDBACK_FIX';
}

/**
 * 检查镜头是否处于内部通过态
 * 用于各页面在显示/刷新时确保已通过镜头不会被误显示为其他状态
 */
export function isDirectorApproved(status?: InternalReviewStatusCode | null): boolean {
  return status === 'DIRECTOR_APPROVED';
}

/**
 * 获取指定角色可执行的二级状态流转动作列表
 * 注意：
 * - 制片不应手动将镜头推进到 IN_DIRECTOR_REVIEW；
 *   该状态应由"正式提交审片任务"系统联动触发。
 * - 导演不应直接通过此机制改变二级状态，
 *   导演应通过审片工作台中的"保存反馈"/"确认通过"驱动状态变化。
 */
export function getInternalReviewActionsForRole(role: string): InternalReviewStatusCode[] {
  switch (role.toLowerCase()) {
    case 'producer':
    case 'system-admin':
    case 'admin':
      return ['READY_FOR_REVIEW'];
    case 'director':
      return ['PENDING_FEEDBACK_FIX', 'DIRECTOR_APPROVED'];
    case 'maker':
      return ['FIX_UPDATED'];
    default:
      return [];
  }
}

export function canDirectorApproveShot(status?: InternalReviewStatusCode | null): boolean {
  return status === 'IN_DIRECTOR_REVIEW';
}
