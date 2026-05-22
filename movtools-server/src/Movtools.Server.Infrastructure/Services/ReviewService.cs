using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Movtools.Server.Application.Contracts.Reviews;
using Movtools.Server.Application.Exceptions;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;
using Movtools.Server.Infrastructure.Security;

namespace Movtools.Server.Infrastructure.Services;

/// <summary>
/// 审核服务实现
/// </summary>
public sealed class ReviewService : IReviewService
{
    private readonly MovtoolsDbContext _dbContext;
    private readonly IPermissionService _permissionService;
    private readonly ICurrentUserAccessor _currentUserAccessor;
    private readonly IActivityLogService _activityLogService;
    private readonly ISignalRPublisher? _signalRPublisher;
    private readonly ILogger<ReviewService> _logger;

    public ReviewService(
        MovtoolsDbContext dbContext,
        IPermissionService permissionService,
        ICurrentUserAccessor currentUserAccessor,
        IActivityLogService activityLogService,
        ISignalRPublisher? signalRPublisher = null,
        ILogger<ReviewService>? logger = null)
    {
        _dbContext = dbContext;
        _permissionService = permissionService;
        _currentUserAccessor = currentUserAccessor;
        _activityLogService = activityLogService;
        _signalRPublisher = signalRPublisher;
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <inheritdoc/>
    public async Task<ReviewTaskResult> SubmitForReviewAsync(Guid lensId, string? comment, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        // 加载镜头及其所属剧集和项目
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
            .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        // 检查权限
        var canAccess = await _permissionService.CanAccessProjectAsync(lens.Episode.Project.Code, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this project.");
        }

        // 镜头必须处于 SUBMITTED 状态才能提交审核
        if (lens.Status != LensStatuses.Submitted)
        {
            throw new BusinessException("invalid_lens_status", $"Lens must be in SUBMITTED status to submit for review. Current: {lens.Status}");
        }

        var reviewTask = await CreateTaskInternalAsync(new CreateReviewTaskRequest(
            lens.Episode.Project.Code,
            lens.EpisodeId,
            $"{lens.Code} 审片任务",
            comment,
            null,
            null,
            [new CreateReviewTaskShotRequest(lensId, 1, lens.VersionNum, ReviewTaskShotParticipationModes.Review)]), cancellationToken);

        reviewTask = await SubmitTaskAsync(reviewTask.Id, cancellationToken);

        // 记录提交日志
        await _activityLogService.LogAsync(
            "ReviewTask",
            reviewTask.Id,
            "created",
            null,
            $"Lens:{lens.Code}|Project:{lens.Episode.Project.Code}",
            cancellationToken);

        // 发布 SignalR 事件
        if (_signalRPublisher != null)
        {
            var projectCode = lens.Episode.Project.Code;
            _ = _signalRPublisher.PublishReviewCreatedAsync(projectCode, reviewTask.Id, lens.Id, cancellationToken);
        }

        return reviewTask;
    }

    /// <inheritdoc/>
    public async Task<ReviewTaskResult?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var reviewTask = await _dbContext.ReviewTasks
            .Include(x => x.CreatedByUser)
            .Include(x => x.DirectorUser)
            .Include(x => x.AssignedToUser)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (reviewTask == null) return null;

        var canAccess = await _permissionService.CanAccessProjectAsync(reviewTask.ProjectCode, _currentUserAccessor.GetCurrentUser()?.Id ?? Guid.Empty, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this review.");
        }

        return await MapToResultAsync(reviewTask, cancellationToken);
    }

    /// <inheritdoc/>
    public Task<ReviewTaskResult?> GetTaskDetailAsync(Guid id, CancellationToken cancellationToken = default)
        => GetByIdAsync(id, cancellationToken);

    /// <inheritdoc/>
    public async Task<IReadOnlyList<ReviewTaskResult>> GetPendingReviewsAsync(CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        // 获取用户有权访问的所有项目
        var projectCodes = await _dbContext.ProjectMembers
            .Where(x => x.UserId == currentUser.Id && x.IsActive)
            .Select(x => x.ProjectCode)
            .ToListAsync(cancellationToken);

        // 检查用户是否为管理员
        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);

        // 获取所有待处理/进行中的审核
        var query = _dbContext.ReviewTasks
            .Include(x => x.CreatedByUser)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .Where(x => x.Status != ReviewStatuses.Closed && x.Status != ReviewStatuses.Draft);

        // 如果不是管理员，按可访问项目过滤
        if (!isAdmin)
        {
            query = query.Where(x => projectCodes.Contains(x.ProjectCode));
        }

        var reviewTasks = await query
            .Include(x => x.DirectorUser)
            .Include(x => x.AssignedToUser)
            .Include(x => x.CreatedByUser)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var results = new List<ReviewTaskResult>();
        foreach (var task in reviewTasks)
        {
            results.Add(await MapToResultAsync(task, cancellationToken));
        }

        return results;
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<ReviewTaskResult>> GetReviewsByLensAsync(Guid lensId, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
            .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        var canAccess = await _permissionService.CanAccessProjectAsync(lens.Episode.Project.Code, _currentUserAccessor.GetCurrentUser()?.Id ?? Guid.Empty, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this project.");
        }

        var reviews = await _dbContext.ReviewTasks
            .Include(x => x.DirectorUser)
            .Include(x => x.AssignedToUser)
            .Include(x => x.CreatedByUser)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .Include(x => x.CreatedByUser)
            .Where(x => x.LensId == lensId || x.Shots.Any(s => s.LensId == lensId))
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var results = new List<ReviewTaskResult>();
        foreach (var task in reviews)
        {
            results.Add(await MapToResultAsync(task, cancellationToken));
        }

        return results;
    }

    /// <inheritdoc/>
    public async Task<ReviewTaskResult> ApproveAsync(Guid id, string? comment, long rowVersion, CancellationToken cancellationToken = default)
        => await ExecuteReviewActionAsync(id, ReviewStatuses.Completed, null, rowVersion, cancellationToken);

    /// <inheritdoc/>
    public async Task<ReviewTaskResult> RejectAsync(Guid id, string? comment, long rowVersion, CancellationToken cancellationToken = default)
        => await ExecuteReviewActionAsync(id, ReviewStatuses.Closed, comment, rowVersion, cancellationToken);

    /// <inheritdoc/>
    public async Task<ReviewTaskResult> CloseAsync(Guid id, long rowVersion, CancellationToken cancellationToken = default)
        => await ExecuteReviewActionAsync(id, ReviewStatuses.Closed, null, rowVersion, cancellationToken);

