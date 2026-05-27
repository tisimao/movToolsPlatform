using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Contracts.Reviews;
using Movtools.Server.Application.Exceptions;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace Movtools.Server.Api.Controllers;

[ApiController]
    [Route("api/review-tasks")]
[Authorize]
public sealed class ReviewsController : ControllerBase
{
    private readonly MovtoolsDbContext _dbContext;
    private readonly IReviewService _reviewService;
    private readonly IPermissionService _permissionService;
    private readonly ICurrentUserAccessor _currentUserAccessor;

    public ReviewsController(
        MovtoolsDbContext dbContext,
        IReviewService reviewService,
        IPermissionService permissionService,
        ICurrentUserAccessor currentUserAccessor)
    {
        _dbContext = dbContext;
        _reviewService = reviewService;
        _permissionService = permissionService;
        _currentUserAccessor = currentUserAccessor;
    }

    [HttpPost]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReviewTaskResponse>> SubmitForReview([FromBody] ReviewSubmitRequest request, CancellationToken cancellationToken)
    {
        if (request.LensId == Guid.Empty)
        {
            return BadRequest(new ApiErrorResponse("validation", "lens_id_required", "Lens ID is required.", null, null));
        }

        var result = await _reviewService.SubmitForReviewAsync(request.LensId, request.Comment, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = result.Id }, ToResponse(result));
    }

    [HttpPost]
    [Route("/api/reviews")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public Task<ActionResult<ReviewTaskResponse>> SubmitForReviewLegacy([FromBody] ReviewSubmitRequest request, CancellationToken cancellationToken)
        => SubmitForReview(request, cancellationToken);

    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<ReviewTaskResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ReviewTaskResponse>>> GetPendingReviews([FromQuery] string? status, CancellationToken cancellationToken)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        var isDirector = await _permissionService.IsInRoleAsync(currentUser.Id, "director", cancellationToken);
        if (!isAdmin && !isDirector)
        {
            return Forbid();
        }

        var reviews = await _reviewService.GetPendingReviewsAsync(cancellationToken);
        if (isDirector && !isAdmin)
        {
            reviews = reviews.Where(x => x.Status == ReviewStatuses.Pending
                || x.Status == ReviewStatuses.InReview
                || x.Status == ReviewStatuses.Completed).ToArray();
        }
        if (!string.IsNullOrWhiteSpace(status))
        {
            var normalizedStatus = NormalizeDirectorListStatus(status);
            reviews = reviews.Where(x => x.Status == normalizedStatus).ToArray();
        }

        return Ok(reviews.Select(ToResponse).ToArray());
    }

    [HttpGet]
    [Route("/api/reviews")]
    [ProducesResponseType(typeof(IReadOnlyList<ReviewTaskResponse>), StatusCodes.Status200OK)]
    public Task<ActionResult<IReadOnlyList<ReviewTaskResponse>>> GetPendingReviewsLegacy(CancellationToken cancellationToken)
        => GetPendingReviews(null, cancellationToken);

    [HttpGet("producer")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<object>>> GetProducerTasks([FromQuery] string? status, [FromQuery] string? projectId, CancellationToken cancellationToken)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var query = _dbContext.ReviewTasks
            .Include(x => x.CreatedByUser)
            .Include(x => x.DirectorUser)
            .Include(x => x.Shots)
                .ThenInclude(x => x.Lens)
            .AsNoTracking();

        if (!string.IsNullOrWhiteSpace(projectId))
        {
            query = query.Where(x => x.ProjectCode == projectId.Trim());
        }

        var accessibleProjectCodes = await ResolveAccessibleProjectCodesAsync(currentUser.Id, cancellationToken);
        query = query.Where(x => accessibleProjectCodes.Contains(x.ProjectCode));

        if (!string.IsNullOrWhiteSpace(status))
        {
            var normalizedStatus = NormalizeProducerFilterStatus(status);
            query = query.Where(x => x.Status == normalizedStatus);
        }

        var tasks = await query
            .OrderByDescending(x => x.UpdatedAtUtc)
            .ToListAsync(cancellationToken);

        var results = new List<object>(tasks.Count);
        foreach (var task in tasks)
        {
            var detail = await _reviewService.GetTaskDetailAsync(task.Id, cancellationToken);
            if (detail != null)
            {
                results.Add(ToProducerTaskSummary(detail));
            }
        }

        return Ok(results);
    }

    [HttpGet("{id:guid}/detail")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<object>> GetTaskDetail(Guid id, CancellationToken cancellationToken)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        var isDirector = await _permissionService.IsInRoleAsync(currentUser.Id, "director", cancellationToken);
        var isProducer = await _permissionService.IsInRoleAsync(currentUser.Id, "producer", cancellationToken);
        if (!isAdmin && !isDirector && !isProducer)
        {
            return Forbid();
        }

        var review = await _reviewService.GetTaskDetailAsync(id, cancellationToken);
        if (review == null)
        {
            return NotFound(new ApiErrorResponse("not_found", "review_not_found", "The review task could not be found.", null, null));
        }

        if (isDirector && !isAdmin && review.Status is ReviewStatuses.Draft or ReviewStatuses.Ready)
        {
            return NotFound(new ApiErrorResponse("not_found", "review_not_found", "The review task could not be found.", null, null));
        }

        return Ok(ToProducerTaskDetail(review));
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReviewTaskResponse>> GetById(Guid id, CancellationToken cancellationToken)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        var isDirector = await _permissionService.IsInRoleAsync(currentUser.Id, "director", cancellationToken);
        var isProducer = await _permissionService.IsInRoleAsync(currentUser.Id, "producer", cancellationToken);
        if (!isAdmin && !isDirector && !isProducer)
        {
            return Forbid();
        }

        var review = await _reviewService.GetByIdAsync(id, cancellationToken);
        if (review == null)
        {
            return NotFound(new ApiErrorResponse("not_found", "review_not_found", "The review task could not be found.", null, null));
        }
        if (isDirector && !isAdmin && review.Status is ReviewStatuses.Draft or ReviewStatuses.Ready)
        {
            return NotFound(new ApiErrorResponse("not_found", "review_not_found", "The review task could not be found.", null, null));
        }

        return Ok(ToResponse(review));
    }

    [HttpGet]
    [Route("/api/reviews/{id:guid}")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public Task<ActionResult<ReviewTaskResponse>> GetByIdLegacy(Guid id, CancellationToken cancellationToken)
        => GetById(id, cancellationToken);

    [HttpGet("lens/{lensId:guid}")]
    [HttpGet("/api/review-feedbacks/lens/{lensId:guid}")]
    [ProducesResponseType(typeof(ReviewFeedbackLensResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ReviewFeedbackLensResponse>> GetByLens(Guid lensId, [FromQuery] Guid? feedbackRoundId, [FromQuery] bool includeAllRounds = false, CancellationToken cancellationToken = default)
    {
        var lensFeedback = await _reviewService.GetFeedbackLensAsync(lensId, feedbackRoundId, includeAllRounds, cancellationToken);

        return Ok(new ReviewFeedbackLensResponse(
            lensId,
            lensFeedback.LatestFeedbackRoundId,
            lensFeedback.LatestFeedbackAtUtc,
            lensFeedback.Feedbacks.Select(ToFeedbackResponse).ToArray(),
            lensFeedback.DrawingFrames.Select(ToDrawingFrameResponse).ToArray(),
            lensFeedback.LatestRound is null ? null : new ReviewFeedbackRoundResponse(
                lensFeedback.LatestRound.FeedbackRoundId,
                lensFeedback.LatestRound.CreatedAtUtc,
                lensFeedback.LatestRound.FeedbackCount,
                lensFeedback.LatestRound.DrawingTimeline.Select(ToDrawingFrameResponse).ToArray()),
            includeAllRounds));
    }

    [HttpGet]
    [Route("/api/reviews/lens/{lensId:guid}")]
    [ProducesResponseType(typeof(ReviewFeedbackLensResponse), StatusCodes.Status200OK)]
    public Task<ActionResult<ReviewFeedbackLensResponse>> GetByLensLegacy(Guid lensId, [FromQuery] Guid? feedbackRoundId, [FromQuery] bool includeAllRounds = false, CancellationToken cancellationToken = default)
        => GetByLens(lensId, feedbackRoundId, includeAllRounds, cancellationToken);

    [HttpPost("{id:guid}/approve")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ReviewTaskResponse>> Approve(Guid id, [FromBody] ReviewActionRequest request, CancellationToken cancellationToken)
    {
        var result = await _reviewService.ApproveAsync(id, null, request.RowVersion, cancellationToken);
        return Ok(ToResponse(result));
    }

    [HttpPost("{id:guid}/reject")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ReviewTaskResponse>> Reject(Guid id, [FromBody] ReviewActionRequest request, CancellationToken cancellationToken)
    {
        var result = await _reviewService.RejectAsync(id, request.Comment, request.RowVersion, cancellationToken);
        return Ok(ToResponse(result));
    }

    [HttpPost("/api/reviews/{id:guid}/close")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<object>> Close(Guid id, [FromBody] JsonElement? request, CancellationToken cancellationToken)
    {
        if (!TryGetRowVersion(request, out var rowVersion) || rowVersion <= 0)
        {
            var taskResult = await _reviewService.CloseTaskAsync(id, cancellationToken);
            return Ok(ToProducerTaskSummary(taskResult));
        }

        var result = await _reviewService.CloseAsync(id, rowVersion, cancellationToken);
        return Ok(ToResponse(result));
    }

    private static bool TryGetRowVersion(JsonElement? request, out long rowVersion)
    {
        rowVersion = 0;
        if (request is not { ValueKind: JsonValueKind.Object } body)
        {
            return false;
        }

        if (body.TryGetProperty("rowVersion", out var rowVersionElement) || body.TryGetProperty("RowVersion", out rowVersionElement))
        {
            return rowVersionElement.TryGetInt64(out rowVersion);
        }

        return false;
    }

    [HttpPost("{id:guid}/comments")]
    [ProducesResponseType(typeof(ReviewCommentResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReviewCommentResponse>> AddComment(Guid id, [FromBody] ReviewCommentCreateRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Content))
        {
            return BadRequest(new ApiErrorResponse("validation", "content_required", "Content is required.", null, null));
        }

        var result = await _reviewService.AddCommentAsync(id, new CreateReviewCommentRequest(
            request.Content,
            request.TimestampSeconds,
            null,
            null,
            null,
            null,
            null,
            null), cancellationToken);
        return CreatedAtAction(nameof(GetComments), new { id }, ToCommentResponse(result));
    }

    [HttpGet("comments/lens/{lensId:guid}/feedbacks")]
    [ProducesResponseType(typeof(IReadOnlyList<ReviewCommentResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ReviewCommentResponse>>> GetFeedbacksByLens(Guid lensId, [FromQuery] Guid? feedbackRoundId, [FromQuery] bool includeAllRounds = false, CancellationToken cancellationToken = default)
    {
        var feedbacks = await _reviewService.GetFeedbacksByLensAsync(lensId, feedbackRoundId, includeAllRounds, cancellationToken);
        return Ok(feedbacks.Select(ToCommentResponse).ToArray());
    }

    [HttpGet("lens/{lensId:guid}/drawings")]
    [HttpGet("/api/review-feedbacks/lens/{lensId:guid}/drawings")]
    [ProducesResponseType(typeof(IReadOnlyList<ReviewDrawingFrameResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ReviewDrawingFrameResponse>>> GetDrawingFramesByLens(Guid lensId, [FromQuery] Guid? feedbackRoundId, [FromQuery] bool includeAllRounds = false, CancellationToken cancellationToken = default)
    {
        var drawingFrames = await _reviewService.GetDrawingFramesByLensAsync(lensId, feedbackRoundId, includeAllRounds, cancellationToken);
        return Ok(drawingFrames.Select(ToDrawingFrameResponse).ToArray());
    }

    [HttpGet("lens/{lensId:guid}/round")]
    [HttpGet("/api/review-feedbacks/lens/{lensId:guid}/round")]
    [ProducesResponseType(typeof(ReviewFeedbackLensResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ReviewFeedbackLensResponse>> GetLensFeedbackRound(Guid lensId, [FromQuery] Guid? feedbackRoundId, [FromQuery] bool includeAllRounds = false, CancellationToken cancellationToken = default)
        => await GetByLens(lensId, feedbackRoundId, includeAllRounds, cancellationToken);

    [HttpPost("feedbacks")]
    [HttpPost("/api/review-feedbacks")]
    [ProducesResponseType(typeof(ReviewCommentResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ReviewCommentResponse>> CreateFeedback([FromBody] ReviewFeedbackCreateRequest request, CancellationToken cancellationToken)
    {
        var result = await _reviewService.CreateFeedbackAsync(new CreateReviewFeedbackRequest(
            request.ReviewTaskId,
            request.LensId,
            request.VersionNum,
            request.FrameNumber,
            request.Timecode,
            request.CommentText,
            request.Tags,
            request.DecisionCode,
            request.FrameImagePath,
            request.AnnotatedImagePath,
            request.ThumbnailPath,
            request.AnnotationDataJson,
            request.TaskShotId,
            request.FeedbackRoundId,
            request.DrawingFrames?.Select(x => new CreateReviewDrawingFrameRequest(
                x.FrameNumber,
                x.TimestampSeconds,
                x.Timecode,
                x.DrawingStateCode,
                x.DrawingObjectsJson)).ToArray()), cancellationToken);

        return CreatedAtAction(nameof(GetFeedbacksByLens), new { lensId = request.LensId }, ToCommentResponse(result));
    }

    [HttpPost]
    [Route("/api/reviews/feedbacks")]
    [ProducesResponseType(typeof(ReviewCommentResponse), StatusCodes.Status201Created)]
    public Task<ActionResult<ReviewCommentResponse>> CreateFeedbackLegacy([FromBody] ReviewFeedbackCreateRequest request, CancellationToken cancellationToken)
        => CreateFeedback(request, cancellationToken);

    [HttpGet("feedbacks/{feedbackId:guid}")]
    [HttpGet("/api/review-feedbacks/{feedbackId:guid}")]
    [ProducesResponseType(typeof(ReviewFeedbackResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReviewFeedbackResponse>> GetFeedbackById(Guid feedbackId, CancellationToken cancellationToken)
    {
        var feedback = await _reviewService.GetFeedbackByIdAsync(feedbackId, cancellationToken);
        if (feedback == null)
        {
            return NotFound(new ApiErrorResponse("not_found", "feedback_not_found", "The feedback could not be found.", null, null));
        }

        return Ok(ToFeedbackResponse(feedback));
    }

    [HttpGet]
    [Route("/api/reviews/feedbacks/{feedbackId:guid}")]
    [ProducesResponseType(typeof(ReviewFeedbackResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public Task<ActionResult<ReviewFeedbackResponse>> GetFeedbackByIdLegacy(Guid feedbackId, CancellationToken cancellationToken)
        => GetFeedbackById(feedbackId, cancellationToken);

    [HttpGet("lens/{lensId:guid}/feedbacks")]
    [HttpGet("/api/reviews/lens/{lensId:guid}/feedbacks")]
    [ProducesResponseType(typeof(ReviewFeedbackLensResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ReviewFeedbackLensResponse>> GetFeedbacksByLensLegacy(Guid lensId, [FromQuery] Guid? feedbackRoundId, [FromQuery] bool includeAllRounds = false, CancellationToken cancellationToken = default)
        => await GetByLens(lensId, feedbackRoundId, includeAllRounds, cancellationToken);

    [HttpPut("feedbacks/{feedbackId:guid}")]
    [HttpPut("/api/review-feedbacks/{feedbackId:guid}")]
    [ProducesResponseType(typeof(ReviewCommentResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ReviewCommentResponse>> UpdateFeedback(Guid feedbackId, [FromBody] ReviewFeedbackUpdateRequest request, CancellationToken cancellationToken)
    {
        var result = await _reviewService.UpdateFeedbackAsync(feedbackId, new UpdateReviewFeedbackRequest(
            request.CommentText,
            request.Tags,
            request.DecisionCode,
            request.AnnotatedImagePath,
            request.ThumbnailPath,
            request.AnnotationDataJson,
            request.DrawingFrames?.Select(x => new CreateReviewDrawingFrameRequest(
                x.FrameNumber,
                x.TimestampSeconds,
                x.Timecode,
                x.DrawingStateCode,
                x.DrawingObjectsJson)).ToArray(),
            request.TaskShotId), cancellationToken);

        return Ok(ToCommentResponse(result));
    }

    [HttpPut]
    [Route("/api/reviews/feedbacks/{feedbackId:guid}")]
    [ProducesResponseType(typeof(ReviewFeedbackResponse), StatusCodes.Status200OK)]
    public Task<ActionResult<ReviewCommentResponse>> UpdateFeedbackLegacy(Guid feedbackId, [FromBody] ReviewFeedbackUpdateRequest request, CancellationToken cancellationToken)
        => UpdateFeedback(feedbackId, request, cancellationToken);

    [HttpDelete("feedbacks/{feedbackId:guid}")]
    [HttpDelete("/api/review-feedbacks/{feedbackId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DeleteFeedback(Guid feedbackId, CancellationToken cancellationToken)
    {
        await _reviewService.DeleteFeedbackAsync(feedbackId, cancellationToken);
        return NoContent();
    }

    [HttpDelete]
    [Route("/api/reviews/feedbacks/{feedbackId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public Task<IActionResult> DeleteFeedbackLegacy(Guid feedbackId, CancellationToken cancellationToken)
        => DeleteFeedback(feedbackId, cancellationToken);

    [HttpPost("tasks")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<ReviewTaskResponse>> CreateTask([FromBody] ReviewTaskCreateRequest request, CancellationToken cancellationToken)
    {
        var result = await _reviewService.CreateTaskAsync(new CreateReviewTaskRequest(
            request.ProjectCode,
            request.EpisodeId,
            request.Name,
            request.Description,
            request.DirectorUserId,
            request.DueAtUtc,
            request.Shots.Select(s => new CreateReviewTaskShotRequest(s.LensId, s.Sequence, s.SubmitVersionNum, s.ParticipationMode)).ToArray()), cancellationToken);

        return CreatedAtAction(nameof(GetById), new { id = result.Id }, ToResponse(result));
    }

    [HttpPost]
    [Route("/api/reviews/tasks")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status201Created)]
    public Task<ActionResult<ReviewTaskResponse>> CreateTaskLegacy([FromBody] ReviewTaskCreateRequest request, CancellationToken cancellationToken)
        => CreateTask(request, cancellationToken);

    [HttpPost("draft")]
    [ProducesResponseType(StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<object>> CreateDraftTask([FromBody] ProducerReviewTaskCreateRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.ProjectId))
        {
            return BadRequest(new ApiErrorResponse("validation", "project_id_required", "Project ID is required.", null, null));
        }

        var shotRequests = request.Shots is { Count: > 0 }
            ? request.Shots.Select(s => new CreateReviewTaskShotRequest(s.LensId, s.Sequence, s.SubmitVersionNum, s.ParticipationMode)).ToArray()
            : await BuildShotRequestsAsync(request.ShotIds, cancellationToken);
        var taskName = string.IsNullOrWhiteSpace(request.TaskName)
            ? BuildDefaultTaskName(request.ProjectId, request.EpisodeId, shotRequests.Count)
            : request.TaskName.Trim();

        var result = await _reviewService.CreateTaskAsync(new CreateReviewTaskRequest(
            request.ProjectId.Trim(),
            request.EpisodeId,
            taskName,
            request.Description,
            request.DirectorId,
            request.DeadlineUtc,
            shotRequests), cancellationToken);

        var detail = await _reviewService.GetTaskDetailAsync(result.Id, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");
        return CreatedAtAction(nameof(GetTaskDetail), new { id = result.Id }, ToProducerTaskSummary(detail));
    }

    [HttpPut("tasks/{id:guid}")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ReviewTaskResponse>> UpdateTask(Guid id, [FromBody] ReviewTaskUpdateRequest request, CancellationToken cancellationToken)
    {
        var result = await _reviewService.UpdateTaskAsync(id, new UpdateReviewTaskRequest(
            request.Name,
            request.Description,
            request.DirectorUserId,
            request.DueAtUtc,
            request.Shots?.Select(s => new CreateReviewTaskShotRequest(s.LensId, s.Sequence, s.SubmitVersionNum, s.ParticipationMode)).ToArray()), cancellationToken);

        return Ok(ToResponse(result));
    }

    [HttpPut]
    [Route("/api/reviews/tasks/{id:guid}")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    public Task<ActionResult<ReviewTaskResponse>> UpdateTaskLegacy(Guid id, [FromBody] ReviewTaskUpdateRequest request, CancellationToken cancellationToken)
        => UpdateTask(id, request, cancellationToken);

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<object>> UpdateProducerTask(Guid id, [FromBody] ProducerReviewTaskUpdateRequest request, CancellationToken cancellationToken)
    {
        var existing = await _reviewService.GetTaskDetailAsync(id, cancellationToken);
        if (existing == null)
        {
            return NotFound(new ApiErrorResponse("not_found", "review_not_found", "The review task could not be found.", null, null));
        }

        var taskName = string.IsNullOrWhiteSpace(request.TaskName) ? existing.Name : request.TaskName.Trim();
        var result = await _reviewService.UpdateTaskAsync(id, new UpdateReviewTaskRequest(
            taskName,
            request.Description,
            request.DirectorId,
            request.DeadlineUtc,
            request.Shots?.Select(s => new CreateReviewTaskShotRequest(s.LensId, s.Sequence, s.SubmitVersionNum, s.ParticipationMode)).ToArray()), cancellationToken);

        return Ok(ToProducerTaskSummary(result));
    }

    [HttpPost("tasks/{id:guid}/submit")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ReviewTaskResponse>> SubmitTask(Guid id, CancellationToken cancellationToken)
    {
        var result = await _reviewService.SubmitTaskAsync(id, cancellationToken);
        return Ok(ToResponse(result));
    }

    [HttpPost("{id:guid}/submit")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<object>> SubmitProducerTask(Guid id, CancellationToken cancellationToken)
    {
        var result = await _reviewService.SubmitTaskAsync(id, cancellationToken);
        return Ok(ToProducerTaskSummary(result));
    }

    [HttpPost("tasks/{id:guid}/start")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ReviewTaskResponse>> StartTask(Guid id, CancellationToken cancellationToken)
    {
        var result = await _reviewService.StartTaskAsync(id, cancellationToken);
        return Ok(ToResponse(result));
    }

    [HttpPost("{id:guid}/start")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<object>> StartProducerTask(Guid id, CancellationToken cancellationToken)
    {
        var result = await _reviewService.StartTaskAsync(id, cancellationToken);
        return Ok(ToProducerTaskSummary(result));
    }

    [HttpPost("tasks/{id:guid}/complete")]
    [HttpPost("{id:guid}/complete")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ReviewTaskResponse>> CompleteTask(Guid id, CancellationToken cancellationToken)
    {
        var result = await _reviewService.CompleteTaskAsync(id, cancellationToken);
        return Ok(ToResponse(result));
    }

    [HttpPost]
    [Route("/api/reviews/tasks/{id:guid}/submit")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    public Task<ActionResult<ReviewTaskResponse>> SubmitTaskLegacy(Guid id, CancellationToken cancellationToken)
        => SubmitTask(id, cancellationToken);

    [HttpPost("tasks/{id:guid}/close")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ReviewTaskResponse>> CloseTask(Guid id, CancellationToken cancellationToken)
    {
        var result = await _reviewService.CloseTaskAsync(id, cancellationToken);
        return Ok(ToResponse(result));
    }

    [HttpPost]
    [Route("/api/reviews/tasks/{id:guid}/close")]
    [ProducesResponseType(typeof(ReviewTaskResponse), StatusCodes.Status200OK)]
    public Task<ActionResult<ReviewTaskResponse>> CloseTaskLegacy(Guid id, CancellationToken cancellationToken)
        => CloseTask(id, cancellationToken);

    [HttpPost("tasks/{id:guid}/shots")]
    [ProducesResponseType(typeof(IReadOnlyList<ReviewTaskShotResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ReviewTaskShotResponse>>> AddTaskShots(Guid id, [FromBody] IReadOnlyList<ReviewTaskShotCreateRequest> request, CancellationToken cancellationToken)
    {
        var result = await _reviewService.AddTaskShotsAsync(id, request.Select(s => new CreateReviewTaskShotRequest(s.LensId, s.Sequence, s.SubmitVersionNum, s.ParticipationMode)).ToArray(), cancellationToken);
        return Ok(result.Select(ToShotResponse).ToArray());
    }

    [HttpPost("{id:guid}/shots")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<object>> AddProducerTaskShots(Guid id, [FromBody] ProducerReviewTaskShotIdsRequest request, CancellationToken cancellationToken)
    {
        var shotRequests = await BuildShotRequestsAsync(request.ShotIds, cancellationToken, id);
        await _reviewService.AddTaskShotsAsync(id, shotRequests, cancellationToken);
        var detail = await _reviewService.GetTaskDetailAsync(id, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");
        return Ok(ToProducerTaskSummary(detail));
    }

    [HttpDelete("tasks/{id:guid}/shots")]
    [ProducesResponseType(typeof(IReadOnlyList<ReviewTaskShotResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ReviewTaskShotResponse>>> RemoveTaskShots(Guid id, [FromBody] IReadOnlyList<Guid> taskShotIds, CancellationToken cancellationToken)
    {
        var result = await _reviewService.RemoveTaskShotsAsync(id, taskShotIds, cancellationToken);
        return Ok(result.Select(ToShotResponse).ToArray());
    }

    [HttpDelete("{id:guid}/shots/{taskShotId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> RemoveProducerTaskShot(Guid id, Guid taskShotId, CancellationToken cancellationToken)
    {
        await _reviewService.RemoveTaskShotsAsync(id, [taskShotId], cancellationToken);
        return NoContent();
    }

    [HttpPost]
    [Route("/api/reviews/tasks/{id:guid}/shots")]
    [ProducesResponseType(typeof(IReadOnlyList<ReviewTaskShotResponse>), StatusCodes.Status200OK)]
    public Task<ActionResult<IReadOnlyList<ReviewTaskShotResponse>>> AddTaskShotsLegacy(Guid id, [FromBody] IReadOnlyList<ReviewTaskShotCreateRequest> request, CancellationToken cancellationToken)
        => AddTaskShots(id, request, cancellationToken);

    [HttpPut("tasks/{id:guid}/shots/reorder")]
    [ProducesResponseType(typeof(IReadOnlyList<ReviewTaskShotResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ReviewTaskShotResponse>>> ReorderTaskShots(Guid id, [FromBody] IReadOnlyList<Guid> orderedTaskShotIds, CancellationToken cancellationToken)
    {
        var result = await _reviewService.ReorderTaskShotsAsync(id, orderedTaskShotIds, cancellationToken);
        return Ok(result.Select(ToShotResponse).ToArray());
    }

    [HttpPut("{id:guid}/shots/reorder")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<object>> ReorderProducerTaskShots(Guid id, [FromBody] ProducerReviewTaskReorderRequest request, CancellationToken cancellationToken)
    {
        await _reviewService.ReorderTaskShotsAsync(id, request.ShotIds, cancellationToken);
        var detail = await _reviewService.GetTaskDetailAsync(id, cancellationToken)
            ?? throw new NotFoundAppException("review_not_found", "The review task could not be found.");
        return Ok(ToProducerTaskSummary(detail));
    }

    [HttpPut]
    [Route("/api/reviews/tasks/{id:guid}/shots/reorder")]
    [ProducesResponseType(typeof(IReadOnlyList<ReviewTaskShotResponse>), StatusCodes.Status200OK)]
    public Task<ActionResult<IReadOnlyList<ReviewTaskShotResponse>>> ReorderTaskShotsLegacy(Guid id, [FromBody] IReadOnlyList<Guid> orderedTaskShotIds, CancellationToken cancellationToken)
        => ReorderTaskShots(id, orderedTaskShotIds, cancellationToken);

    [HttpGet("{id:guid}/comments")]
    [ProducesResponseType(typeof(IReadOnlyList<ReviewCommentResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ReviewCommentResponse>>> GetComments(Guid id, CancellationToken cancellationToken)
    {
        var comments = await _reviewService.GetCommentsAsync(id, cancellationToken);
        return Ok(comments.Select(ToCommentResponse).ToArray());
    }

    private static ReviewTaskResponse ToResponse(Movtools.Server.Application.Contracts.Reviews.ReviewTaskResult result) => new(
        result.Id,
        result.ProjectCode,
        result.EpisodeId,
        result.EpisodeCode,
        result.Name,
        result.Description,
        result.DirectorUserId,
        result.DirectorDisplayName,
        result.LensId,
        result.LensCode,
        result.LensName,
        result.Status,
        result.ResultComment,
        result.AssignedToUserId,
        result.AssignedToUserName,
        result.SubmittedAtUtc,
        result.CompletedAtUtc,
        result.DueAtUtc,
        result.CreatedByUserId,
        result.CreatedByUserName,
        result.RowVersion,
        result.CreatedAtUtc,
        result.UpdatedAtUtc,
        result.CommentCount)
    {
        Shots = result.Shots.Select(ToShotResponse).ToArray(),
        Summary = ToSummaryResponse(result.Summary)
    };

    private static ReviewCommentResponse ToCommentResponse(Movtools.Server.Application.Contracts.Reviews.ReviewCommentResult result) => new(
        result.Id,
        result.ReviewTaskId,
        result.CreatedByUserId,
        result.CreatedByUserName,
        result.Content,
        result.DecisionCode,
        result.FrameNumber,
        result.TimestampSeconds,
        result.Timecode,
        result.Tags,
        result.FrameImagePath,
        result.AnnotatedImagePath,
        result.ThumbnailPath,
        result.AnnotationDataJson,
        result.CreatedAtUtc,
        result.TaskShotId,
        result.FeedbackRoundId,
        result.DrawingFrames?.Select(ToDrawingFrameResponse).ToArray());

    private static ReviewFeedbackResponse ToFeedbackResponse(Movtools.Server.Application.Contracts.Reviews.ReviewCommentResult result) => new(
        result.Id,
        result.ReviewTaskId,
        result.LensId ?? Guid.Empty,
        result.LensCode ?? string.Empty,
        result.VersionNum,
        result.CreatedByUserId,
        result.CreatedByUserName,
        result.Content,
        result.DecisionCode,
        result.FrameNumber,
        result.TimestampSeconds,
        result.Timecode,
        result.Tags,
        result.FrameImagePath,
        result.AnnotatedImagePath,
        result.ThumbnailPath,
        result.AnnotationDataJson,
        result.CreatedAtUtc,
        result.TaskShotId,
        result.FeedbackRoundId,
        result.DrawingFrames?.Select(ToDrawingFrameResponse).ToArray());

    private static ReviewDrawingFrameResponse ToDrawingFrameResponse(Movtools.Server.Application.Contracts.Reviews.ReviewDrawingFrameResult result) => new(
        result.FrameNumber,
        result.TimestampSeconds,
        result.Timecode,
        result.DrawingStateCode,
        result.DrawingObjectsJson);

    private static ReviewTaskShotResponse ToShotResponse(ReviewTaskShotResult result) => new(
        result.Id,
        result.ReviewTaskId,
        result.LensId,
        result.LensCode,
        result.Sequence,
        result.ParticipationMode,
        result.SubmitVersionNum,
        result.PlayVersionNum,
        result.Status,
        result.FeedbackCount,
        result.LastFeedbackAtUtc,
        result.LensInternalReviewStatusCode,
        result.LensInternalReviewUpdatedAtUtc,
        result.LatestFeedbackId);

    private static ReviewTaskSummaryResponse? ToSummaryResponse(Movtools.Server.Application.Contracts.Reviews.ReviewTaskSummaryResult? result)
        => result is null ? null : new ReviewTaskSummaryResponse(
            result.ShotCount,
            result.FeedbackCount,
            result.InternalApprovedCount,
            result.PendingFeedbackCount,
            result.SubmitterDisplayName,
            result.DirectorDisplayName,
            result.DueAtUtc,
            result.LatestUpdatedAtUtc,
            result.LatestFeedbackAtUtc);

    private static string NormalizeDirectorListStatus(string status)
        => status.Trim().ToLowerInvariant() switch
        {
            "approved" => ReviewStatuses.Completed,
            "rejected" => ReviewStatuses.Closed,
            _ => status.Trim().ToLowerInvariant()
        };

    private static string NormalizeProducerFilterStatus(string status)
        => status.Trim().ToLowerInvariant() switch
        {
            "pending-submit" => ReviewStatuses.Ready,
            _ => status.Trim().ToLowerInvariant()
        };

    private static string GetProducerStatus(string status)
        => status switch
        {
            ReviewStatuses.Ready => "pending-submit",
            _ => status
        };

    private static object ToProducerTaskSummary(ReviewTaskResult result)
    {
        var primaryShot = result.Shots.OrderBy(x => x.Sequence).FirstOrDefault();
        var producerStatus = GetProducerStatus(result.Status);
        return new
        {
            taskId = result.Id,
            taskName = result.Name,
            projectId = result.ProjectCode,
            projectName = result.ProjectCode,
            episodeId = result.EpisodeId,
            episodeCode = result.EpisodeCode,
            directorId = result.DirectorUserId,
            directorName = result.DirectorDisplayName,
            submitterId = result.CreatedByUserId,
            submitterName = result.CreatedByUserName,
            status = result.Status,
            producerStatus,
            shotCount = result.Summary.ShotCount,
            feedbackCount = result.Summary.FeedbackCount,
            feedbackShotCount = result.Summary.PendingFeedbackCount,
            approvedShotCount = result.Summary.InternalApprovedCount,
            deadlineUtc = result.DueAtUtc,
            submitTime = result.SubmittedAtUtc,
            updatedAtUtc = result.UpdatedAtUtc,
            createdAtUtc = result.CreatedAtUtc,
            latestFeedbackAtUtc = result.Summary.LatestFeedbackAtUtc,
            description = result.Description,
            lensId = primaryShot?.LensId ?? result.LensId,
            lensCode = primaryShot?.LensCode ?? result.LensCode,
            versionNum = primaryShot?.SubmitVersionNum ?? primaryShot?.PlayVersionNum
        };
    }

    private static object ToProducerTaskDetail(ReviewTaskResult result)
    {
        var producerStatus = GetProducerStatus(result.Status);
        return new
        {
            taskId = result.Id,
            taskName = result.Name,
            projectId = result.ProjectCode,
            projectName = result.ProjectCode,
            episodeId = result.EpisodeId,
            episodeCode = result.EpisodeCode,
            directorId = result.DirectorUserId,
            directorName = result.DirectorDisplayName,
            submitterId = result.CreatedByUserId,
            submitterName = result.CreatedByUserName,
            status = result.Status,
            producerStatus,
            description = result.Description,
            deadlineUtc = result.DueAtUtc,
            submitTime = result.SubmittedAtUtc,
            startTime = result.SubmittedAtUtc,
            completeTime = result.CompletedAtUtc,
            closeTime = result.Status == ReviewStatuses.Closed ? result.CompletedAtUtc : null,
            shots = result.Shots.OrderBy(x => x.Sequence).Select(ToProducerTaskShot).ToArray(),
            totalShots = result.Summary.ShotCount,
            feedbackCount = result.Summary.FeedbackCount,
            feedbackShotCount = result.Summary.PendingFeedbackCount,
            approvedShotCount = result.Summary.InternalApprovedCount,
            latestFeedbackAtUtc = result.Summary.LatestFeedbackAtUtc,
            updatedAtUtc = result.UpdatedAtUtc,
            createdAtUtc = result.CreatedAtUtc
        };
    }

    private static object ToProducerTaskShot(ReviewTaskShotResult shot)
        => new
        {
            taskShotId = shot.Id,
            taskId = shot.ReviewTaskId,
            shotId = shot.LensId,
            lensCode = shot.LensCode,
            sortOrder = shot.Sequence,
            reviewParticipationMode = shot.ParticipationMode,
            participationMode = shot.ParticipationMode,
            submitVersionNum = shot.SubmitVersionNum,
            actualVersionNum = shot.PlayVersionNum,
            feedbackCount = shot.FeedbackCount,
            status = MapTaskShotStatus(shot),
            internalReviewStatusCode = shot.LensInternalReviewStatusCode,
            internalReviewStatusName = shot.LensInternalReviewStatusCode,
            lastFeedbackAtUtc = shot.LastFeedbackAtUtc,
            latestFeedbackId = shot.LatestFeedbackId,
            hasPlayableMedia = !string.IsNullOrWhiteSpace(shot.PlayVersionNum) || !string.IsNullOrWhiteSpace(shot.SubmitVersionNum)
        };

    private static string MapTaskShotStatus(ReviewTaskShotResult shot)
        => !string.Equals(shot.ParticipationMode, ReviewTaskShotParticipationModes.Review, StringComparison.OrdinalIgnoreCase)
            ? "context"
            : shot.Status switch
        {
            ReviewTaskShotStatuses.Done when string.Equals(shot.LensInternalReviewStatusCode, LensInternalReviewStatuses.DirectorApproved, StringComparison.OrdinalIgnoreCase) => "approved",
            ReviewTaskShotStatuses.Done => "approved",
            ReviewTaskShotStatuses.Commented => "changes-required",
            _ when shot.FeedbackCount > 0 => "has-feedback",
            _ => "pending"
        };

    private async Task<IReadOnlyList<CreateReviewTaskShotRequest>> BuildShotRequestsAsync(IReadOnlyList<Guid>? shotIds, CancellationToken cancellationToken, Guid? taskId = null)
    {
        if (shotIds == null || shotIds.Count == 0)
        {
            return Array.Empty<CreateReviewTaskShotRequest>();
        }

        var normalizedShotIds = shotIds.Where(x => x != Guid.Empty).Distinct().ToArray();
        if (normalizedShotIds.Length == 0)
        {
            return Array.Empty<CreateReviewTaskShotRequest>();
        }

        var lenses = await _dbContext.Lenses
            .Where(x => normalizedShotIds.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, cancellationToken);

        if (lenses.Count != normalizedShotIds.Length)
        {
            throw new NotFoundAppException("lens_not_found", "One or more lenses could not be found.");
        }

        var nextSequence = 1;
        if (taskId.HasValue)
        {
            nextSequence = await _dbContext.ReviewTaskShots
                .Where(x => x.ReviewTaskId == taskId.Value)
                .Select(x => (int?)x.Sequence)
                .MaxAsync(cancellationToken) ?? 0;
            nextSequence += 1;
        }

        return normalizedShotIds
            .Select((shotId, index) => new CreateReviewTaskShotRequest(
                shotId,
                taskId.HasValue ? nextSequence + index : index + 1,
                lenses[shotId].VersionNum,
                ReviewTaskShotParticipationModes.Review))
            .ToArray();
    }

    private async Task<HashSet<string>> ResolveAccessibleProjectCodesAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (await _permissionService.IsAdminAsync(userId, cancellationToken))
        {
            return await _dbContext.Projects.Select(x => x.Code).ToHashSetAsync(cancellationToken);
        }

        return await _dbContext.ProjectMembers
            .Where(x => x.UserId == userId && x.IsActive)
            .Select(x => x.ProjectCode)
            .ToHashSetAsync(cancellationToken);
    }

    private static string BuildDefaultTaskName(string projectId, Guid? episodeId, int shotCount)
        => $"{projectId.Trim()} {(episodeId.HasValue ? episodeId.Value.ToString()[..8] : "TASK")} 审片任务（{Math.Max(shotCount, 0)}镜头）";
}
