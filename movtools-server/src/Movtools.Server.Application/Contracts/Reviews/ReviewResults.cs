namespace Movtools.Server.Application.Contracts.Reviews;

public static class ReviewDrawingStateCodes
{
    public const string Drawn = "DRAWN";
    public const string Clear = "CLEAR";

    public static readonly string[] All = [Drawn, Clear];

    public static bool IsValid(string? drawingStateCode)
        => !string.IsNullOrWhiteSpace(drawingStateCode) && All.Contains(drawingStateCode.Trim().ToUpperInvariant());

    public static string Normalize(string? drawingStateCode)
        => string.IsNullOrWhiteSpace(drawingStateCode) ? Drawn : drawingStateCode.Trim().ToUpperInvariant();
}

public sealed record ReviewDrawingFrameResult(
    int? FrameNumber,
    double? TimestampSeconds,
    string? Timecode,
    string DrawingStateCode,
    string? DrawingObjectsJson);

/// <summary>
/// 审核任务结果
/// </summary>
public sealed record ReviewTaskResult(
    Guid Id,
    string ProjectCode,
    Guid? EpisodeId,
    string? EpisodeCode,
    string Name,
    string? Description,
    Guid? DirectorUserId,
    string? DirectorDisplayName,
    string Status,
    string? ResultComment,
    Guid? AssignedToUserId,
    string? AssignedToUserName,
    DateTimeOffset? SubmittedAtUtc,
    DateTimeOffset? CompletedAtUtc,
    DateTimeOffset? DueAtUtc,
    Guid CreatedByUserId,
    string CreatedByUserName,
    long RowVersion,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    int CommentCount,
    Guid? LensId,
    string? LensCode,
    string? LensName,
    IReadOnlyList<ReviewTaskShotResult> Shots,
    ReviewTaskSummaryResult Summary);

/// <summary>
/// 审核评论结果
/// </summary>
public sealed record ReviewCommentResult(
    Guid Id,
    Guid ReviewTaskId,
    Guid CreatedByUserId,
    string CreatedByUserName,
    string Content,
    string? DecisionCode,
    int? FrameNumber,
    double? TimestampSeconds,
    string? Timecode,
    IReadOnlyList<string>? Tags,
    string? FrameImagePath,
    string? AnnotatedImagePath,
    string? ThumbnailPath,
    string? AnnotationDataJson,
    DateTimeOffset CreatedAtUtc,
    Guid? TaskShotId = null,
    Guid? FeedbackRoundId = null,
    IReadOnlyList<ReviewDrawingFrameResult>? DrawingFrames = null,
    Guid? LensId = null,
    string? LensCode = null,
    string? VersionNum = null);

public sealed record ReviewFeedbackRoundResult(
    Guid FeedbackRoundId,
    DateTimeOffset CreatedAtUtc,
    int FeedbackCount,
    IReadOnlyList<ReviewDrawingFrameResult> DrawingFrames);

public sealed record ReviewTaskShotResult(
    Guid Id,
    Guid ReviewTaskId,
    Guid LensId,
    string LensCode,
    int Sequence,
    string ParticipationMode,
    string? SubmitVersionNum,
    string? PlayVersionNum,
    string Status,
    int FeedbackCount,
    DateTimeOffset? LastFeedbackAtUtc,
    string? LensInternalReviewStatusCode,
    DateTimeOffset? LensInternalReviewUpdatedAtUtc,
    Guid? LatestFeedbackId = null);

public sealed record ReviewTaskSummaryResult(
    int ShotCount,
    int FeedbackCount,
    int InternalApprovedCount,
    int PendingFeedbackCount,
    string? SubmitterDisplayName,
    string? DirectorDisplayName,
    DateTimeOffset? DueAtUtc,
    DateTimeOffset? LatestUpdatedAtUtc,
    DateTimeOffset? LatestFeedbackAtUtc);
