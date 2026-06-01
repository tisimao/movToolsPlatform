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

    /// <summary>
    /// 初始化 ReviewService 实例
    /// </summary>
    /// <param name="dbContext">数据库上下文</param>
    /// <param name="permissionService">权限服务</param>
    /// <param name="currentUserAccessor">当前用户访问器</param>
    /// <param name="activityLogService">活动日志服务</param>
    /// <param name="signalRPublisher">SignalR 推送器（可选）</param>
    /// <param name="logger">日志记录器</param>
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

    /// <summary>
    /// 提交镜头供审核
    /// </summary>
    /// <param name="lensId">镜头 ID</param>
    /// <param name="comment">提交备注</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
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

    /// <summary>
    /// 根据 ID 获取审核任务
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果，未找到时返回 null</returns>
    public async Task<ReviewTaskResult?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var reviewTask = await _dbContext.ReviewTasks
            .Include(x => x.CreatedByUser)
            .Include(x => x.DirectorUser)
            .Include(x => x.AssignedToUser)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (reviewTask == null) return null;

        var canAccess = await _permissionService.CanAccessProjectAsync(reviewTask.ProjectCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this review.");
        }

        if (!await CanDirectorReadTaskAsync(reviewTask, currentUser.Id, cancellationToken))
        {
            throw new NotFoundAppException("review_not_found", "The review task could not be found.");
        }

        return await MapToResultAsync(reviewTask, cancellationToken);
    }

    /// <summary>
    /// 获取审核任务详情
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    public Task<ReviewTaskResult?> GetTaskDetailAsync(Guid id, CancellationToken cancellationToken = default)
        => GetByIdAsync(id, cancellationToken);

    /// <summary>
    /// 获取当前用户待处理的审核任务列表
    /// </summary>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>待审核任务结果列表</returns>
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

        var query = _dbContext.ReviewTasks
            .Include(x => x.CreatedByUser)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .Where(x => x.Status == ReviewStatuses.Pending
                || x.Status == ReviewStatuses.InReview
                || x.Status == ReviewStatuses.Completed)
            .AsNoTracking();

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
            .Where(x => x.Status == ReviewStatuses.Pending
                || x.Status == ReviewStatuses.InReview
                || x.Status == ReviewStatuses.Completed)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var results = new List<ReviewTaskResult>();
        foreach (var task in reviewTasks)
        {
            results.Add(await MapToResultAsync(task, cancellationToken));
        }

        return results;
    }

    /// <summary>
    /// 根据镜头 ID 获取关联的审核任务列表
    /// </summary>
    /// <param name="lensId">镜头 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果列表</returns>
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
            .AsNoTracking()
            .Where(x => x.LensId == lensId || x.Shots.Any(s => s.LensId == lensId))
            .Where(x => x.Status != ReviewStatuses.Closed)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var results = new List<ReviewTaskResult>();
        foreach (var task in reviews)
        {
            results.Add(await MapToResultAsync(task, cancellationToken));
        }

        return results;
    }

    /// <summary>
    /// 通过审核任务
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="comment">审核备注</param>
    /// <param name="rowVersion">乐观并发版本号</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    public async Task<ReviewTaskResult> ApproveAsync(Guid id, string? comment, long rowVersion, CancellationToken cancellationToken = default)
        => await ExecuteReviewActionAsync(id, ReviewStatuses.Completed, null, rowVersion, cancellationToken);

    /// <summary>
    /// 拒绝审核任务
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="comment">拒绝原因备注</param>
    /// <param name="rowVersion">乐观并发版本号</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    public async Task<ReviewTaskResult> RejectAsync(Guid id, string? comment, long rowVersion, CancellationToken cancellationToken = default)
        => await ExecuteReviewActionAsync(id, ReviewStatuses.Closed, comment, rowVersion, cancellationToken);

    /// <summary>
    /// 关闭审核任务
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="rowVersion">乐观并发版本号</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    public async Task<ReviewTaskResult> CloseAsync(Guid id, long rowVersion, CancellationToken cancellationToken = default)
        => await ExecuteReviewActionAsync(id, ReviewStatuses.Closed, null, rowVersion, cancellationToken);

    /// <summary>
    /// 执行审核操作（通过/拒绝/关闭）
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="newStatus">目标状态</param>
    /// <param name="comment">操作备注</param>
    /// <param name="rowVersion">乐观并发版本号</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
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
            else if (newStatus is ReviewStatuses.Pending or ReviewStatuses.InReview)
            {
                if (currentReviewStatus != LensInternalReviewStatuses.DirectorApproved)
                {
                    shotLens.InternalReviewStatusCode = LensInternalReviewStatuses.InDirectorReview;
                }
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

    /// <summary>
    /// 向审核任务添加评论
    /// </summary>
    /// <param name="reviewTaskId">审核任务 ID</param>
    /// <param name="content">评论内容</param>
    /// <param name="timestampSeconds">评论关联的时间戳（秒）</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>评论结果</returns>
    public async Task<ReviewCommentResult> AddCommentAsync(Guid reviewTaskId, string content, double? timestampSeconds, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var reviewTask = await _dbContext.ReviewTasks
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .Include(x => x.Lens)
                .ThenInclude(x => x!.Episode)
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

    /// <summary>
    /// 向审核任务添加评论（基于请求对象）
    /// </summary>
    /// <param name="reviewTaskId">审核任务 ID</param>
    /// <param name="request">创建评论请求对象</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>评论结果</returns>
    public async Task<ReviewCommentResult> AddCommentAsync(Guid reviewTaskId, CreateReviewCommentRequest request, CancellationToken cancellationToken = default)
    {
        var result = await AddCommentInternalAsync(reviewTaskId, request, cancellationToken);
        return result;
    }

    /// <summary>
    /// 创建反馈（含文字反馈和绘图帧）
    /// </summary>
    /// <param name="request">创建反馈请求</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>评论结果</returns>
    public async Task<ReviewCommentResult> CreateFeedbackAsync(CreateReviewFeedbackRequest request, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var reviewTask = await _dbContext.ReviewTasks
            .Include(x => x.Lens)
                .ThenInclude(x => x!.Episode)
                    .ThenInclude(x => x.Project)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .AsNoTracking()
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

        EnsureReviewShot(taskShot);

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
            FeedbackRoundId = feedbackRoundId,
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
        await UpsertFeedbackRoundAsync(reviewTask.Id, taskShot.LensId, feedbackRoundId, cancellationToken);

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

        var primaryShot = reviewTask.Shots.Where(IsReviewShot).OrderBy(x => x.Sequence).FirstOrDefault();
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
            ResolveFeedbackRoundId(comment),
            ExtractDrawingFrames(comment.AnnotationDataJson) ?? drawingFrames,
            primaryShot?.LensId,
            GetTaskShotLensCode(reviewTask, comment.TaskShotId),
            primaryShot?.SubmitVersionNum ?? primaryShot?.PlayVersionNum);
    }

    /// <summary>
    /// 获取审核任务的所有评论
    /// </summary>
    /// <param name="reviewTaskId">审核任务 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>评论结果列表</returns>
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
            ResolveFeedbackRoundId(c),
            ExtractDrawingFrames(c.AnnotationDataJson),
            c.LensId,
            GetTaskShotLensCode(c.ReviewTask, c.TaskShotId),
            c.VersionNum)).ToArray();
    }

    /// <summary>
    /// 根据镜头 ID 获取反馈列表
    /// </summary>
    /// <param name="lensId">镜头 ID</param>
    /// <param name="feedbackRoundId">反馈轮次 ID（可选）</param>
    /// <param name="includeAllRounds">是否包含所有轮次</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>评论结果列表</returns>
    public async Task<IReadOnlyList<ReviewCommentResult>> GetFeedbacksByLensAsync(Guid lensId, Guid? feedbackRoundId = null, bool includeAllRounds = false, CancellationToken cancellationToken = default)
    {
        var result = await GetFeedbackLensAsync(lensId, feedbackRoundId, includeAllRounds, cancellationToken);
        return result.Feedbacks;
    }

    /// <summary>
    /// 根据镜头 ID 获取绘图帧列表
    /// </summary>
    /// <param name="lensId">镜头 ID</param>
    /// <param name="feedbackRoundId">反馈轮次 ID（可选）</param>
    /// <param name="includeAllRounds">是否包含所有轮次</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>绘图帧结果列表</returns>
    public async Task<IReadOnlyList<ReviewDrawingFrameResult>> GetDrawingFramesByLensAsync(Guid lensId, Guid? feedbackRoundId = null, bool includeAllRounds = false, CancellationToken cancellationToken = default)
    {
        var result = await GetFeedbackLensAsync(lensId, feedbackRoundId, includeAllRounds, cancellationToken);
        return result.DrawingFrames;
    }

    /// <summary>
    /// 根据镜头 ID 获取完整的反馈数据（含反馈列表、绘图帧、轮次信息）
    /// </summary>
    /// <param name="lensId">镜头 ID</param>
    /// <param name="feedbackRoundId">反馈轮次 ID（可选）</param>
    /// <param name="includeAllRounds">是否包含所有轮次</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>反馈镜头结果</returns>
    public async Task<ReviewFeedbackLensResult> GetFeedbackLensAsync(Guid lensId, Guid? feedbackRoundId = null, bool includeAllRounds = false, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
                .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        var currentUserId = _currentUserAccessor.GetCurrentUser()?.Id ?? Guid.Empty;
        var canAccess = await _permissionService.CanReadLensAsync(lens.Episode.Project.Code, currentUserId, lens.MakerUserId, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this lens feedback.");
        }

        var feedbacks = await LoadFeedbacksByLensInternalAsync(lensId, cancellationToken);
        var rounds = await LoadFeedbackRoundsAsync(lensId, cancellationToken);

        var targetRoundId = feedbackRoundId is { } explicitRoundId && explicitRoundId != Guid.Empty
            ? explicitRoundId
            : (includeAllRounds ? (Guid?)null : rounds.FirstOrDefault()?.FeedbackRoundId);

        if (targetRoundId.HasValue)
        {
            feedbacks = feedbacks.Where(x => ResolveFeedbackRoundId(x) == targetRoundId.Value).ToList();
        }

        var selectedRounds = includeAllRounds
            ? rounds
            : targetRoundId.HasValue
                ? rounds.Where(x => x.FeedbackRoundId == targetRoundId.Value).ToArray()
                : rounds.Take(1).ToArray();

        var latestRound = selectedRounds.FirstOrDefault();
        var latestFeedbackRoundId = targetRoundId ?? latestRound?.FeedbackRoundId;
        var latestFeedbackAtUtc = selectedRounds.FirstOrDefault()?.LatestFeedbackAtUtc;
        var drawingFrames = includeAllRounds
            ? selectedRounds
                .OrderByDescending(x => x.CreatedAtUtc)
                .SelectMany(x => x.DrawingFrames)
                .ToArray()
            : latestRound?.DrawingFrames ?? [];

        return new ReviewFeedbackLensResult(
            lensId,
            latestFeedbackRoundId,
            latestFeedbackAtUtc,
            feedbacks,
            drawingFrames,
            latestRound,
            includeAllRounds);
    }

    /// <summary>
    /// 加载镜头关联的所有反馈轮次
    /// </summary>
    /// <param name="lensId">镜头 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>反馈轮次结果列表</returns>
    private async Task<IReadOnlyList<ReviewFeedbackRoundResult>> LoadFeedbackRoundsAsync(Guid lensId, CancellationToken cancellationToken)
    {
        var rounds = await _dbContext.ReviewFeedbackRounds
            .Where(x => x.LensId == lensId)
            .OrderByDescending(x => x.LatestFeedbackAtUtc)
            .ThenByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        return rounds.Select(x => new ReviewFeedbackRoundResult(
            x.FeedbackRoundId,
            x.CreatedAtUtc,
            x.FeedbackCount,
            x.LatestFeedbackAtUtc,
            DeserializeDrawingFrames(x.DrawingFramesJson))).ToArray();
    }

    /// <summary>
    /// 解析反馈的轮次 ID（优先使用 FeedbackRoundId 字段，其次从 AnnotationDataJson 提取）
    /// </summary>
    /// <param name="feedback">反馈评论实体</param>
    /// <returns>反馈轮次 ID</returns>
    private Guid? ResolveFeedbackRoundId(ReviewComment feedback)
        => feedback.FeedbackRoundId
           ?? ExtractFeedbackRoundId(feedback.AnnotationDataJson);

    /// <summary>
    /// 从评论结果中获取反馈轮次 ID
    /// </summary>
    /// <param name="feedback">评论结果</param>
    /// <returns>反馈轮次 ID</returns>
    private static Guid? ResolveFeedbackRoundId(ReviewCommentResult feedback)
        => feedback.FeedbackRoundId;

    /// <summary>
    /// 内部方法：加载指定镜头的所有反馈
    /// </summary>
    /// <param name="lensId">镜头 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>评论结果列表</returns>
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

    /// <summary>
    /// 根据反馈 ID 获取反馈详情
    /// </summary>
    /// <param name="feedbackId">反馈 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>评论结果，未找到时返回 null</returns>
    public async Task<ReviewCommentResult?> GetFeedbackByIdAsync(Guid feedbackId, CancellationToken cancellationToken = default)
    {
        var feedback = await _dbContext.ReviewComments
            .Include(x => x.Lens)
            .Include(x => x.ReviewTask)
                .ThenInclude(x => x.Shots)
                    .ThenInclude(x => x.Lens)
            .FirstOrDefaultAsync(x => x.Id == feedbackId, cancellationToken);

        if (feedback == null)
        {
            return null;
        }

        var canAccess = await _permissionService.CanReadLensAsync(
            feedback.ReviewTask.ProjectCode,
            _currentUserAccessor.GetCurrentUser()?.Id ?? Guid.Empty,
            feedback.Lens?.MakerUserId,
            cancellationToken);
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
            ResolveFeedbackRoundId(feedback),
            ExtractDrawingFrames(feedback.AnnotationDataJson),
            feedback.LensId,
            feedback.Lens?.Code ?? string.Empty,
            feedback.VersionNum);
    }

    /// <summary>
    /// 更新反馈
    /// </summary>
    /// <param name="feedbackId">反馈 ID</param>
    /// <param name="request">更新反馈请求</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>评论结果</returns>
    public Task<ReviewCommentResult> UpdateFeedbackAsync(Guid feedbackId, UpdateReviewFeedbackRequest request, CancellationToken cancellationToken = default)
        => UpdateFeedbackInternalAsync(feedbackId, request, cancellationToken);

    /// <summary>
    /// 删除反馈
    /// </summary>
    /// <param name="feedbackId">反馈 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    public Task DeleteFeedbackAsync(Guid feedbackId, CancellationToken cancellationToken = default)
        => DeleteFeedbackInternalAsync(feedbackId, cancellationToken);

    /// <summary>
    /// 创建审核任务
    /// </summary>
    /// <param name="request">创建审核任务请求</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    public Task<ReviewTaskResult> CreateTaskAsync(CreateReviewTaskRequest request, CancellationToken cancellationToken = default)
        => CreateTaskInternalAsync(request, cancellationToken);

    /// <summary>
    /// 获取所有待处理的审核任务
    /// </summary>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果列表</returns>
    public Task<IReadOnlyList<ReviewTaskResult>> GetTasksAsync(CancellationToken cancellationToken = default)
        => GetPendingReviewsAsync(cancellationToken);

    /// <summary>
    /// 根据 ID 获取审核任务
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    public Task<ReviewTaskResult?> GetTaskByIdAsync(Guid id, CancellationToken cancellationToken = default)
        => GetByIdAsync(id, cancellationToken);

    /// <summary>
    /// 更新审核任务
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="request">更新审核任务请求</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    public Task<ReviewTaskResult> UpdateTaskAsync(Guid id, UpdateReviewTaskRequest request, CancellationToken cancellationToken = default)
        => UpdateTaskInternalAsync(id, request, cancellationToken);

    /// <summary>
    /// 提交审核任务（将状态设为待审核）
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    public async Task<ReviewTaskResult> SubmitTaskAsync(Guid id, CancellationToken cancellationToken = default)
        => await SetTaskStatusAsync(id, ReviewStatuses.Pending, cancellationToken);

    /// <summary>
    /// 开始审核任务（将状态设为审核中）
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    public async Task<ReviewTaskResult> StartTaskAsync(Guid id, CancellationToken cancellationToken = default)
        => await SetTaskStatusAsync(id, ReviewStatuses.InReview, cancellationToken);

    /// <summary>
    /// 完成审核任务（将状态设为已完成）
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    public async Task<ReviewTaskResult> CompleteTaskAsync(Guid id, CancellationToken cancellationToken = default)
        => await SetTaskStatusAsync(id, ReviewStatuses.Completed, cancellationToken);

    /// <summary>
    /// 关闭审核任务
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    public async Task<ReviewTaskResult> CloseTaskAsync(Guid id, CancellationToken cancellationToken = default)
        => await CloseTaskInternalAsync(id, cancellationToken);

    /// <summary>
    /// 向审核任务添加镜头
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="shots">待添加的镜头列表</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务镜头结果列表</returns>
    public Task<IReadOnlyList<ReviewTaskShotResult>> AddTaskShotsAsync(Guid id, IReadOnlyList<CreateReviewTaskShotRequest> shots, CancellationToken cancellationToken = default)
        => AddTaskShotsInternalAsync(id, shots, cancellationToken);

    /// <summary>
    /// 从审核任务移除镜头
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="taskShotIds">待移除的镜头 ID 列表</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务镜头结果列表</returns>
    public Task<IReadOnlyList<ReviewTaskShotResult>> RemoveTaskShotsAsync(Guid id, IReadOnlyList<Guid> taskShotIds, CancellationToken cancellationToken = default)
        => RemoveTaskShotsInternalAsync(id, taskShotIds, cancellationToken);

    /// <summary>
    /// 重新排序审核任务中的镜头
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="orderedTaskShotIds">按新顺序排列的镜头 ID 列表</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务镜头结果列表</returns>
    public Task<IReadOnlyList<ReviewTaskShotResult>> ReorderTaskShotsAsync(Guid id, IReadOnlyList<Guid> orderedTaskShotIds, CancellationToken cancellationToken = default)
        => ReorderTaskShotsInternalAsync(id, orderedTaskShotIds, cancellationToken);

    /// <summary>
    /// 将审核任务实体映射为结果对象
    /// </summary>
    /// <param name="reviewTask">审核任务实体</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
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

    /// <summary>
    /// 设置审核任务状态（提交/开始审核/完成）
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="newStatus">目标状态</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    private async Task<ReviewTaskResult> SetTaskStatusAsync(Guid id, string newStatus, CancellationToken cancellationToken)
    {
        // 获取当前用户，未认证则抛出异常
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        // 加载审核任务及其关联的镜头、剧集、项目、用户、镜头快照
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

        // 检查当前用户是否有权访问该项目
        var canAccess = await _permissionService.CanAccessProjectAsync(task.ProjectCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to modify this review.");
        }

        // 获取用户角色：管理员、导演、制片
        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        var isDirector = await _permissionService.IsInRoleAsync(currentUser.Id, "director", cancellationToken);
        var isProducer = await _permissionService.IsInRoleAsync(currentUser.Id, "producer", cancellationToken);

        // 根据目标状态进行角色权限校验
        if (newStatus == ReviewStatuses.Pending)
        {
            // 提交审核：仅管理员和制片人可以操作
            if (!isAdmin && !isProducer)
            {
                throw new UnauthorizedAppException("producer_only_action", "Only producers can submit reviews.");
            }
        }
        else if (newStatus is ReviewStatuses.InReview or ReviewStatuses.Completed)
        {
            // 开始审核/完成审核：仅管理员和导演可以操作
            if (!isAdmin && !isDirector)
            {
                throw new UnauthorizedAppException("director_only_action", "Only directors can complete reviews.");
            }
        }
        else if (newStatus == ReviewStatuses.Closed)
        {
            // 关闭审核：需要镜头读取权限，且任务必须是已完成状态
            var canReadLens = await _permissionService.CanReadLensAsync(task.ProjectCode, currentUser.Id, task.Lens?.MakerUserId, cancellationToken);
            if (!canReadLens)
            {
                throw new UnauthorizedAppException("project_access_denied", "You do not have permission to modify this review.");
            }

            if (task.Status != ReviewStatuses.Completed)
            {
                throw new BusinessException("review_task_not_completed", "The review task must be completed by the director before it can be closed.");
            }

            // 关闭操作直接返回结果，不会修改状态到 Closed（由 CloseTaskInternalAsync 处理）
            return await MapToResultAsync(task, cancellationToken);
        }
        else
        {
            // 不支持的状态转换目标
            throw new BusinessException("review_task_invalid_status", $"The review task cannot transition to {newStatus}.");
        }

        // 完成前检查：所有正式镜头必须已通过审批或已有反馈
        if (newStatus == ReviewStatuses.Completed && !CanCompleteTask(task)&& !isAdmin)
        {
            throw new BusinessException("review_task_not_ready_to_complete", "The review task can only be completed after every formal shot has either been approved or has formal feedback.");
        }

        // 如果任务已经是已完成或已关闭状态，则不做任何变更直接返回
        if (task.Status is ReviewStatuses.Completed or ReviewStatuses.Closed)
        {
            return await MapToResultAsync(task, cancellationToken);
        }

        // 校验状态转换是否合法
        // Draft/Ready -> Pending -> InReview -> Completed
        var isValidTransition = newStatus switch
        {
            ReviewStatuses.Pending => task.Status is ReviewStatuses.Draft or ReviewStatuses.Ready,  // 草稿/就绪 -> 待审核
            ReviewStatuses.InReview => task.Status == ReviewStatuses.Pending,                      // 待审核 -> 审核中
            ReviewStatuses.Completed => task.Status == ReviewStatuses.InReview,                    // 审核中 -> 已完成
            _ => false
        };

        if (!isValidTransition)
        {
            throw new BusinessException("review_task_invalid_transition", $"The review task cannot transition from {task.Status} to {newStatus}.");
        }

        // 执行状态变更
        task.Status = newStatus;

        // 进入审核中状态时，将镜头的内部审核状态更新为"导演审核中"
        if (newStatus == ReviewStatuses.InReview)
        {
            foreach (var taskShot in task.Shots)
            {
                // 跳过上下文镜头（非正式审核镜头）
                if (!IsReviewShot(taskShot))
                {
                    continue;
                }

                var shotLens = taskShot.Lens ?? await _dbContext.Lenses.FirstAsync(x => x.Id == taskShot.LensId, cancellationToken);
                taskShot.Lens = shotLens;
                var currentReviewStatus = LensInternalReviewStatuses.Normalize(shotLens.InternalReviewStatusCode);
                // 只有"待审核"或"修改后更新"的镜头才转入"导演审核中"
                if (currentReviewStatus is LensInternalReviewStatuses.ReadyForReview or LensInternalReviewStatuses.FixUpdated)
                {
                    shotLens.InternalReviewStatusCode = LensInternalReviewStatuses.InDirectorReview;
                    shotLens.InternalReviewUpdatedAtUtc = DateTimeOffset.UtcNow;
                }
            }
        }

        // 进入已完成状态时，记录完成时间
        if (newStatus is ReviewStatuses.Completed)
        {
            task.CompletedAtUtc ??= DateTimeOffset.UtcNow;
        }

        // 持久化变更并返回映射后的结果
        await _dbContext.SaveChangesAsync(cancellationToken);
        return await MapToResultAsync(task, cancellationToken);
    }

    /// <summary>
    /// 内部方法：关闭已完成的审核任务
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    private async Task<ReviewTaskResult> CloseTaskInternalAsync(Guid id, CancellationToken cancellationToken)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

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

        var canAccess = await _permissionService.CanAccessProjectAsync(task.ProjectCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to modify this review.");
        }

        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        var isProducer = await _permissionService.IsInRoleAsync(currentUser.Id, "producer", cancellationToken);
        if (!isAdmin && !isProducer)
        {
            throw new UnauthorizedAppException("producer_only_action", "Only producers can close completed reviews.");
        }

        if (task.Status != ReviewStatuses.Completed)
        {
            throw new BusinessException("review_task_not_completed", "The review task must be completed by the director before it can be closed.");
        }

        task.Status = ReviewStatuses.Closed;
        task.RowVersion += 1;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return await MapToResultAsync(task, cancellationToken);
    }

    /// <summary>
    /// 内部方法：创建审核任务（草稿状态）
    /// </summary>
    /// <param name="request">创建审核任务请求</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
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

    /// <summary>
    /// 判断数据库异常是否为 LensId 为空导致的 Schema 冲突
    /// </summary>
    /// <param name="exception">数据库更新异常</param>
    /// <returns>是否为 LensId 不匹配异常</returns>
    private static bool IsSchemaLensIdMismatch(DbUpdateException exception)
    {
        var message = exception.InnerException?.Message ?? exception.Message;
        return message.Contains("review_tasks", StringComparison.OrdinalIgnoreCase)
            && message.Contains("LensId", StringComparison.OrdinalIgnoreCase)
            && message.Contains("null", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// 内部方法：更新审核任务（含镜头增删改）
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="request">更新审核任务请求</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务结果</returns>
    private async Task<ReviewTaskResult> UpdateTaskInternalAsync(Guid id, UpdateReviewTaskRequest request, CancellationToken cancellationToken)
    {
        var task = await _dbContext.ReviewTasks
            .Include(x => x.Shots)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");

        await ValidateDirectorUserAsync(request.DirectorUserId, cancellationToken);

        task.Name = request.Name.Trim();
        task.Description = request.Description?.Trim();
        task.DirectorUserId = request.DirectorUserId;
        task.DueAtUtc = request.DueAtUtc;

        if (request.Shots is { Count: > 0 })
        {
            var incomingByLensId = request.Shots.ToDictionary(x => x.LensId, x => x);
            var incomingLensIds = incomingByLensId.Keys.ToHashSet();

            var staleShots = task.Shots.Where(x => !incomingLensIds.Contains(x.LensId)).ToList();
            if (staleShots.Count > 0)
            {
                _dbContext.ReviewTaskShots.RemoveRange(staleShots);
            }

            foreach (var taskShot in task.Shots.Where(x => incomingLensIds.Contains(x.LensId)))
            {
                var incoming = incomingByLensId[taskShot.LensId];
                taskShot.Sequence = incoming.Sequence;
                taskShot.ParticipationMode = RequireParticipationMode(incoming.ParticipationMode);
                taskShot.SubmitVersionNum = incoming.SubmitVersionNum;
                taskShot.PlayVersionNum = incoming.SubmitVersionNum;
            }

            var newShots = request.Shots.Where(x => task.Shots.All(existing => existing.LensId != x.LensId)).ToArray();
            if (newShots.Length > 0)
            {
                await AddTaskShotsInternalAsync(task.Id, newShots, cancellationToken);
                task = await _dbContext.ReviewTasks
                    .Include(x => x.Shots)
                    .FirstAsync(x => x.Id == id, cancellationToken);
            }

            if (!task.LensId.HasValue || !incomingLensIds.Contains(task.LensId.Value))
            {
                task.LensId = request.Shots.OrderBy(x => x.Sequence).FirstOrDefault()?.LensId;
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return await GetByIdAsync(task.Id, cancellationToken) ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");
    }

    /// <summary>
    /// 内部方法：向审核任务添加镜头
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="shots">待添加的镜头列表</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务镜头结果列表</returns>
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
                ParticipationMode = RequireParticipationMode(shot.ParticipationMode),
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

    /// <summary>
    /// 根据数据库异常创建草稿保存失败的业务异常
    /// </summary>
    /// <param name="exception">数据库更新异常</param>
    /// <returns>业务异常</returns>
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

    /// <summary>
    /// 内部方法：重新排序审核任务中的镜头
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="orderedTaskShotIds">按新顺序排列的镜头 ID 列表</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务镜头结果列表</returns>
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

    /// <summary>
    /// 内部方法：从审核任务中移除镜头
    /// </summary>
    /// <param name="id">审核任务 ID</param>
    /// <param name="taskShotIds">待移除的镜头 ID 列表</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务镜头结果列表</returns>
    private async Task<IReadOnlyList<ReviewTaskShotResult>> RemoveTaskShotsInternalAsync(Guid id, IReadOnlyList<Guid> taskShotIds, CancellationToken cancellationToken)
    {
        var shots = await _dbContext.ReviewTaskShots
            .Where(x => x.ReviewTaskId == id && taskShotIds.Contains(x.Id))
            .ToListAsync(cancellationToken);

        _dbContext.ReviewTaskShots.RemoveRange(shots);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return await LoadTaskShotsAsync(id, cancellationToken);
    }

    /// <summary>
    /// 验证导演用户存在且具有导演角色
    /// </summary>
    /// <param name="directorUserId">导演用户 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
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

    /// <summary>
    /// 检查导演是否有权限查看审核任务
    /// </summary>
    /// <param name="reviewTask">审核任务实体</param>
    /// <param name="currentUserId">当前用户 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>是否有权限查看</returns>
    private async Task<bool> CanDirectorReadTaskAsync(ReviewTask reviewTask, Guid currentUserId, CancellationToken cancellationToken)
    {
        if (await _permissionService.IsAdminAsync(currentUserId, cancellationToken))
        {
            return true;
        }

        if (!await _permissionService.IsInRoleAsync(currentUserId, "director", cancellationToken))
        {
            return true;
        }

        return reviewTask.Status is ReviewStatuses.Pending or ReviewStatuses.InReview or ReviewStatuses.Completed;
    }

    /// <summary>
    /// 内部方法：更新反馈内容
    /// </summary>
    /// <param name="feedbackId">反馈 ID</param>
    /// <param name="request">更新反馈请求</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>评论结果</returns>
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

        EnsureReviewShot(taskShot);

        if (feedback.TaskShotId.HasValue)
        {
            var taskShotById = await _dbContext.ReviewTaskShots.FirstOrDefaultAsync(x => x.Id == feedback.TaskShotId.Value, cancellationToken);
            EnsureReviewShot(taskShotById);
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
            var roundId = ExtractFeedbackRoundId(feedback.AnnotationDataJson) ?? feedback.FeedbackRoundId ?? Guid.NewGuid();
            feedback.AnnotationDataJson = BuildAnnotationDataJson(
                request.AnnotationDataJson ?? ExtractAnnotationDataJson(feedback.AnnotationDataJson),
                roundId,
                drawingFrames);
            feedback.FeedbackRoundId = roundId;
        }
        else
        {
            feedback.FeedbackRoundId = ExtractFeedbackRoundId(feedback.AnnotationDataJson) ?? feedback.FeedbackRoundId;
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

        if (feedback.FeedbackRoundId.HasValue && feedback.LensId.HasValue)
        {
            await UpsertFeedbackRoundAsync(feedback.ReviewTaskId, feedback.LensId.Value, feedback.FeedbackRoundId.Value, cancellationToken);
        }

        if (feedback.LensId.HasValue)
        {
            await RefreshTaskShotStateAsync(feedback.ReviewTaskId, feedback.LensId.Value, cancellationToken);
        }
        return await MapFeedbackAsync(feedback, cancellationToken);
    }

    /// <summary>
    /// 内部方法：删除反馈
    /// </summary>
    /// <param name="feedbackId">反馈 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    private async Task DeleteFeedbackInternalAsync(Guid feedbackId, CancellationToken cancellationToken)
    {
        var feedback = await _dbContext.ReviewComments.FirstOrDefaultAsync(x => x.Id == feedbackId, cancellationToken);
        if (feedback == null)
        {
            return;
        }

        var taskShot = await _dbContext.ReviewTaskShots
            .FirstOrDefaultAsync(x => x.ReviewTaskId == feedback.ReviewTaskId && x.LensId == feedback.LensId, cancellationToken);
        EnsureReviewShot(taskShot);

        _dbContext.ReviewComments.Remove(feedback);
        await _dbContext.SaveChangesAsync(cancellationToken);

        if (feedback.FeedbackRoundId.HasValue && feedback.LensId.HasValue)
        {
            await RefreshFeedbackRoundAsync(feedback.ReviewTaskId, feedback.LensId.Value, feedback.FeedbackRoundId.Value, cancellationToken);
        }

        if (feedback.LensId.HasValue)
        {
            await RefreshTaskShotStateAsync(feedback.ReviewTaskId, feedback.LensId.Value, cancellationToken);
        }
    }

    /// <summary>
    /// 加载审核任务的所有镜头
    /// </summary>
    /// <param name="reviewTaskId">审核任务 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>审核任务镜头结果列表</returns>
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

    /// <summary>
    /// 构建审核任务摘要信息
    /// </summary>
    /// <param name="task">审核任务实体</param>
    /// <param name="shots">镜头列表</param>
    /// <param name="feedbackCount">反馈总数</param>
    /// <returns>审核任务摘要结果</returns>
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

    /// <summary>
    /// 判断镜头是否为正式审核镜头（参与模式为 Review）
    /// </summary>
    /// <param name="shot">审核任务镜头实体</param>
    /// <returns>是否为审核镜头</returns>
    private static bool IsReviewShot(ReviewTaskShot shot)
        => string.Equals(shot.ParticipationMode?.Trim(), ReviewTaskShotParticipationModes.Review, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// 判断镜头结果是否为正式审核镜头
    /// </summary>
    /// <param name="shot">审核任务镜头结果</param>
    /// <returns>是否为审核镜头</returns>
    private static bool IsReviewShot(ReviewTaskShotResult shot)
        => string.Equals(shot.ParticipationMode?.Trim(), ReviewTaskShotParticipationModes.Review, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// 检查审核任务是否满足完成条件（所有正式镜头已通过导演审批或已有反馈）
    /// </summary>
    /// <param name="task">审核任务实体</param>
    /// <returns>是否可以完成</returns>
    private static bool CanCompleteTask(ReviewTask task)
        => task.Shots.Where(IsReviewShot).All(shot =>
            string.Equals(LensInternalReviewStatuses.Normalize(shot.Lens.InternalReviewStatusCode), LensInternalReviewStatuses.DirectorApproved, StringComparison.OrdinalIgnoreCase)
            || shot.FeedbackCount > 0);

    /// <summary>
    /// 确保镜头为正式审核镜头，否则抛出业务异常
    /// </summary>
    /// <param name="shot">审核任务镜头</param>
    private static void EnsureReviewShot(ReviewTaskShot? shot)
    {
        if (shot != null && !IsReviewShot(shot))
        {
            throw new BusinessException("context_shot_not_allowed", "Context shots cannot receive formal feedback, approval, rework, or completion-side statistics.");
        }
    }

    /// <summary>
    /// 验证并规范化参与模式
    /// </summary>
    /// <param name="participationMode">参与模式字符串</param>
    /// <returns>规范化后的参与模式</returns>
    private static string RequireParticipationMode(string? participationMode)
    {
        if (string.IsNullOrWhiteSpace(participationMode))
        {
            throw new BusinessException("review_task_shot_participation_mode_required", "Participation mode is required.");
        }

        var normalized = participationMode.Trim().ToLowerInvariant();
        if (!ReviewTaskShotParticipationModes.IsValid(normalized))
        {
            throw new BusinessException("review_task_shot_participation_mode_invalid", $"Participation mode '{participationMode}' is invalid.");
        }

        return normalized;
    }

    /// <summary>
    /// 将反馈实体映射为评论结果对象
    /// </summary>
    /// <param name="feedback">反馈评论实体</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>评论结果</returns>
    private async Task<ReviewCommentResult> MapFeedbackAsync(ReviewComment feedback, CancellationToken cancellationToken)
    {
        await _dbContext.Entry(feedback).Reference(x => x.CreatedByUser).LoadAsync(cancellationToken);
        return new ReviewCommentResult(
            feedback.Id,
            feedback.ReviewTaskId,
            feedback.CreatedByUserId,
            feedback.CreatedByUserName ?? feedback.CreatedByUser?.DisplayName ?? "unknown",
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

    /// <summary>
    /// 从 JSON 中提取嵌套的 annotationDataJson 字段值
    /// </summary>
    /// <param name="annotationDataJson">注解数据 JSON</param>
    /// <returns>提取的 annotationDataJson 字符串</returns>
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

    /// <summary>
    /// 从 JSON 中提取 feedbackRoundId
    /// </summary>
    /// <param name="annotationDataJson">注解数据 JSON</param>
    /// <returns>反馈轮次 ID</returns>
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

    /// <summary>
    /// 从 JSON 中提取绘图帧数据
    /// </summary>
    /// <param name="annotationDataJson">注解数据 JSON</param>
    /// <returns>绘图帧结果列表</returns>
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

    /// <summary>
    /// 构建反馈负载 JSON（含注解数据、反馈轮次 ID 和绘图帧）
    /// </summary>
    /// <param name="annotationDataJson">注解数据 JSON</param>
    /// <param name="feedbackRoundId">反馈轮次 ID</param>
    /// <param name="drawingFrames">绘图帧列表</param>
    /// <returns>反馈负载 JSON 字符串</returns>
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

    /// <summary>
    /// 构建注解数据 JSON（BuildFeedbackPayloadJson 的别名方法）
    /// </summary>
    /// <param name="annotationDataJson">注解数据 JSON</param>
    /// <param name="feedbackRoundId">反馈轮次 ID</param>
    /// <param name="drawingFrames">绘图帧列表</param>
    /// <returns>注解数据 JSON 字符串</returns>
    private static string BuildAnnotationDataJson(string? annotationDataJson, Guid feedbackRoundId, IReadOnlyList<ReviewDrawingFrameResult> drawingFrames)
        => BuildFeedbackPayloadJson(annotationDataJson, feedbackRoundId, drawingFrames);

    /// <summary>
    /// 反序列化绘图帧 JSON 为对象列表
    /// </summary>
    /// <param name="drawingFramesJson">绘图帧 JSON 字符串</param>
    /// <returns>绘图帧结果列表</returns>
    private static IReadOnlyList<ReviewDrawingFrameResult> DeserializeDrawingFrames(string? drawingFramesJson)
    {
        if (string.IsNullOrWhiteSpace(drawingFramesJson))
        {
            return [];
        }

        try
        {
            var frames = JsonSerializer.Deserialize<ReviewDrawingFrameResult[]>(drawingFramesJson);
            return frames ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>
    /// 更新或插入反馈轮次记录（含绘图帧和反馈计数）
    /// </summary>
    /// <param name="reviewTaskId">审核任务 ID</param>
    /// <param name="lensId">镜头 ID</param>
    /// <param name="feedbackRoundId">反馈轮次 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    private async Task UpsertFeedbackRoundAsync(Guid reviewTaskId, Guid lensId, Guid feedbackRoundId, CancellationToken cancellationToken)
    {
        var round = await _dbContext.ReviewFeedbackRounds
            .FirstOrDefaultAsync(x => x.ReviewTaskId == reviewTaskId && x.LensId == lensId && x.FeedbackRoundId == feedbackRoundId, cancellationToken);

        var feedbacks = await _dbContext.ReviewComments
            .Where(x => x.ReviewTaskId == reviewTaskId && x.LensId == lensId && x.FeedbackRoundId == feedbackRoundId)
            .OrderBy(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        DateTimeOffset? latestFeedbackAtUtc = feedbacks.Count == 0 ? null : feedbacks.Max(x => x.CreatedAtUtc);
        var drawingFrames = feedbacks
            .SelectMany(x => ExtractDrawingFrames(x.AnnotationDataJson) ?? Array.Empty<ReviewDrawingFrameResult>())
            .ToArray();

        if (round == null)
        {
            round = new ReviewFeedbackRound
            {
                ReviewTaskId = reviewTaskId,
                LensId = lensId,
                FeedbackRoundId = feedbackRoundId,
                DrawingFramesJson = JsonSerializer.Serialize(drawingFrames),
                FeedbackCount = feedbacks.Count,
                LatestFeedbackAtUtc = latestFeedbackAtUtc,
                RowVersion = 1
            };
            _dbContext.ReviewFeedbackRounds.Add(round);
            return;
        }

        round.DrawingFramesJson = JsonSerializer.Serialize(drawingFrames);
        round.FeedbackCount = feedbacks.Count;
        round.LatestFeedbackAtUtc = latestFeedbackAtUtc;
        round.RowVersion += 1;
    }

    /// <summary>
    /// 规范化并验证绘图帧请求数据
    /// </summary>
    /// <param name="drawingFrames">绘图帧请求列表</param>
    /// <returns>规范化后的绘图帧结果列表</returns>
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

    /// <summary>
    /// 尝试创建绘图帧结果对象（验证帧号和绘图状态码的合法性）
    /// </summary>
    /// <param name="frameNumber">帧号</param>
    /// <param name="timestampSeconds">时间戳（秒）</param>
    /// <param name="timecode">时间码</param>
    /// <param name="drawingStateCode">绘图状态码</param>
    /// <param name="drawingObjectsJson">绘图对象 JSON</param>
    /// <returns>绘图帧结果，创建失败时返回 null</returns>
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

    /// <summary>
    /// 排序绘图帧：按帧号升序，帧号相同时按生成先后顺序
    /// </summary>
    /// <param name="drawingFrames">绘图帧及其生成顺序的元组集合</param>
    /// <returns>排序后的绘图帧结果列表</returns>
    private static IReadOnlyList<ReviewDrawingFrameResult> OrderDrawingFrames(IEnumerable<(ReviewDrawingFrameResult Frame, int GenerationOrder)> drawingFrames)
        => drawingFrames
            .OrderBy(x => x.Frame.FrameNumber)
            .ThenBy(x => x.GenerationOrder)
            .Select(x => x.Frame)
            .ToArray();

    /// <summary>
    /// 验证绘图帧数据的合法性（帧号、状态码、对象数据）
    /// </summary>
    /// <param name="drawingFrames">绘图帧结果列表</param>
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

    /// <summary>
    /// 将标签列表序列化为 JSON 字符串
    /// </summary>
    /// <param name="tags">标签列表</param>
    /// <returns>标签 JSON 字符串</returns>
    private static string? WriteTags(IReadOnlyList<string>? tags)
        => tags == null ? null : JsonSerializer.Serialize(tags);

    /// <summary>
    /// 从 JSON 字符串反序列化标签列表
    /// </summary>
    /// <param name="tagsJson">标签 JSON 字符串</param>
    /// <returns>标签列表</returns>
    private static IReadOnlyList<string>? ReadTags(string? tagsJson)
        => string.IsNullOrWhiteSpace(tagsJson) ? null : JsonSerializer.Deserialize<string[]>(tagsJson);

    /// <summary>
    /// 规范化审核决策码（去除空白并转大写）
    /// </summary>
    /// <param name="decisionCode">决策码</param>
    /// <returns>规范化后的决策码</returns>
    private static string NormalizeReviewDecision(string? decisionCode)
        => string.IsNullOrWhiteSpace(decisionCode) ? "PENDING" : decisionCode.Trim().ToUpperInvariant();

    /// <summary>
    /// 合并更新的注解数据 JSON（保留现有的 feedbackRoundId 和 drawingFrames）
    /// </summary>
    /// <param name="existingAnnotationDataJson">现有注解数据 JSON</param>
    /// <param name="newAnnotationDataJson">新的注解数据 JSON</param>
    /// <returns>合并后的注解数据 JSON</returns>
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

    /// <summary>
    /// 内部方法：基于请求对象向审核任务添加评论
    /// </summary>
    /// <param name="reviewTaskId">审核任务 ID</param>
    /// <param name="request">创建评论请求对象</param>
    /// <param name="cancellationToken">取消令牌</param>
    /// <returns>评论结果</returns>
    private async Task<ReviewCommentResult> AddCommentInternalAsync(Guid reviewTaskId, CreateReviewCommentRequest request, CancellationToken cancellationToken)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var reviewTask = await _dbContext.ReviewTasks
            .Include(x => x.Lens)
                .ThenInclude(x => x!.Episode)
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

    /// <summary>
    /// 获取审核任务中指定镜头的镜头编码
    /// </summary>
    /// <param name="reviewTask">审核任务实体</param>
    /// <param name="taskShotId">任务镜头 ID</param>
    /// <returns>镜头编码</returns>
    private static string GetTaskShotLensCode(ReviewTask reviewTask, Guid? taskShotId)
        => reviewTask.Shots.FirstOrDefault(s => s.Id == taskShotId)?.Lens?.Code
           ?? reviewTask.Shots.OrderBy(x => x.Sequence).Select(x => x.Lens?.Code).FirstOrDefault(x => !string.IsNullOrWhiteSpace(x))
           ?? string.Empty;

    /// <summary>
    /// 刷新审核任务中指定镜头的状态（反馈计数、最新反馈时间、内部审核状态等）
    /// </summary>
    /// <param name="reviewTaskId">审核任务 ID</param>
    /// <param name="lensId">镜头 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
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

    /// <summary>
    /// 刷新指定反馈轮次的数据（计数、绘图帧等），若无反馈则删除该轮次
    /// </summary>
    /// <param name="reviewTaskId">审核任务 ID</param>
    /// <param name="lensId">镜头 ID</param>
    /// <param name="feedbackRoundId">反馈轮次 ID</param>
    /// <param name="cancellationToken">取消令牌</param>
    private async Task RefreshFeedbackRoundAsync(Guid reviewTaskId, Guid lensId, Guid feedbackRoundId, CancellationToken cancellationToken)
    {
        var round = await _dbContext.ReviewFeedbackRounds.FirstOrDefaultAsync(
            x => x.ReviewTaskId == reviewTaskId && x.LensId == lensId && x.FeedbackRoundId == feedbackRoundId,
            cancellationToken);

        if (round == null)
        {
            return;
        }

        var feedbacks = await _dbContext.ReviewComments
            .Where(x => x.ReviewTaskId == reviewTaskId && x.LensId == lensId && x.FeedbackRoundId == feedbackRoundId)
            .OrderBy(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        if (feedbacks.Count == 0)
        {
            _dbContext.ReviewFeedbackRounds.Remove(round);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return;
        }

        round.FeedbackCount = feedbacks.Count;
        round.LatestFeedbackAtUtc = feedbacks.Max(x => x.CreatedAtUtc);
        round.DrawingFramesJson = JsonSerializer.Serialize(feedbacks
            .SelectMany(x => ExtractDrawingFrames(x.AnnotationDataJson) ?? Array.Empty<ReviewDrawingFrameResult>())
            .ToArray());
        round.RowVersion += 1;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

}
