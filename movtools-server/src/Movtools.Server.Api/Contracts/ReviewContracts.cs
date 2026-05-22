using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Api.Contracts;

public record ReviewSubmitRequest(Guid LensId, string? Comment);

public record ReviewActionRequest(string Action, string? Comment, long RowVersion);

public record ReviewCommentCreateRequest(string Content, double? TimestampSeconds);

public record ReviewTaskResponse(
    Guid Id,
    string ProjectCode,
    Guid? EpisodeId,
    string? EpisodeCode,
    string Name,
    string? Description,
    Guid? DirectorUserId,
    string? DirectorDisplayName,
    Guid? LensId,
    string? LensCode,
    string? LensName,
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
    int CommentCount)
{
    public IReadOnlyList<ReviewTaskShotResponse> Shots { get; init; } = Array.Empty<ReviewTaskShotResponse>();
    public ReviewTaskSummaryResponse? Summary { get; init; }
}

public partial record ReviewCommentResponse(
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
    IReadOnlyList<ReviewDrawingFrameResponse>? DrawingFrames = null);

public partial record ReviewCommentResponse
{
    public string CommentText => Content;
}

public record ReviewTaskShotResponse(
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

public record ReviewTaskSummaryResponse(
    int ShotCount,
    int FeedbackCount,
    int InternalApprovedCount,
    int PendingFeedbackCount,
    string? SubmitterDisplayName,
    string? DirectorDisplayName,
    DateTimeOffset? DueAtUtc,
    DateTimeOffset? LatestUpdatedAtUtc,
    DateTimeOffset? LatestFeedbackAtUtc);

public record ReviewTaskCreateRequest(
    string ProjectCode,
    Guid? EpisodeId,
    string Name,
    string? Description,
    Guid? DirectorUserId,
    DateTimeOffset? DueAtUtc,
    IReadOnlyList<ReviewTaskShotCreateRequest> Shots);

public record ReviewTaskUpdateRequest(
    string Name,
    string? Description,
    Guid? DirectorUserId,
    DateTimeOffset? DueAtUtc);

public record ProducerReviewTaskCreateRequest(
    string ProjectId,
    Guid? EpisodeId,
    string? TaskName,
    Guid? DirectorId,
    string? Description,
    DateTimeOffset? DeadlineUtc,
    IReadOnlyList<Guid>? ShotIds);

public record ProducerReviewTaskUpdateRequest(
    string? TaskName,
    Guid? DirectorId,
    string? Description,
    DateTimeOffset? DeadlineUtc);

public record ProducerReviewTaskShotIdsRequest(
    IReadOnlyList<Guid> ShotIds);

public record ProducerReviewTaskReorderRequest(
    IReadOnlyList<Guid> ShotIds);

public record ReviewTaskShotCreateRequest(
    Guid LensId,
    int Sequence,
    string? SubmitVersionNum,
    string ParticipationMode = "review");

public record ReviewFeedbackCreateRequest(
    Guid ReviewTaskId,
    Guid LensId,
    string? VersionNum,
    int? FrameNumber,
    string? Timecode,
    string? CommentText,
    IReadOnlyList<string>? Tags,
    string? DecisionCode,
    string? FrameImagePath,
    string? AnnotatedImagePath,
    string? ThumbnailPath,
    string? AnnotationDataJson,
    Guid? TaskShotId = null,
    Guid? FeedbackRoundId = null,
    IReadOnlyList<ReviewDrawingFrameUpsertRequest>? DrawingFrames = null);

public record ReviewFeedbackUpdateRequest(
    string? CommentText,
    IReadOnlyList<string>? Tags,
    string? DecisionCode,
    string? AnnotatedImagePath,
    string? ThumbnailPath,
    string? AnnotationDataJson,
    IReadOnlyList<ReviewDrawingFrameUpsertRequest>? DrawingFrames = null,
    Guid? TaskShotId = null);

public partial record ReviewFeedbackResponse(
    Guid Id,
    Guid ReviewTaskId,
    Guid LensId,
    string LensCode,
    string? VersionNum,
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
    IReadOnlyList<ReviewDrawingFrameResponse>? DrawingFrames = null);

public partial record ReviewFeedbackResponse
{
    public string CommentText => Content;
}

public record ReviewFeedbackRoundResponse(
    Guid FeedbackRoundId,
    DateTimeOffset CreatedAtUtc,
    int FeedbackCount,
    IReadOnlyList<ReviewDrawingFrameResponse> DrawingFrames);

public record ReviewFeedbackLensResponse(
    Guid LensId,
    Guid? LatestFeedbackRoundId,
    DateTimeOffset? LatestFeedbackAtUtc,
    IReadOnlyList<ReviewFeedbackResponse> Feedbacks,
    IReadOnlyList<ReviewDrawingFrameResponse> DrawingFrames,
    ReviewFeedbackRoundResponse? LatestRound = null,
    bool IncludeAllRounds = false);

public record ReviewDrawingFrameResponse(
    int? FrameNumber,
    double? TimestampSeconds,
    string? Timecode,
    string DrawingStateCode,
    string? DrawingObjectsJson);

public record ReviewDrawingFrameUpsertRequest(
    int? FrameNumber,
    double? TimestampSeconds,
    string? Timecode,
    string DrawingStateCode,
    string? DrawingObjectsJson);
