namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 镜头实体
/// </summary>
public sealed class Lens : EntityBase
{
    /// <summary>
    /// 镜头代码（唯一标识）
    /// </summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>
    /// 镜头名称
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 所属剧集ID
    /// </summary>
    public Guid EpisodeId { get; set; }

    /// <summary>
    /// 所属剧集实体
    /// </summary>
    public Episode Episode { get; set; } = null!;

    /// <summary>
    /// 当前状态
    /// </summary>
    public string Status { get; set; } = LensStatuses.Wip;

    /// <summary>
    /// 序号（用于排序）
    /// </summary>
    public int Sequence { get; set; }

    /// <summary>
    /// 单镜头帧数
    /// </summary>
    public int SingleFrame { get; set; }

    /// <summary>
    /// 镜头描述
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// 制作人员
    /// </summary>
    public string? Maker { get; set; }

    /// <summary>
    /// 正式负责人账号ID
    /// </summary>
    public Guid? MakerUserId { get; set; }

    /// <summary>
    /// 制作人员原始姓名
    /// </summary>
    public string? MakerNameRaw { get; set; }

    /// <summary>
    /// 制作人员匹配状态
    /// </summary>
    public string? MakerMatchStatus { get; set; }

    /// <summary>
    /// 根镜头代码
    /// </summary>
    public string? RootCode { get; set; }

    /// <summary>
    /// 逻辑路径
    /// </summary>
    public string? LogicalPath { get; set; }

    /// <summary>
    /// 版本标签
    /// </summary>
    public string? VersionTag { get; set; }

    /// <summary>
    /// 当前版本号
    /// </summary>
    public string? VersionNum { get; set; } = "V01";

    /// <summary>
    /// 内部审片状态码
    /// </summary>
    public string InternalReviewStatusCode { get; set; } = LensInternalReviewStatuses.NotInReview;

    /// <summary>
    /// 内部审片状态更新时间
    /// </summary>
    public DateTimeOffset? InternalReviewUpdatedAtUtc { get; set; }

    /// <summary>
    /// 最近审片任务ID
    /// </summary>
    public Guid? LatestReviewTaskId { get; set; }

    /// <summary>
    /// 最近导演反馈时间
    /// </summary>
    public DateTimeOffset? LatestDirectorFeedbackAtUtc { get; set; }

    /// <summary>
    /// 待处理导演反馈数量
    /// </summary>
    public int PendingDirectorFeedbackCount { get; set; }

    /// <summary>
    /// 布局标签
    /// </summary>
    public string? LayoutTag { get; set; }

    /// <summary>
    /// 备注
    /// </summary>
    public string? Comment { get; set; }

    /// <summary>
    /// 是否已归档
    /// </summary>
    public bool IsArchived { get; set; }

    /// <summary>
    /// 行版本（用于并发控制）
    /// </summary>
    public long RowVersion { get; set; }

    /// <summary>
    /// 状态历史记录集合
    /// </summary>
    public ICollection<LensStatusHistory> StatusHistories { get; set; } = [];

    /// <summary>
    /// 文件绑定集合
    /// </summary>
    public ICollection<LensFileBinding> FileBindings { get; set; } = [];
}

/// <summary>
/// 镜头状态常量
/// </summary>
public static class LensStatuses
{
    /// <summary>工作中</summary>
    public const string Wip = "WIP";
    /// <summary>已提交</summary>
    public const string Submitted = "SUBMITTED";
    /// <summary>审核中</summary>
    public const string InReview = "IN_REVIEW";
    /// <summary>已通过</summary>
    public const string Approved = "APPROVED";
    /// <summary>返修中</summary>
    public const string Rework = "REWORK";
    /// <summary>已拒绝</summary>
    public const string Rejected = "REJECTED";
    /// <summary>已关闭</summary>
    public const string Closed = "CLOSED";

    /// <summary>
    /// 所有状态列表
    /// </summary>
    public static readonly string[] All = [Wip, Submitted, InReview, Approved, Rework, Rejected, Closed];

    /// <summary>
    /// 验证状态是否有效
    /// </summary>
    public static bool IsValid(string status) => All.Contains(status);

    /// <summary>
    /// 允许的状态转换映射
    /// </summary>
    public static readonly Dictionary<string, string[]> AllowedTransitions = new()
    {
        [Wip] = [Submitted, Closed],
        [Submitted] = [Wip, InReview, Rework],
        [InReview] = [Approved, Rejected, Rework],
        [Approved] = [Rework, Rejected, Closed],
        [Rework] = [Wip, Submitted],
        [Rejected] = [Wip, Submitted],
        [Closed] = [Wip]
    };

    /// <summary>
    /// 检查是否可以从一个状态转换到另一个状态
    /// </summary>
    public static bool CanTransition(string from, string to)
    {
        return AllowedTransitions.TryGetValue(from, out var allowed) && allowed.Contains(to);
    }
}

/// <summary>
/// 镜头制作人员匹配状态常量
/// </summary>
public static class LensMakerMatchStatuses
{
    public const string Matched = "matched";
    public const string Unmatched = "unmatched";
    public const string Unassigned = "unassigned";

    public static readonly string[] All = [Matched, Unmatched, Unassigned];

    public static bool IsValid(string? status)
        => !string.IsNullOrWhiteSpace(status) && All.Contains(status.Trim().ToLowerInvariant());

    public static string Normalize(string? status)
        => string.IsNullOrWhiteSpace(status) ? Unassigned : status.Trim().ToLowerInvariant();
}

/// <summary>
/// 镜头内部审片状态常量
/// </summary>
public static class LensInternalReviewStatuses
{
    public const string NotInReview = "NOT_IN_REVIEW";
    public const string ReadyForReview = "READY_FOR_REVIEW";
    public const string InDirectorReview = "IN_DIRECTOR_REVIEW";
    public const string PendingFeedbackFix = "PENDING_FEEDBACK_FIX";
    public const string FixUpdated = "FIX_UPDATED";
    public const string DirectorApproved = "DIRECTOR_APPROVED";

    public static readonly string[] All =
    [NotInReview, ReadyForReview, InDirectorReview, PendingFeedbackFix, FixUpdated, DirectorApproved];

    public static bool IsValid(string? status)
        => !string.IsNullOrWhiteSpace(status) && All.Contains(status.Trim().ToUpperInvariant());

    public static string Normalize(string? status)
        => string.IsNullOrWhiteSpace(status) ? NotInReview : status.Trim().ToUpperInvariant();

        public static bool CanTransition(string from, string to)
        {
            var normalizedFrom = Normalize(from);
            var normalizedTo = Normalize(to);
            return normalizedFrom switch
            {
                NotInReview => normalizedTo is ReadyForReview,
                ReadyForReview => normalizedTo is InDirectorReview,
                InDirectorReview => normalizedTo is PendingFeedbackFix or DirectorApproved,
                PendingFeedbackFix => normalizedTo is FixUpdated,
                FixUpdated => normalizedTo is ReadyForReview,
                DirectorApproved => false,
                _ => false
            };
        }
}
