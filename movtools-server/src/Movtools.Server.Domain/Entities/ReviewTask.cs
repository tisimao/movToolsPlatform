namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 审核任务实体
/// </summary>
public sealed class ReviewTask : EntityBase
{
    /// <summary>
    /// 所属项目代码
    /// </summary>
    public string ProjectCode { get; set; } = string.Empty;

    /// <summary>
    /// 所属剧集ID
    /// </summary>
    public Guid? EpisodeId { get; set; }

    /// <summary>
    /// 所属剧集代码
    /// </summary>
    public string? EpisodeCode { get; set; }

    /// <summary>
    /// 任务名称
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 任务说明
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// 目标导演用户ID
    /// </summary>
    public Guid? DirectorUserId { get; set; }

    /// <summary>
    /// 目标导演
    /// </summary>
    public User? DirectorUser { get; set; }

    /// <summary>
    /// 任务主镜头ID（兼容字段，通常取首镜头）
    /// </summary>
    public Guid? LensId { get; set; }

    /// <summary>
    /// 镜头实体
    /// </summary>
    public Lens? Lens { get; set; }

    /// <summary>
    /// 审核状态
    /// </summary>
    public string Status { get; set; } = ReviewStatuses.Draft;

    /// <summary>
    /// 提交时间
    /// </summary>
    public DateTimeOffset? SubmittedAtUtc { get; set; }

    /// <summary>
    /// 完成时间
    /// </summary>
    public DateTimeOffset? CompletedAtUtc { get; set; }

    /// <summary>
    /// 截止时间
    /// </summary>
    public DateTimeOffset? DueAtUtc { get; set; }

    /// <summary>
    /// 审核结果备注
    /// </summary>
    public string? ResultComment { get; set; }

    /// <summary>
    /// 分配给的用户ID
    /// </summary>
    public Guid? AssignedToUserId { get; set; }

    /// <summary>
    /// 被分配的用户实体
    /// </summary>
    public User? AssignedToUser { get; set; }

    /// <summary>
    /// 创建人用户ID
    /// </summary>
    public Guid? CreatedByUserId { get; set; }

    /// <summary>
    /// 创建人用户实体
    /// </summary>
    public User? CreatedByUser { get; set; }

    /// <summary>
    /// 行版本（用于并发控制）
    /// </summary>
    public long RowVersion { get; set; }

    /// <summary>
    /// 审核评论集合
    /// </summary>
    public ICollection<ReviewComment> Comments { get; set; } = [];

    /// <summary>
    /// 任务镜头集合
    /// </summary>
    public ICollection<ReviewTaskShot> Shots { get; set; } = [];
}

/// <summary>
/// 审核状态常量
/// </summary>
public static class ReviewStatuses
{
    /// <summary>草稿</summary>
    public const string Draft = "draft";
    /// <summary>待提交（制片装配完成，导演仍不可见）</summary>
    public const string Ready = "ready";
    /// <summary>已提交，导演可见并可开始审片</summary>
    public const string Pending = "pending";
    /// <summary>审片中，导演正在处理</summary>
    public const string InReview = "in-review";
    /// <summary>导演已完成审片，等待制片关闭</summary>
    public const string Completed = "completed";
    /// <summary>制片归档关闭，导演不可见</summary>
    public const string Closed = "closed";
    /// <summary>兼容：进行中</summary>
    public const string InProgress = InReview;
    /// <summary>兼容：已通过</summary>
    public const string Approved = Completed;
    /// <summary>兼容：已拒绝</summary>
    public const string Rejected = Closed;

    /// <summary>
    /// 所有状态列表
    /// </summary>
    public static readonly string[] All = [Draft, Ready, Pending, InReview, Completed, Closed];

    /// <summary>
    /// 验证状态是否有效
    /// </summary>
    public static bool IsValid(string status) => All.Contains(status);
}

/// <summary>
/// 任务镜头状态常量
/// </summary>
public static class ReviewTaskShotStatuses
{
    public const string Unviewed = "UNVIEWED";
    public const string Viewed = "VIEWED";
    public const string Commented = "COMMENTED";
    public const string Done = "DONE";

    public static readonly string[] All = [Unviewed, Viewed, Commented, Done];

    public static bool IsValid(string? status)
        => !string.IsNullOrWhiteSpace(status) && All.Contains(status.Trim().ToUpperInvariant());

    public static string Normalize(string? status)
        => string.IsNullOrWhiteSpace(status) ? Unviewed : status.Trim().ToUpperInvariant();
}

/// <summary>
/// 审片任务镜头参与类型常量
/// </summary>
public static class ReviewTaskShotParticipationModes
{
    public const string Review = "review";
    public const string Context = "context";

    public static readonly string[] All = [Review, Context];

    public static bool IsValid(string? participationMode)
        => !string.IsNullOrWhiteSpace(participationMode) && All.Contains(participationMode.Trim().ToLowerInvariant());

    public static string Normalize(string? participationMode)
        => string.IsNullOrWhiteSpace(participationMode) ? Review : participationMode.Trim().ToLowerInvariant();
}

/// <summary>
/// 审片任务镜头实体
/// </summary>
public sealed class ReviewTaskShot : EntityBase
{
    public Guid ReviewTaskId { get; set; }
    public ReviewTask ReviewTask { get; set; } = null!;

    public Guid LensId { get; set; }
    public Lens Lens { get; set; } = null!;

    public int Sequence { get; set; }
    public string ParticipationMode { get; set; } = null!;
    public string? SubmitVersionNum { get; set; }
    public string? PlayVersionNum { get; set; }
    public string Status { get; set; } = ReviewTaskShotStatuses.Unviewed;
    public int FeedbackCount { get; set; }
    public DateTimeOffset? LastFeedbackAtUtc { get; set; }
    public Guid? LatestFeedbackId { get; set; }
}
