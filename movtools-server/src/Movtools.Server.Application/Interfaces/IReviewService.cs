using Movtools.Server.Application.Contracts.Reviews;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 审核服务接口
/// </summary>
public interface IReviewService
{
    /// <summary>
    /// 提交镜头审核
    /// </summary>
    Task<ReviewTaskResult> SubmitForReviewAsync(Guid lensId, string? comment, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 根据ID获取审核任务
    /// </summary>
    Task<ReviewTaskResult?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// 获取任务详情
    /// </summary>
    Task<ReviewTaskResult?> GetTaskDetailAsync(Guid id, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取待审核任务列表
    /// </summary>
    Task<IReadOnlyList<ReviewTaskResult>> GetPendingReviewsAsync(CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 根据镜头获取审核任务列表
    /// </summary>
    Task<IReadOnlyList<ReviewTaskResult>> GetReviewsByLensAsync(Guid lensId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 审核通过
    /// </summary>
    Task<ReviewTaskResult> ApproveAsync(Guid id, string? comment, long rowVersion, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 审核拒绝
    /// </summary>
    Task<ReviewTaskResult> RejectAsync(Guid id, string? comment, long rowVersion, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 关闭审核任务
    /// </summary>
    Task<ReviewTaskResult> CloseAsync(Guid id, long rowVersion, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 添加审核评论
    /// </summary>
    Task<ReviewCommentResult> AddCommentAsync(Guid reviewTaskId, CreateReviewCommentRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// 创建反馈卡片
    /// </summary>
    Task<ReviewCommentResult> CreateFeedbackAsync(CreateReviewFeedbackRequest request, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取审核评论列表
    /// </summary>
    Task<IReadOnlyList<ReviewCommentResult>> GetCommentsAsync(Guid reviewTaskId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 获取镜头反馈卡片列表
    /// </summary>
    Task<IReadOnlyList<ReviewCommentResult>> GetFeedbacksByLensAsync(Guid lensId, Guid? feedbackRoundId = null, bool includeAllRounds = false, CancellationToken cancellationToken = default);

    /// <summary>
    /// 获取镜头当前轮绘制帧集合
    /// </summary>
    Task<IReadOnlyList<ReviewDrawingFrameResult>> GetDrawingFramesByLensAsync(Guid lensId, Guid? feedbackRoundId = null, bool includeAllRounds = false, CancellationToken cancellationToken = default);

    /// <summary>
    /// 获取镜头反馈轮次及正式绘制时间线
    /// </summary>
    Task<ReviewFeedbackLensResult> GetFeedbackLensAsync(Guid lensId, Guid? feedbackRoundId = null, bool includeAllRounds = false, CancellationToken cancellationToken = default);

    /// <summary>
    /// 根据ID获取反馈卡片
    /// </summary>
    Task<ReviewCommentResult?> GetFeedbackByIdAsync(Guid feedbackId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 更新反馈卡片
    /// </summary>
    Task<ReviewCommentResult> UpdateFeedbackAsync(Guid feedbackId, UpdateReviewFeedbackRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// 删除反馈卡片
    /// </summary>
    Task DeleteFeedbackAsync(Guid feedbackId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 创建审片任务
    /// </summary>
    Task<ReviewTaskResult> CreateTaskAsync(CreateReviewTaskRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// 查询审片任务列表
    /// </summary>
    Task<IReadOnlyList<ReviewTaskResult>> GetTasksAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 查询审片任务详情
    /// </summary>
    Task<ReviewTaskResult?> GetTaskByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// 更新审片任务
    /// </summary>
    Task<ReviewTaskResult> UpdateTaskAsync(Guid id, UpdateReviewTaskRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// 提交审片任务
    /// </summary>
    Task<ReviewTaskResult> SubmitTaskAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// 开始审片任务
    /// </summary>
    Task<ReviewTaskResult> StartTaskAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// 完成审片任务
    /// </summary>
    Task<ReviewTaskResult> CompleteTaskAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// 关闭审片任务
    /// </summary>
    Task<ReviewTaskResult> CloseTaskAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// 添加任务镜头
    /// </summary>
    Task<IReadOnlyList<ReviewTaskShotResult>> AddTaskShotsAsync(Guid id, IReadOnlyList<CreateReviewTaskShotRequest> shots, CancellationToken cancellationToken = default);

    /// <summary>
    /// 移除任务镜头
    /// </summary>
    Task<IReadOnlyList<ReviewTaskShotResult>> RemoveTaskShotsAsync(Guid id, IReadOnlyList<Guid> taskShotIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// 调整任务镜头顺序
    /// </summary>
    Task<IReadOnlyList<ReviewTaskShotResult>> ReorderTaskShotsAsync(Guid id, IReadOnlyList<Guid> orderedTaskShotIds, CancellationToken cancellationToken = default);
}

public record CreateReviewTaskRequest(
    string ProjectCode,
    Guid? EpisodeId,
    string Name,
    string? Description,
    Guid? DirectorUserId,
    DateTimeOffset? DueAtUtc,
    IReadOnlyList<CreateReviewTaskShotRequest> Shots);

public record UpdateReviewTaskRequest(
    string Name,
    string? Description,
    Guid? DirectorUserId,
    DateTimeOffset? DueAtUtc,
    IReadOnlyList<CreateReviewTaskShotRequest>? Shots);

public record CreateReviewTaskShotRequest(
    Guid LensId,
    int Sequence,
    string? SubmitVersionNum,
    string ParticipationMode);

public record CreateReviewCommentRequest(
    string Content,
    double? TimestampSeconds,
    string? DecisionCode,
    int? FrameNumber,
    string? FrameImagePath,
    string? AnnotatedImagePath,
    string? ThumbnailPath,
    string? AnnotationDataJson);

public record CreateReviewFeedbackRequest(
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
    IReadOnlyList<CreateReviewDrawingFrameRequest>? DrawingFrames = null);

public record UpdateReviewFeedbackRequest(
    string? CommentText,
    IReadOnlyList<string>? Tags,
    string? DecisionCode,
    string? AnnotatedImagePath,
    string? ThumbnailPath,
    string? AnnotationDataJson,
    IReadOnlyList<CreateReviewDrawingFrameRequest>? DrawingFrames = null,
    Guid? TaskShotId = null);

public record CreateReviewDrawingFrameRequest(
    int? FrameNumber,
    double? TimestampSeconds,
    string? Timecode,
    string DrawingStateCode,
    string? DrawingObjectsJson);
