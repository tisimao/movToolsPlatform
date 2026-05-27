namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 导演反馈轮次 canonical timeline
/// </summary>
public sealed class ReviewFeedbackRound : EntityBase
{
    public Guid ReviewTaskId { get; set; }

    public ReviewTask ReviewTask { get; set; } = null!;

    public Guid LensId { get; set; }

    public Lens Lens { get; set; } = null!;

    public Guid FeedbackRoundId { get; set; }

    public string DrawingFramesJson { get; set; } = "[]";

    public int FeedbackCount { get; set; }

    public DateTimeOffset? LatestFeedbackAtUtc { get; set; }

    public long RowVersion { get; set; }
}