    /// <summary>
    /// 执行审核操作（通过/拒绝/关闭）
    /// </summary>
    private async Task<ReviewTaskResult> ExecuteReviewActionAsync(Guid id, string newStatus, string? comment, long rowVersion, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var reviewTask = await _dbContext.ReviewTasks
            .Include(x => x.Lens)
                .ThenInclude(x => x!.Episode)
                    .ThenInclude(x => x.Project)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");

        var canAccess = await _permissionService.CanAccessProjectAsync(reviewTask.ProjectCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to modify this review.");
        }

        // 检查用户是否具有导演角色 - 通过/拒绝操作需要此角色
        // 管理员也可以执行导演操作
        var isDirector = await _permissionService.IsInRoleAsync(currentUser.Id, "director", cancellationToken);
        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        if (!isDirector && !isAdmin)
        {
            throw new UnauthorizedAppException("director_only_action", "Only directors can approve or reject reviews.");
        }

        // 并发控制检查
        if (reviewTask.RowVersion != rowVersion)
        {
            throw new BusinessException("concurrency_conflict", "The review task has been modified by another user. Please refresh and try again.");
        }

        // 检查操作是否有效
        if (reviewTask.Status == ReviewStatuses.Closed)
        {
            throw new BusinessException("review_already_closed", "The review task is already closed.");
        }

        if (reviewTask.Shots.Count == 0)
        {
            throw new BusinessException("review_task_has_no_shots", "The review task must contain at least one shot.");
        }

        var oldStatus = reviewTask.Status;
        reviewTask.Status = newStatus;
        reviewTask.ResultComment = comment ?? reviewTask.ResultComment;
        reviewTask.RowVersion = rowVersion + 1;

        foreach (var taskShot in reviewTask.Shots)
        {
            if (!IsReviewShot(taskShot))
            {
                continue;
            }

            var shotLens = taskShot.Lens ?? await _dbContext.Lenses.FirstAsync(x => x.Id == taskShot.LensId, cancellationToken);
            taskShot.Lens = shotLens;
            taskShot.Status = newStatus == ReviewStatuses.Completed
                ? ReviewTaskShotStatuses.Done
                : ReviewTaskShotStatuses.Commented;
            taskShot.PlayVersionNum ??= taskShot.SubmitVersionNum;
            var currentReviewStatus = LensInternalReviewStatuses.Normalize(shotLens.InternalReviewStatusCode);
            if (newStatus == ReviewStatuses.Completed)
            {
                shotLens.InternalReviewStatusCode = LensInternalReviewStatuses.DirectorApproved;
            }
            else if (currentReviewStatus != LensInternalReviewStatuses.DirectorApproved)
            {
                shotLens.InternalReviewStatusCode = LensInternalReviewStatuses.PendingFeedbackFix;
            }
            shotLens.InternalReviewUpdatedAtUtc = DateTimeOffset.UtcNow;
        }

        reviewTask.CompletedAtUtc ??= newStatus is ReviewStatuses.Completed or ReviewStatuses.Closed
            ? DateTimeOffset.UtcNow
            : null;

        await _dbContext.SaveChangesAsync(cancellationToken);

        // 记录操作日志
        await _activityLogService.LogAsync(
            "ReviewTask",
            reviewTask.Id,
            "status_changed",
            oldStatus,
            newStatus,
            cancellationToken);

        // 发布 SignalR 事件
        if (_signalRPublisher != null)
        {
            var projectCode = reviewTask.ProjectCode;
            _ = _signalRPublisher.PublishReviewUpdatedAsync(projectCode, reviewTask.Id, newStatus, cancellationToken);
        }

        return await MapToResultAsync(reviewTask, cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<ReviewCommentResult> AddCommentAsync(Guid reviewTaskId, string content, double? timestampSeconds, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var reviewTask = await _dbContext.ReviewTasks
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .Include(x => x.Lens)
                .ThenInclude(x => x.Episode)
                    .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == reviewTaskId, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");

        var canAccess = await _permissionService.CanAccessProjectAsync(reviewTask.ProjectCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to comment on this review.");
        }

        var comment = new ReviewComment
        {
            ReviewTaskId = reviewTaskId,
            CreatedByUserId = currentUser.Id,
            Content = content.Trim(),
            TimestampSeconds = timestampSeconds,
            CreatedByUserName = currentUser.DisplayName
        };

        _dbContext.ReviewComments.Add(comment);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 发布 SignalR 事件
        if (_signalRPublisher != null)
        {
            var projectCode = reviewTask.ProjectCode;
            _ = _signalRPublisher.PublishReviewCommentAddedAsync(projectCode, comment.ReviewTaskId, comment.Id, cancellationToken);
        }

        var primaryShot = reviewTask.Shots.OrderBy(x => x.Sequence).FirstOrDefault();
        return new ReviewCommentResult(
            comment.Id,
            comment.ReviewTaskId,
            comment.CreatedByUserId,
            currentUser.DisplayName,
            comment.Content,
            comment.DecisionCode,
            comment.FrameNumber,
            comment.TimestampSeconds,
            comment.Timecode,
            ReadTags(comment.TagsJson),
            comment.FrameImagePath,
            comment.AnnotatedImagePath,
            comment.ThumbnailPath,
            comment.AnnotationDataJson,
            comment.CreatedAtUtc,
            comment.TaskShotId,
            ExtractFeedbackRoundId(comment.AnnotationDataJson),
            ExtractDrawingFrames(comment.AnnotationDataJson),
            primaryShot?.LensId ?? reviewTask.LensId,
            GetTaskShotLensCode(reviewTask, comment.TaskShotId),
            primaryShot?.SubmitVersionNum ?? primaryShot?.PlayVersionNum);
    }

    public async Task<ReviewCommentResult> AddCommentAsync(Guid reviewTaskId, CreateReviewCommentRequest request, CancellationToken cancellationToken = default)
    {
        var result = await AddCommentInternalAsync(reviewTaskId, request, cancellationToken);
        return result;
    }

    public async Task<ReviewCommentResult> CreateFeedbackAsync(CreateReviewFeedbackRequest request, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var reviewTask = await _dbContext.ReviewTasks
            .Include(x => x.Lens)
                .ThenInclude(x => x.Episode)
                    .ThenInclude(x => x.Project)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .FirstOrDefaultAsync(x => x.Id == request.ReviewTaskId, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");

        var canAccess = await _permissionService.CanAccessProjectAsync(reviewTask.ProjectCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to create feedback.");
        }

        var taskShot = reviewTask.Shots.FirstOrDefault(x => x.LensId == request.LensId)
            ?? (reviewTask.LensId.HasValue && reviewTask.LensId.Value == request.LensId
                ? reviewTask.Shots.FirstOrDefault()
                : null);

        if (request.TaskShotId.HasValue)
        {
            var targetShot = reviewTask.Shots.FirstOrDefault(x => x.Id == request.TaskShotId.Value);
            if (targetShot == null)
            {
                throw new BusinessException("task_shot_not_in_task", "The specified taskShotId does not belong to this review task.");
            }
            if (targetShot.LensId != request.LensId)
            {
                throw new BusinessException("task_shot_lens_mismatch", "The specified taskShotId does not match the lensId.");
            }
            taskShot = targetShot;
        }

        if (taskShot == null)
        {
            throw new BusinessException("shot_not_in_task", "The lens is not part of this review task.");
        }

        if (!IsReviewShot(taskShot))
        {
            throw new BusinessException("context_shot_not_allowed", "Context shots cannot receive formal feedback or drawing updates.");
        }

        var drawingFrames = NormalizeDrawingFrames(request.DrawingFrames);
        ValidateDrawingFrames(drawingFrames);
        var hasTextFeedback = !string.IsNullOrWhiteSpace(request.CommentText);
        var hasDrawingFeedback = drawingFrames.Count > 0;
        if (!hasTextFeedback && !hasDrawingFeedback)
        {
            throw new BusinessException("feedback_content_required", "Either text feedback or drawing frames are required.");
        }

        var feedbackRoundId = request.FeedbackRoundId is { } roundId && roundId != Guid.Empty
            ? roundId
            : Guid.NewGuid();

        var resolvedVersionNum = request.VersionNum?.Trim()
            ?? taskShot.SubmitVersionNum
            ?? taskShot.PlayVersionNum;

        var comment = new ReviewComment
        {
            ReviewTaskId = request.ReviewTaskId,
            LensId = taskShot.LensId,
            VersionNum = resolvedVersionNum,
            CreatedByUserId = currentUser.Id,
            CreatedByUserName = currentUser.DisplayName,
            Content = request.CommentText?.Trim() ?? string.Empty,
            TimestampSeconds = null,
            DecisionCode = NormalizeReviewDecision(request.DecisionCode),
            FrameNumber = request.FrameNumber,
            FrameImagePath = request.FrameImagePath,
            AnnotatedImagePath = request.AnnotatedImagePath,
            ThumbnailPath = request.ThumbnailPath,
            AnnotationDataJson = drawingFrames.Count > 0 || feedbackRoundId != Guid.Empty
                ? BuildAnnotationDataJson(request.AnnotationDataJson, feedbackRoundId, drawingFrames)
                : request.AnnotationDataJson,
            Timecode = request.Timecode,
            TagsJson = WriteTags(request.Tags),
            TaskShotId = request.TaskShotId ?? taskShot.Id
        };

        _dbContext.ReviewComments.Add(comment);

        await _dbContext.SaveChangesAsync(cancellationToken);

        try
        {
            await RefreshTaskShotStateAsync(reviewTask.Id, taskShot.LensId, cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Feedback saved but task shot refresh failed. ReviewTaskId={ReviewTaskId} LensId={LensId} FeedbackId={FeedbackId}",
                reviewTask.Id,
                taskShot.LensId,
                comment.Id);
        }

        var primaryShot = reviewTask.Shots.OrderBy(x => x.Sequence).FirstOrDefault();
        return new ReviewCommentResult(
            comment.Id,
            comment.ReviewTaskId,
            comment.CreatedByUserId,
            currentUser.DisplayName,
            comment.Content,
            comment.DecisionCode,
            comment.FrameNumber,
            comment.TimestampSeconds,
            comment.Timecode,
            ReadTags(comment.TagsJson),
            comment.FrameImagePath,
            comment.AnnotatedImagePath,
            comment.ThumbnailPath,
            comment.AnnotationDataJson,
            comment.CreatedAtUtc,
            comment.TaskShotId,
            ExtractFeedbackRoundId(comment.AnnotationDataJson),
            ExtractDrawingFrames(comment.AnnotationDataJson) ?? drawingFrames,
            primaryShot?.LensId ?? reviewTask.LensId,
            GetTaskShotLensCode(reviewTask, comment.TaskShotId),
            primaryShot?.SubmitVersionNum ?? primaryShot?.PlayVersionNum);
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<ReviewCommentResult>> GetCommentsAsync(Guid reviewTaskId, CancellationToken cancellationToken = default)
    {
        var reviewTask = await _dbContext.ReviewTasks
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .FirstOrDefaultAsync(x => x.Id == reviewTaskId, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");

        var canAccess = await _permissionService.CanAccessProjectAsync(reviewTask.ProjectCode, _currentUserAccessor.GetCurrentUser()?.Id ?? Guid.Empty, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this review.");
        }

        var comments = await _dbContext.ReviewComments
            .Where(x => x.ReviewTaskId == reviewTaskId)
            .OrderBy(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        return comments.Select(c => new ReviewCommentResult(
            c.Id,
            c.ReviewTaskId,
            c.CreatedByUserId,
            c.CreatedByUserName ?? "unknown",
            c.Content,
            c.DecisionCode,
            c.FrameNumber,
            c.TimestampSeconds,
            c.Timecode,
            ReadTags(c.TagsJson),
            c.FrameImagePath,
            c.AnnotatedImagePath,
            c.ThumbnailPath,
            c.AnnotationDataJson,
            c.CreatedAtUtc,
            c.TaskShotId,
            ExtractFeedbackRoundId(c.AnnotationDataJson),
            ExtractDrawingFrames(c.AnnotationDataJson),
            c.LensId,
            GetTaskShotLensCode(c.ReviewTask, c.TaskShotId),
            c.VersionNum)).ToArray();
    }

    public async Task<IReadOnlyList<ReviewCommentResult>> GetFeedbacksByLensAsync(Guid lensId, Guid? feedbackRoundId = null, bool includeAllRounds = false, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
                .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        var canAccess = await _permissionService.CanAccessProjectAsync(lens.Episode.Project.Code, _currentUserAccessor.GetCurrentUser()?.Id ?? Guid.Empty, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this lens feedback.");
        }

        var feedbacks = await LoadFeedbacksByLensInternalAsync(lensId, cancellationToken);

        var rounds = feedbacks
            .Where(x => x.FeedbackRoundId.HasValue && x.FeedbackRoundId.Value != Guid.Empty)
            .GroupBy(x => x.FeedbackRoundId!.Value)
            .Select(group => new
            {
                FeedbackRoundId = group.Key,
                CreatedAtUtc = group.Max(x => x.CreatedAtUtc)
            })
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToArray();

        var targetRoundId = feedbackRoundId is { } explicitRoundId && explicitRoundId != Guid.Empty
            ? explicitRoundId
            : (includeAllRounds ? null : rounds.FirstOrDefault()?.FeedbackRoundId);

        if (targetRoundId.HasValue)
        {
            feedbacks = feedbacks.Where(x => ExtractFeedbackRoundId(x.AnnotationDataJson) == targetRoundId.Value).ToList();
        }

        return feedbacks.Select(c => new ReviewCommentResult(
            c.Id,
            c.ReviewTaskId,
            c.CreatedByUserId,
            c.CreatedByUserName ?? "unknown",
            c.Content,
            c.DecisionCode,
            c.FrameNumber,
            c.TimestampSeconds,
            c.Timecode,
            c.Tags,
            c.FrameImagePath,
            c.AnnotatedImagePath,
            c.ThumbnailPath,
            c.AnnotationDataJson,
            c.CreatedAtUtc,
            c.TaskShotId,
            ExtractFeedbackRoundId(c.AnnotationDataJson),
            ExtractDrawingFrames(c.AnnotationDataJson),
            c.LensId,
            c.LensCode,
            c.VersionNum)).ToArray();
    }

    public async Task<IReadOnlyList<ReviewDrawingFrameResult>> GetDrawingFramesByLensAsync(Guid lensId, Guid? feedbackRoundId = null, bool includeAllRounds = false, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
                .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        var canAccess = await _permissionService.CanAccessProjectAsync(lens.Episode.Project.Code, _currentUserAccessor.GetCurrentUser()?.Id ?? Guid.Empty, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this lens feedback.");
        }

        var rounds = await LoadFeedbackRoundsAsync(lensId, cancellationToken);
        if (rounds.Count == 0)
        {
            return [];
        }

        if (includeAllRounds)
        {
            return rounds
                .OrderByDescending(x => x.CreatedAtUtc)
                .SelectMany(x => x.DrawingFrames)
                .ToArray();
        }

        var targetRoundId = feedbackRoundId is { } roundId && roundId != Guid.Empty
            ? roundId
            : rounds[0].FeedbackRoundId;

        var selected = rounds.FirstOrDefault(x => x.FeedbackRoundId == targetRoundId);
        if (selected == null)
        {
            return [];
        }

        return selected.DrawingFrames;
    }

    private async Task<IReadOnlyList<ReviewFeedbackRoundResult>> LoadFeedbackRoundsAsync(Guid lensId, CancellationToken cancellationToken)
    {
        var feedbacks = await LoadFeedbacksByLensInternalAsync(lensId, cancellationToken);
        return feedbacks
            .Where(x => x.FeedbackRoundId.HasValue && x.FeedbackRoundId.Value != Guid.Empty)
            .GroupBy(x => x.FeedbackRoundId!.Value)
            .Select(group =>
            {
                var roundFeedbacks = group.OrderBy(x => x.CreatedAtUtc).ToArray();
                var roundDrawingFrames = roundFeedbacks
                    .SelectMany(x => x.DrawingFrames ?? Array.Empty<ReviewDrawingFrameResult>())
                    .ToArray();
                return new ReviewFeedbackRoundResult(
                    group.Key,
                    roundFeedbacks.Max(x => x.CreatedAtUtc),
                    roundFeedbacks.Length,
                    roundDrawingFrames);
            })
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToArray();
    }

    private async Task<IReadOnlyList<ReviewCommentResult>> LoadFeedbacksByLensInternalAsync(Guid lensId, CancellationToken cancellationToken)
    {
        var feedbacks = await _dbContext.ReviewComments
            .Include(x => x.ReviewTask)
                .ThenInclude(x => x.Shots)
                    .ThenInclude(x => x.Lens)
            .Where(x => x.LensId == lensId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        return feedbacks.Select(c => new ReviewCommentResult(
            c.Id,
            c.ReviewTaskId,
            c.CreatedByUserId,
            c.CreatedByUserName ?? "unknown",
            c.Content,
            c.DecisionCode,
            c.FrameNumber,
            c.TimestampSeconds,
            c.Timecode,
            ReadTags(c.TagsJson),
            c.FrameImagePath,
            c.AnnotatedImagePath,
            c.ThumbnailPath,
            c.AnnotationDataJson,
            c.CreatedAtUtc,
            c.TaskShotId,
            ExtractFeedbackRoundId(c.AnnotationDataJson),
            ExtractDrawingFrames(c.AnnotationDataJson),
            c.LensId,
            GetTaskShotLensCode(c.ReviewTask, c.TaskShotId),
            c.VersionNum)).ToArray();
    }

    public async Task<ReviewCommentResult?> GetFeedbackByIdAsync(Guid feedbackId, CancellationToken cancellationToken = default)
    {
        var feedback = await _dbContext.ReviewComments
            .Include(x => x.ReviewTask)
                .ThenInclude(x => x.Shots)
                    .ThenInclude(x => x.Lens)
            .FirstOrDefaultAsync(x => x.Id == feedbackId, cancellationToken);

        if (feedback == null)
        {
            return null;
        }

        var canAccess = await _permissionService.CanAccessProjectAsync(feedback.ReviewTask.ProjectCode, _currentUserAccessor.GetCurrentUser()?.Id ?? Guid.Empty, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this feedback.");
        }

        return new ReviewCommentResult(
            feedback.Id,
            feedback.ReviewTaskId,
            feedback.CreatedByUserId,
            feedback.CreatedByUserName ?? "unknown",
            feedback.Content,
            feedback.DecisionCode,
            feedback.FrameNumber,
            feedback.TimestampSeconds,
            feedback.Timecode,
            ReadTags(feedback.TagsJson),
            feedback.FrameImagePath,
            feedback.AnnotatedImagePath,
            feedback.ThumbnailPath,
            feedback.AnnotationDataJson,
            feedback.CreatedAtUtc,
            feedback.TaskShotId,
            ExtractFeedbackRoundId(feedback.AnnotationDataJson),
            ExtractDrawingFrames(feedback.AnnotationDataJson),
            feedback.LensId,
            feedback.Lens?.Code ?? string.Empty,
            feedback.VersionNum);
    }

    public Task<ReviewCommentResult> UpdateFeedbackAsync(Guid feedbackId, UpdateReviewFeedbackRequest request, CancellationToken cancellationToken = default)
        => UpdateFeedbackInternalAsync(feedbackId, request, cancellationToken);

    public Task DeleteFeedbackAsync(Guid feedbackId, CancellationToken cancellationToken = default)
        => DeleteFeedbackInternalAsync(feedbackId, cancellationToken);

    public Task<ReviewTaskResult> CreateTaskAsync(CreateReviewTaskRequest request, CancellationToken cancellationToken = default)
        => CreateTaskInternalAsync(request, cancellationToken);

    public Task<IReadOnlyList<ReviewTaskResult>> GetTasksAsync(CancellationToken cancellationToken = default)
        => GetPendingReviewsAsync(cancellationToken);

    public Task<ReviewTaskResult?> GetTaskByIdAsync(Guid id, CancellationToken cancellationToken = default)
        => GetByIdAsync(id, cancellationToken);

    public Task<ReviewTaskResult> UpdateTaskAsync(Guid id, UpdateReviewTaskRequest request, CancellationToken cancellationToken = default)
        => UpdateTaskInternalAsync(id, request, cancellationToken);

    public async Task<ReviewTaskResult> SubmitTaskAsync(Guid id, CancellationToken cancellationToken = default)
        => await SetTaskStatusAsync(id, ReviewStatuses.Pending, cancellationToken);

    public async Task<ReviewTaskResult> StartTaskAsync(Guid id, CancellationToken cancellationToken = default)
        => await SetTaskStatusAsync(id, ReviewStatuses.InReview, cancellationToken);

    public async Task<ReviewTaskResult> CompleteTaskAsync(Guid id, CancellationToken cancellationToken = default)
        => await SetTaskStatusAsync(id, ReviewStatuses.Completed, cancellationToken);

    public async Task<ReviewTaskResult> CloseTaskAsync(Guid id, CancellationToken cancellationToken = default)
        => await CloseTaskInternalAsync(id, cancellationToken);

    public Task<IReadOnlyList<ReviewTaskShotResult>> AddTaskShotsAsync(Guid id, IReadOnlyList<CreateReviewTaskShotRequest> shots, CancellationToken cancellationToken = default)
        => AddTaskShotsInternalAsync(id, shots, cancellationToken);

    public Task<IReadOnlyList<ReviewTaskShotResult>> RemoveTaskShotsAsync(Guid id, IReadOnlyList<Guid> taskShotIds, CancellationToken cancellationToken = default)
        => RemoveTaskShotsInternalAsync(id, taskShotIds, cancellationToken);

    public Task<IReadOnlyList<ReviewTaskShotResult>> ReorderTaskShotsAsync(Guid id, IReadOnlyList<Guid> orderedTaskShotIds, CancellationToken cancellationToken = default)
        => ReorderTaskShotsInternalAsync(id, orderedTaskShotIds, cancellationToken);

    /// <summary>
    /// 映射审核任务到结果对象
    /// </summary>
    private async Task<ReviewTaskResult> MapToResultAsync(ReviewTask reviewTask, CancellationToken cancellationToken)
    {
        var shots = await LoadTaskShotsAsync(reviewTask.Id, cancellationToken);
        var reviewShotLensIds = shots.Where(IsReviewShot).Select(x => x.LensId).ToArray();
        var commentCount = reviewShotLensIds.Length == 0
            ? 0
            : await _dbContext.ReviewComments
                .CountAsync(x => x.ReviewTaskId == reviewTask.Id && x.LensId.HasValue && reviewShotLensIds.Contains(x.LensId.Value), cancellationToken);
        commentCount = Math.Max(commentCount, shots.Where(IsReviewShot).Sum(x => x.FeedbackCount));
        return new ReviewTaskResult(
            reviewTask.Id,
            reviewTask.ProjectCode,
            reviewTask.EpisodeId,
            reviewTask.EpisodeCode,
            reviewTask.Name,
            reviewTask.Description,
            reviewTask.DirectorUserId,
            reviewTask.DirectorUser?.DisplayName,
            reviewTask.Status,
            reviewTask.ResultComment,
            reviewTask.AssignedToUserId,
            reviewTask.AssignedToUser?.DisplayName,
            reviewTask.SubmittedAtUtc,
            reviewTask.CompletedAtUtc,
            reviewTask.DueAtUtc,
            reviewTask.CreatedByUserId,
            reviewTask.CreatedByUser?.DisplayName ?? "unknown",
            reviewTask.RowVersion,
            reviewTask.CreatedAtUtc,
            reviewTask.UpdatedAtUtc,
            commentCount,
            reviewTask.LensId,
            reviewTask.Lens?.Code,
            reviewTask.Lens?.Name,
            shots,
            BuildSummary(reviewTask, shots, commentCount));
    }

    private async Task<ReviewTaskResult> SetTaskStatusAsync(Guid id, string newStatus, CancellationToken cancellationToken)
    {
        var task = await _dbContext.ReviewTasks
            .Include(x => x.Lens)
                .ThenInclude(x => x!.Episode)
                    .ThenInclude(x => x.Project)
            .Include(x => x.CreatedByUser)
            .Include(x => x.DirectorUser)
            .Include(x => x.AssignedToUser)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");

        task.Status = newStatus;
        if (newStatus is ReviewStatuses.Pending or ReviewStatuses.InReview)
        {
            task.SubmittedAtUtc ??= DateTimeOffset.UtcNow;
            foreach (var shot in task.Shots)
            {
                shot.Status = ReviewTaskShotStatuses.Viewed;
                shot.PlayVersionNum ??= shot.SubmitVersionNum;
                shot.LastFeedbackAtUtc ??= task.SubmittedAtUtc;
                if (IsReviewShot(shot))
                {
                    shot.Lens.LatestReviewTaskId = task.Id;
                    var currentReviewStatus = LensInternalReviewStatuses.Normalize(shot.Lens.InternalReviewStatusCode);
                    if (currentReviewStatus is LensInternalReviewStatuses.ReadyForReview or LensInternalReviewStatuses.FixUpdated)
                    {
                        shot.Lens.InternalReviewStatusCode = LensInternalReviewStatuses.InDirectorReview;
                        shot.Lens.InternalReviewUpdatedAtUtc = DateTimeOffset.UtcNow;
                    }
                }
            }
        }
        else if (newStatus is ReviewStatuses.Completed or ReviewStatuses.Closed)
        {
            task.CompletedAtUtc ??= DateTimeOffset.UtcNow;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return await MapToResultAsync(task, cancellationToken);
    }

    private async Task<ReviewTaskResult> CloseTaskInternalAsync(Guid id, CancellationToken cancellationToken)
    {
        var task = await _dbContext.ReviewTasks
            .Include(x => x.Lens)
                .ThenInclude(x => x!.Episode)
                    .ThenInclude(x => x.Project)
            .Include(x => x.CreatedByUser)
            .Include(x => x.DirectorUser)
            .Include(x => x.AssignedToUser)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");

        var comments = await _dbContext.ReviewComments
            .Where(x => x.ReviewTaskId == task.Id)
            .ToListAsync(cancellationToken);
        if (comments.Count > 0)
        {
            _dbContext.ReviewComments.RemoveRange(comments);
        }

        var now = DateTimeOffset.UtcNow;
        foreach (var taskShot in task.Shots)
        {
            taskShot.Status = ReviewTaskShotStatuses.Unviewed;
            taskShot.FeedbackCount = 0;
            taskShot.LastFeedbackAtUtc = null;
            taskShot.LatestFeedbackId = null;

            if (!IsReviewShot(taskShot))
            {
                continue;
            }

            var shotLens = taskShot.Lens ?? await _dbContext.Lenses.FirstAsync(x => x.Id == taskShot.LensId, cancellationToken);
            taskShot.Lens = shotLens;
            shotLens.InternalReviewStatusCode = LensInternalReviewStatuses.ReadyForReview;
            shotLens.InternalReviewUpdatedAtUtc = now;
            shotLens.LatestDirectorFeedbackAtUtc = null;
            shotLens.PendingDirectorFeedbackCount = 0;
            if (shotLens.LatestReviewTaskId == task.Id)
            {
                shotLens.LatestReviewTaskId = null;
            }
        }

        task.Status = ReviewStatuses.Closed;
        task.CompletedAtUtc ??= now;
        task.RowVersion += 1;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return await MapToResultAsync(task, cancellationToken);
    }

    private async Task<ReviewTaskResult> CreateTaskInternalAsync(CreateReviewTaskRequest request, CancellationToken cancellationToken)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        await ValidateDirectorUserAsync(request.DirectorUserId, cancellationToken);

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var task = new ReviewTask
            {
                ProjectCode = request.ProjectCode.Trim().ToUpperInvariant(),
                EpisodeId = request.EpisodeId,
                EpisodeCode = request.EpisodeId.HasValue
                    ? await _dbContext.Episodes.Where(x => x.Id == request.EpisodeId.Value).Select(x => x.Code).FirstOrDefaultAsync(cancellationToken)
                    : null,
                Name = request.Name.Trim(),
                Description = request.Description?.Trim(),
                DirectorUserId = request.DirectorUserId,
                LensId = request.Shots.FirstOrDefault()?.LensId,
                DueAtUtc = request.DueAtUtc,
                CreatedByUserId = currentUser.Id,
                RowVersion = 1,
                Status = ReviewStatuses.Draft
            };

            _dbContext.ReviewTasks.Add(task);
            await _dbContext.SaveChangesAsync(cancellationToken);

            if (request.Shots.Count > 0)
            {
                await AddTaskShotsInternalAsync(task.Id, request.Shots, cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            return await GetByIdAsync(task.Id, cancellationToken) ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");
        }
        catch (DbUpdateException exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw CreateDraftTaskSaveException(exception);
        }
    }

    private static bool IsSchemaLensIdMismatch(DbUpdateException exception)
    {
        var message = exception.InnerException?.Message ?? exception.Message;
        return message.Contains("review_tasks", StringComparison.OrdinalIgnoreCase)
            && message.Contains("LensId", StringComparison.OrdinalIgnoreCase)
            && message.Contains("null", StringComparison.OrdinalIgnoreCase);
    }

    private async Task<ReviewTaskResult> UpdateTaskInternalAsync(Guid id, UpdateReviewTaskRequest request, CancellationToken cancellationToken)
    {
        var task = await _dbContext.ReviewTasks.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");

        await ValidateDirectorUserAsync(request.DirectorUserId, cancellationToken);

        task.Name = request.Name.Trim();
        task.Description = request.Description?.Trim();
        task.DirectorUserId = request.DirectorUserId;
        task.DueAtUtc = request.DueAtUtc;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return await GetByIdAsync(task.Id, cancellationToken) ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");
    }

    private async Task<IReadOnlyList<ReviewTaskShotResult>> AddTaskShotsInternalAsync(Guid id, IReadOnlyList<CreateReviewTaskShotRequest> shots, CancellationToken cancellationToken)
    {
        var task = await _dbContext.ReviewTasks
            .Include(x => x.Shots)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");

        var addedAny = false;
        foreach (var shot in shots)
        {
            if (task.Shots.Any(x => x.LensId == shot.LensId))
            {
                continue;
            }

            addedAny = true;
            _dbContext.ReviewTaskShots.Add(new ReviewTaskShot
            {
                ReviewTaskId = task.Id,
                LensId = shot.LensId,
                Sequence = shot.Sequence,
                ParticipationMode = ReviewTaskShotParticipationModes.Normalize(shot.ParticipationMode),
                SubmitVersionNum = shot.SubmitVersionNum,
                PlayVersionNum = shot.SubmitVersionNum,
                Status = ReviewTaskShotStatuses.Unviewed,
                FeedbackCount = 0
            });
        }

        if (!task.LensId.HasValue)
        {
            task.LensId = shots.FirstOrDefault()?.LensId;
        }

        if (task.Status == ReviewStatuses.Draft && (addedAny || task.Shots.Count > 0))
        {
            task.Status = ReviewStatuses.Ready;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return await LoadTaskShotsAsync(task.Id, cancellationToken);
    }

    private static BusinessException CreateDraftTaskSaveException(DbUpdateException exception)
    {
        var message = exception.InnerException?.Message ?? exception.Message;

        if (message.Contains("duplicate key", StringComparison.OrdinalIgnoreCase))
        {
            return new BusinessException("review_task_duplicate", "Draft task save failed because the selected shots contain duplicates or conflict with existing records.");
        }

        if (message.Contains("foreign key", StringComparison.OrdinalIgnoreCase))
        {
            return new BusinessException("review_task_fk_failed", "Draft task save failed because one or more referenced records could not be found.");
        }

        return new BusinessException("review_task_save_failed", "Draft task save failed. Please check the server logs for the database error details.");
    }

    private async Task<IReadOnlyList<ReviewTaskShotResult>> ReorderTaskShotsInternalAsync(Guid id, IReadOnlyList<Guid> orderedTaskShotIds, CancellationToken cancellationToken)
    {
        var shots = await _dbContext.ReviewTaskShots.Where(x => x.ReviewTaskId == id).ToListAsync(cancellationToken);
        var orderMap = orderedTaskShotIds.Select((shotId, index) => new { shotId, index }).ToDictionary(x => x.shotId, x => x.index + 1);
        foreach (var shot in shots)
        {
            if (orderMap.TryGetValue(shot.Id, out var sequence))
            {
                shot.Sequence = sequence;
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return await LoadTaskShotsAsync(id, cancellationToken);
    }

    private async Task<IReadOnlyList<ReviewTaskShotResult>> RemoveTaskShotsInternalAsync(Guid id, IReadOnlyList<Guid> taskShotIds, CancellationToken cancellationToken)
    {
        var shots = await _dbContext.ReviewTaskShots
            .Where(x => x.ReviewTaskId == id && taskShotIds.Contains(x.Id))
            .ToListAsync(cancellationToken);

        _dbContext.ReviewTaskShots.RemoveRange(shots);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return await LoadTaskShotsAsync(id, cancellationToken);
    }

    private async Task ValidateDirectorUserAsync(Guid? directorUserId, CancellationToken cancellationToken)
    {
        if (!directorUserId.HasValue)
        {
            return;
        }

        var director = await _dbContext.Users
            .Include(x => x.UserRoles)
                .ThenInclude(x => x.Role)
            .FirstOrDefaultAsync(x => x.Id == directorUserId.Value, cancellationToken)
            ?? throw new NotFoundAppException("user_not_found", "The director user could not be found.");

        var isDirector = director.UserRoles.Any(x => string.Equals(x.Role.Code, "director", StringComparison.OrdinalIgnoreCase));
        if (!isDirector)
        {
            throw new BusinessException("director_required", "The selected user must have the director role.");
        }
    }

    private async Task<ReviewCommentResult> UpdateFeedbackInternalAsync(Guid feedbackId, UpdateReviewFeedbackRequest request, CancellationToken cancellationToken)
    {
        var feedback = await _dbContext.ReviewComments.FirstOrDefaultAsync(x => x.Id == feedbackId, cancellationToken)
            ?? throw new NotFoundAppException("feedback_not_found", "The feedback could not be found.");

        var taskShot = await _dbContext.ReviewTaskShots
            .FirstOrDefaultAsync(x => x.ReviewTaskId == feedback.ReviewTaskId && x.LensId == feedback.LensId, cancellationToken);

        if (taskShot == null && feedback.TaskShotId.HasValue)
        {
            taskShot = await _dbContext.ReviewTaskShots.FirstOrDefaultAsync(x => x.Id == feedback.TaskShotId.Value, cancellationToken);
        }

        if (taskShot != null && !IsReviewShot(taskShot))
        {
            throw new BusinessException("context_shot_not_allowed", "Context shots cannot receive formal feedback or drawing updates.");
        }

        if (feedback.TaskShotId.HasValue)
        {
            var taskShotById = await _dbContext.ReviewTaskShots.FirstOrDefaultAsync(x => x.Id == feedback.TaskShotId.Value, cancellationToken);
            if (taskShotById != null && !IsReviewShot(taskShotById))
            {
                throw new BusinessException("context_shot_not_allowed", "Context shots cannot receive formal feedback or drawing updates.");
            }
        }

        if (request.CommentText is not null)
        {
            feedback.Content = request.CommentText.Trim();
        }

        var hasTextFeedback = !string.IsNullOrWhiteSpace(feedback.Content);

        if (request.DecisionCode is not null)
        {
            feedback.DecisionCode = NormalizeReviewDecision(request.DecisionCode);
        }

        if (request.AnnotatedImagePath is not null)
        {
            feedback.AnnotatedImagePath = request.AnnotatedImagePath;
        }

        if (request.ThumbnailPath is not null)
        {
            feedback.ThumbnailPath = request.ThumbnailPath;
        }

        if (request.AnnotationDataJson is not null)
        {
            feedback.AnnotationDataJson = MergeUpdatedAnnotationDataJson(feedback.AnnotationDataJson, request.AnnotationDataJson);
        }

        if (request.DrawingFrames is not null)
        {
            var drawingFrames = NormalizeDrawingFrames(request.DrawingFrames);
            ValidateDrawingFrames(drawingFrames);
            feedback.AnnotationDataJson = BuildAnnotationDataJson(
                request.AnnotationDataJson ?? ExtractAnnotationDataJson(feedback.AnnotationDataJson),
                ExtractFeedbackRoundId(request.AnnotationDataJson) ?? ExtractFeedbackRoundId(feedback.AnnotationDataJson) ?? Guid.NewGuid(),
                drawingFrames);
        }

        if (request.Tags is not null)
        {
            feedback.TagsJson = WriteTags(request.Tags);
        }

        if (request.TaskShotId.HasValue)
        {
            feedback.TaskShotId = request.TaskShotId.Value;
        }

        var hasDrawingFeedback = ExtractDrawingFrames(feedback.AnnotationDataJson)?.Count > 0;
        if (!hasTextFeedback && !hasDrawingFeedback)
        {
            throw new BusinessException("feedback_content_required", "Either text feedback or drawing frames are required.");
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        if (feedback.LensId.HasValue)
        {
            await RefreshTaskShotStateAsync(feedback.ReviewTaskId, feedback.LensId.Value, cancellationToken);
        }
        return await MapFeedbackAsync(feedback, cancellationToken);
    }

    private async Task DeleteFeedbackInternalAsync(Guid feedbackId, CancellationToken cancellationToken)
    {
        var feedback = await _dbContext.ReviewComments.FirstOrDefaultAsync(x => x.Id == feedbackId, cancellationToken);
        if (feedback == null)
        {
            return;
        }

        _dbContext.ReviewComments.Remove(feedback);
        await _dbContext.SaveChangesAsync(cancellationToken);

        if (feedback.LensId.HasValue)
        {
            await RefreshTaskShotStateAsync(feedback.ReviewTaskId, feedback.LensId.Value, cancellationToken);
        }
    }

    private async Task<IReadOnlyList<ReviewTaskShotResult>> LoadTaskShotsAsync(Guid reviewTaskId, CancellationToken cancellationToken)
    {
        var shots = await _dbContext.ReviewTaskShots
            .Include(x => x.Lens)
            .Where(x => x.ReviewTaskId == reviewTaskId)
            .OrderBy(x => x.Sequence)
            .ToListAsync(cancellationToken);

        return shots.Select(x => new ReviewTaskShotResult(
            x.Id,
            x.ReviewTaskId,
            x.LensId,
            x.Lens.Code,
            x.Sequence,
            x.ParticipationMode,
            x.SubmitVersionNum,
            x.PlayVersionNum,
            x.Status,
            IsReviewShot(x) ? x.FeedbackCount : 0,
            IsReviewShot(x) ? x.LastFeedbackAtUtc : null,
            x.Lens.InternalReviewStatusCode,
            x.Lens.InternalReviewUpdatedAtUtc,
            IsReviewShot(x) ? x.LatestFeedbackId : null)).ToArray();
    }

    private static ReviewTaskSummaryResult BuildSummary(ReviewTask task, IReadOnlyList<ReviewTaskShotResult> shots, int feedbackCount)
    {
        var latestUpdatedAtUtc = new[] { task.UpdatedAtUtc, task.CompletedAtUtc, task.SubmittedAtUtc, task.CreatedAtUtc }.Where(x => x.HasValue).Select(x => x!.Value).DefaultIfEmpty().Max();
        var reviewShots = shots.Where(IsReviewShot).ToArray();
        var latestFeedbackAtUtc = reviewShots.Where(x => x.LastFeedbackAtUtc.HasValue).Select(x => x.LastFeedbackAtUtc!.Value).DefaultIfEmpty().Max();
        return new ReviewTaskSummaryResult(
            reviewShots.Length,
            feedbackCount,
            reviewShots.Count(x => x.LensInternalReviewStatusCode == LensInternalReviewStatuses.DirectorApproved),
            reviewShots.Count(x => x.LensInternalReviewStatusCode == LensInternalReviewStatuses.PendingFeedbackFix),
            task.CreatedByUser?.DisplayName,
            task.DirectorUser?.DisplayName,
            task.DueAtUtc,
            latestUpdatedAtUtc == default ? task.UpdatedAtUtc : latestUpdatedAtUtc,
            latestFeedbackAtUtc == default ? null : latestFeedbackAtUtc);
    }

    private static bool IsReviewShot(ReviewTaskShot shot)
        => string.Equals(ReviewTaskShotParticipationModes.Normalize(shot.ParticipationMode), ReviewTaskShotParticipationModes.Review, StringComparison.OrdinalIgnoreCase);

    private static bool IsReviewShot(ReviewTaskShotResult shot)
        => string.Equals(ReviewTaskShotParticipationModes.Normalize(shot.ParticipationMode), ReviewTaskShotParticipationModes.Review, StringComparison.OrdinalIgnoreCase);

    private async Task<ReviewCommentResult> MapFeedbackAsync(ReviewComment feedback, CancellationToken cancellationToken)
    {
        await _dbContext.Entry(feedback).Reference(x => x.CreatedByUser).LoadAsync(cancellationToken);
        return new ReviewCommentResult(
            feedback.Id,
            feedback.ReviewTaskId,
            feedback.CreatedByUserId,
            feedback.CreatedByUserName ?? feedback.CreatedByUser.DisplayName,
            feedback.Content,
            feedback.DecisionCode,
            feedback.FrameNumber,
            feedback.TimestampSeconds,
            feedback.Timecode,
            ReadTags(feedback.TagsJson),
            feedback.FrameImagePath,
            feedback.AnnotatedImagePath,
            feedback.ThumbnailPath,
            feedback.AnnotationDataJson,
            feedback.CreatedAtUtc,
            feedback.TaskShotId,
            ExtractFeedbackRoundId(feedback.AnnotationDataJson),
            ExtractDrawingFrames(feedback.AnnotationDataJson),
            feedback.LensId,
            feedback.Lens?.Code ?? string.Empty,
            feedback.VersionNum);
    }

    private static string? ExtractAnnotationDataJson(string? annotationDataJson)
    {
        if (string.IsNullOrWhiteSpace(annotationDataJson))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(annotationDataJson);
            return document.RootElement.TryGetProperty("annotationDataJson", out var inner) && inner.ValueKind == JsonValueKind.String
                ? inner.GetString()
                : annotationDataJson;
        }
        catch (JsonException)
        {
            return annotationDataJson;
        }
    }

    private static Guid? ExtractFeedbackRoundId(string? annotationDataJson)
    {
        if (string.IsNullOrWhiteSpace(annotationDataJson))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(annotationDataJson);
            return document.RootElement.TryGetProperty("feedbackRoundId", out var value) && value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out var feedbackRoundId)
                ? feedbackRoundId
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static IReadOnlyList<ReviewDrawingFrameResult>? ExtractDrawingFrames(string? annotationDataJson)
    {
        if (string.IsNullOrWhiteSpace(annotationDataJson))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(annotationDataJson);
            if (!document.RootElement.TryGetProperty("drawingFrames", out var framesElement) || framesElement.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            var frames = new List<(ReviewDrawingFrameResult Frame, int GenerationOrder)>();
            var generationOrder = 0;
            foreach (var frame in framesElement.EnumerateArray())
            {
                if (frame.ValueKind != JsonValueKind.Object)
                {
                    generationOrder++;
                    continue;
                }

                static int? ReadNullableInt(JsonElement element, string propertyName)
                    => element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
                        ? number
                        : null;

                static double? ReadNullableDouble(JsonElement element, string propertyName)
                    => element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)
                        ? number
                        : null;

                static string? ReadNullableString(JsonElement element, string propertyName)
                    => element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
                        ? value.GetString()
                        : null;

                var normalizedFrame = TryCreateDrawingFrameResult(
                    ReadNullableInt(frame, "frameNumber"),
                    ReadNullableDouble(frame, "timestampSeconds"),
                    ReadNullableString(frame, "timecode"),
                    frame.TryGetProperty("drawingStateCode", out var stateValue) && stateValue.ValueKind == JsonValueKind.String
                        ? stateValue.GetString()
                        : ReviewDrawingStateCodes.Drawn,
                    ReadNullableString(frame, "drawingObjectsJson"));

                if (normalizedFrame is not null)
                {
                    frames.Add((normalizedFrame, generationOrder));
                }

                generationOrder++;
            }

            return OrderDrawingFrames(frames);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string BuildFeedbackPayloadJson(string? annotationDataJson, Guid feedbackRoundId, IReadOnlyList<ReviewDrawingFrameResult> drawingFrames)
    {
        var orderedFrames = OrderDrawingFrames(drawingFrames.Select((frame, index) => (Frame: frame, GenerationOrder: index)));

        var payload = new Dictionary<string, object?>
        {
            ["annotationDataJson"] = ExtractAnnotationDataJson(annotationDataJson),
            ["feedbackRoundId"] = feedbackRoundId,
            ["drawingFrames"] = orderedFrames.Select(frame => new Dictionary<string, object?>
            {
                ["frameNumber"] = frame.FrameNumber,
                ["timestampSeconds"] = frame.TimestampSeconds,
                ["timecode"] = frame.Timecode,
                ["drawingStateCode"] = frame.DrawingStateCode,
                ["drawingObjectsJson"] = frame.DrawingObjectsJson
            }).ToArray()
        };

        return JsonSerializer.Serialize(payload);
    }

    private static string BuildAnnotationDataJson(string? annotationDataJson, Guid feedbackRoundId, IReadOnlyList<ReviewDrawingFrameResult> drawingFrames)
        => BuildFeedbackPayloadJson(annotationDataJson, feedbackRoundId, drawingFrames);

    private static IReadOnlyList<ReviewDrawingFrameResult> NormalizeDrawingFrames(IReadOnlyList<CreateReviewDrawingFrameRequest>? drawingFrames)
    {
        if (drawingFrames is null || drawingFrames.Count == 0)
        {
            return [];
        }

        var frames = new List<(ReviewDrawingFrameResult Frame, int GenerationOrder)>();
        for (var index = 0; index < drawingFrames.Count; index++)
        {
            var frame = drawingFrames[index];
            var normalizedFrame = TryCreateDrawingFrameResult(
                frame.FrameNumber,
                frame.TimestampSeconds,
                frame.Timecode,
                frame.DrawingStateCode,
                frame.DrawingObjectsJson);

            if (normalizedFrame is null)
            {
                throw new BusinessException("invalid_drawing_frame", $"Drawing frame at index {index} is invalid.");
            }

            frames.Add((normalizedFrame, index));
        }

        return OrderDrawingFrames(frames);
    }

    private static ReviewDrawingFrameResult? TryCreateDrawingFrameResult(int? frameNumber, double? timestampSeconds, string? timecode, string? drawingStateCode, string? drawingObjectsJson)
    {
        if (!frameNumber.HasValue)
        {
            return null;
        }

        var normalizedStateCode = ReviewDrawingStateCodes.Normalize(drawingStateCode);
        if (!ReviewDrawingStateCodes.IsValid(normalizedStateCode))
        {
            return null;
        }

        if (normalizedStateCode == ReviewDrawingStateCodes.Clear)
        {
            if (!string.IsNullOrWhiteSpace(drawingObjectsJson))
            {
                return null;
            }

            drawingObjectsJson = null;
        }
        else if (string.IsNullOrWhiteSpace(drawingObjectsJson))
        {
            return null;
        }

        return new ReviewDrawingFrameResult(
            frameNumber,
            timestampSeconds,
            timecode,
            normalizedStateCode,
            drawingObjectsJson);
    }

    private static IReadOnlyList<ReviewDrawingFrameResult> OrderDrawingFrames(IEnumerable<(ReviewDrawingFrameResult Frame, int GenerationOrder)> drawingFrames)
        => drawingFrames
            .OrderBy(x => x.Frame.FrameNumber)
            .ThenBy(x => x.GenerationOrder)
            .Select(x => x.Frame)
            .ToArray();

    private static void ValidateDrawingFrames(IReadOnlyList<ReviewDrawingFrameResult> drawingFrames)
    {
        foreach (var frame in drawingFrames)
        {
            if (!frame.FrameNumber.HasValue)
            {
                throw new BusinessException("drawing_frame_number_required", "Drawing frame number is required.");
            }

            if (!ReviewDrawingStateCodes.IsValid(frame.DrawingStateCode))
            {
                throw new BusinessException("invalid_drawing_state_code", $"Drawing state code '{frame.DrawingStateCode}' is invalid.");
            }

            if (frame.DrawingStateCode == ReviewDrawingStateCodes.Clear && !string.IsNullOrWhiteSpace(frame.DrawingObjectsJson))
            {
                throw new BusinessException("clear_frame_must_not_have_objects", "CLEAR frames must not include drawing objects.");
            }

            if (frame.DrawingStateCode == ReviewDrawingStateCodes.Drawn && string.IsNullOrWhiteSpace(frame.DrawingObjectsJson))
            {
                throw new BusinessException("drawn_frame_requires_objects", "DRAWN frames must include drawing objects.");
            }
        }
    }

    private static string? WriteTags(IReadOnlyList<string>? tags)
        => tags == null ? null : JsonSerializer.Serialize(tags);

    private static IReadOnlyList<string>? ReadTags(string? tagsJson)
        => string.IsNullOrWhiteSpace(tagsJson) ? null : JsonSerializer.Deserialize<string[]>(tagsJson);

    private static string NormalizeReviewDecision(string? decisionCode)
        => string.IsNullOrWhiteSpace(decisionCode) ? "PENDING" : decisionCode.Trim().ToUpperInvariant();

    private static string MergeUpdatedAnnotationDataJson(string? existingAnnotationDataJson, string newAnnotationDataJson)
    {
        var feedbackRoundId = ExtractFeedbackRoundId(newAnnotationDataJson)
            ?? ExtractFeedbackRoundId(existingAnnotationDataJson)
            ?? Guid.NewGuid();

        var drawingFrames = ExtractDrawingFrames(newAnnotationDataJson)
            ?? ExtractDrawingFrames(existingAnnotationDataJson)
            ?? [];

        return BuildAnnotationDataJson(newAnnotationDataJson, feedbackRoundId, drawingFrames);
    }

    private async Task<ReviewCommentResult> AddCommentInternalAsync(Guid reviewTaskId, CreateReviewCommentRequest request, CancellationToken cancellationToken)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var reviewTask = await _dbContext.ReviewTasks
            .Include(x => x.Lens)
                .ThenInclude(x => x.Episode)
                    .ThenInclude(x => x.Project)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .FirstOrDefaultAsync(x => x.Id == reviewTaskId, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");

        var projectCode = reviewTask.ProjectCode;
        var canAccess = await _permissionService.CanAccessProjectAsync(projectCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to comment on this review.");
        }

        var primaryLensId = reviewTask.Shots.OrderBy(x => x.Sequence).Select(x => (Guid?)x.LensId).FirstOrDefault() ?? reviewTask.LensId;
        var now = DateTimeOffset.UtcNow;

        var comment = new ReviewComment
        {
            ReviewTaskId = reviewTaskId,
            LensId = primaryLensId,
            VersionNum = reviewTask.Shots.OrderBy(x => x.Sequence).Select(x => x.SubmitVersionNum ?? x.PlayVersionNum).FirstOrDefault(),
            CreatedByUserId = currentUser.Id,
            CreatedByUserName = currentUser.DisplayName,
            Content = request.Content.Trim(),
            TimestampSeconds = request.TimestampSeconds,
            DecisionCode = NormalizeReviewDecision(request.DecisionCode),
            FrameNumber = request.FrameNumber,
            FrameImagePath = request.FrameImagePath,
            AnnotatedImagePath = request.AnnotatedImagePath,
            ThumbnailPath = request.ThumbnailPath,
            AnnotationDataJson = request.AnnotationDataJson
        };

        _dbContext.ReviewComments.Add(comment);
        await _dbContext.SaveChangesAsync(cancellationToken);

        if (primaryLensId.HasValue)
        {
            await RefreshTaskShotStateAsync(reviewTaskId, primaryLensId.Value, cancellationToken);
        }

        return new ReviewCommentResult(
            comment.Id,
            comment.ReviewTaskId,
            comment.CreatedByUserId,
            currentUser.DisplayName,
            comment.Content,
            comment.DecisionCode,
            comment.FrameNumber,
            comment.TimestampSeconds,
            comment.Timecode,
            ReadTags(comment.TagsJson),
            comment.FrameImagePath,
            comment.AnnotatedImagePath,
            comment.ThumbnailPath,
            comment.AnnotationDataJson,
            comment.CreatedAtUtc,
            comment.TaskShotId,
            ExtractFeedbackRoundId(comment.AnnotationDataJson),
            ExtractDrawingFrames(comment.AnnotationDataJson),
            comment.LensId,
            comment.Lens?.Code ?? string.Empty,
            comment.VersionNum);
    }

    private static string GetTaskShotLensCode(ReviewTask reviewTask, Guid? taskShotId)
        => reviewTask.Shots.FirstOrDefault(s => s.Id == taskShotId)?.Lens?.Code
           ?? reviewTask.Shots.OrderBy(x => x.Sequence).Select(x => x.Lens?.Code).FirstOrDefault(x => !string.IsNullOrWhiteSpace(x))
           ?? string.Empty;

    private async Task RefreshTaskShotStateAsync(Guid reviewTaskId, Guid lensId, CancellationToken cancellationToken)
    {
        var taskShot = await _dbContext.ReviewTaskShots
            .Include(x => x.Lens)
            .FirstOrDefaultAsync(x => x.ReviewTaskId == reviewTaskId && x.LensId == lensId, cancellationToken);

        if (taskShot == null)
        {
            return;
        }

        if (!IsReviewShot(taskShot))
        {
            taskShot.FeedbackCount = 0;
            taskShot.LastFeedbackAtUtc = null;
            taskShot.LatestFeedbackId = null;
            taskShot.Status = ReviewTaskShotStatuses.Viewed;
            await _dbContext.SaveChangesAsync(cancellationToken);
            return;
        }

        var feedbackCount = await _dbContext.ReviewComments.CountAsync(x => x.ReviewTaskId == reviewTaskId && x.LensId == lensId, cancellationToken);
        var latestFeedbackAtUtc = await _dbContext.ReviewComments
            .Where(x => x.ReviewTaskId == reviewTaskId && x.LensId == lensId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Select(x => (DateTimeOffset?)x.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

        var shotLens = taskShot.Lens ?? await _dbContext.Lenses.FirstOrDefaultAsync(x => x.Id == taskShot.LensId, cancellationToken);
        if (shotLens == null)
        {
            return;
        }

        taskShot.Lens = shotLens;

        taskShot.FeedbackCount = feedbackCount;
        taskShot.LastFeedbackAtUtc = latestFeedbackAtUtc;
        taskShot.LatestFeedbackId = await _dbContext.ReviewComments
            .Where(x => x.ReviewTaskId == reviewTaskId && x.LensId == lensId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        taskShot.Status = feedbackCount > 0
            ? ReviewTaskShotStatuses.Commented
            : ReviewTaskShotStatuses.Viewed;

        shotLens.LatestDirectorFeedbackAtUtc = latestFeedbackAtUtc;
        shotLens.LatestReviewTaskId = reviewTaskId;
        shotLens.PendingDirectorFeedbackCount = feedbackCount;

        if (feedbackCount > 0)
        {
            shotLens.InternalReviewStatusCode = LensInternalReviewStatuses.PendingFeedbackFix;
        }
        else if (LensInternalReviewStatuses.Normalize(shotLens.InternalReviewStatusCode) != LensInternalReviewStatuses.DirectorApproved)
        {
            shotLens.InternalReviewStatusCode = LensInternalReviewStatuses.InDirectorReview;
        }
        shotLens.InternalReviewUpdatedAtUtc = DateTimeOffset.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

}
