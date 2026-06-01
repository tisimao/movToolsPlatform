namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 审核评论实体
/// </summary>
public sealed class ReviewComment : EntityBase
{
    /// <summary>
    /// 关联镜头ID
    /// </summary>
    public Guid? LensId { get; set; }

    /// <summary>
    /// 关联镜头实体
    /// </summary>
    public Lens? Lens { get; set; }

    /// <summary>
    /// 提审版本号
    /// </summary>
    public string? VersionNum { get; set; }

    /// <summary>
    /// 反馈附件原始帧文件路径
    /// </summary>
    public string? FrameImagePath { get; set; }

    /// <summary>
    /// 反馈附件标注图路径
    /// </summary>
    public string? AnnotatedImagePath { get; set; }

    /// <summary>
    /// 反馈附件缩略图路径
    /// </summary>
    public string? ThumbnailPath { get; set; }

    /// <summary>
    /// 标注数据 JSON
    /// </summary>
    public string? AnnotationDataJson { get; set; }

    /// <summary>
    /// 反馈轮次ID
    /// </summary>
    public Guid? FeedbackRoundId { get; set; }

    /// <summary>
    /// 时间码
    /// </summary>
    public string? Timecode { get; set; }

    /// <summary>
    /// 标签 JSON
    /// </summary>
    public string? TagsJson { get; set; }

    /// <summary>
    /// 审核任务ID
    /// </summary>
    public Guid ReviewTaskId { get; set; }

    /// <summary>
    /// 审核任务实体
    /// </summary>
    public ReviewTask ReviewTask { get; set; } = null!;

    /// <summary>
    /// 创建人用户ID
    /// </summary>
    public Guid? CreatedByUserId { get; set; }

    /// <summary>
    /// 创建人用户实体
    /// </summary>
    public User? CreatedByUser { get; set; }

    /// <summary>
    /// 评论内容
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// 反馈决策
    /// </summary>
    public string? DecisionCode { get; set; }

    /// <summary>
    /// 反馈帧号
    /// </summary>
    public int? FrameNumber { get; set; }

    /// <summary>
    /// 时间戳（视频开始后的秒数），空表示普通评论
    /// </summary>
    public double? TimestampSeconds { get; set; }

    /// <summary>
    /// 创建人显示名称（冗余存储）
    /// </summary>
    public string? CreatedByUserName { get; set; }

    public Guid? TaskShotId { get; set; }
}
