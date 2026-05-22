using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Controllers;

[ApiController]
[Route("api/episodes/{episodeId}/lenses")]
[Authorize]
public sealed class LensesController : ControllerBase
{
    private readonly ILensService _lensService;

    public LensesController(ILensService lensService)
    {
        _lensService = lensService;
    }

    [HttpPost]
    [ProducesResponseType(typeof(LensResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<LensResponse>> Create(Guid episodeId, [FromBody] LensCreateRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
        {
            return BadRequest(new ApiErrorResponse("validation", "code_required", "Lens code is required.", null, null));
        }

        var result = await _lensService.CreateAsync(episodeId, request.ToRequest(), cancellationToken);
        return CreatedAtAction(nameof(GetById), new { episodeId, id = result.Id }, result.ToResponse());
    }

    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<LensResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<LensResponse>>> List(Guid episodeId, CancellationToken cancellationToken)
    {
        var lenses = await _lensService.GetListByEpisodeAsync(episodeId, cancellationToken);
        return Ok(lenses.Select(x => x.ToResponse()).ToArray());
    }

    [HttpGet("{id}")]
    [HttpGet("/api/lenses/{id}")]
    [ProducesResponseType(typeof(LensResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<LensResponse>> GetById(Guid id, CancellationToken cancellationToken)
    {
        var lens = await _lensService.GetByIdAsync(id, cancellationToken);
        return Ok(lens.ToResponse());
    }

    [HttpPut("{id}")]
    [HttpPut("/api/lenses/{id}")]
    [ProducesResponseType(typeof(LensResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<LensResponse>> Update(Guid id, [FromBody] LensUpdateRequest request, CancellationToken cancellationToken)
    {
        var result = await _lensService.UpdateAsync(id, request.ToRequest(), request.RowVersion, cancellationToken);
        return Ok(result.ToResponse());
    }

    [HttpPut("{id}/status")]
    [HttpPut("/api/lenses/{id}/status")]
    [ProducesResponseType(typeof(LensResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<LensResponse>> ChangeStatus(Guid id, [FromBody] LensStatusChangeRequest request, CancellationToken cancellationToken)
    {
        var result = await _lensService.ChangeStatusAsync(id, request.NewStatus, request.Comment, request.RowVersion, cancellationToken);
        return Ok(result.ToResponse());
    }

    [HttpPut("{id}/internal-review-status")]
    [HttpPut("/api/lenses/{id}/internal-review-status")]
    [ProducesResponseType(typeof(LensResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<LensResponse>> UpdateInternalReviewStatus(Guid id, [FromBody] LensInternalReviewStatusUpdateRequest request, CancellationToken cancellationToken)
    {
        var result = await _lensService.UpdateInternalReviewStatusAsync(id, new UpdateLensInternalReviewStatusRequest(
            request.TargetStatusCode,
            request.Reason,
            request.ReviewTaskId), cancellationToken);
        return Ok(result.ToResponse());
    }

    [HttpGet("{id}/history")]
    [HttpGet("/api/lenses/{id}/history")]
    [ProducesResponseType(typeof(IReadOnlyList<LensStatusHistoryResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<LensStatusHistoryResponse>>> GetHistory(Guid id, CancellationToken cancellationToken)
    {
        var histories = await _lensService.GetStatusHistoryAsync(id, cancellationToken);
        return Ok(histories.Select(x => x.ToResponse()).ToArray());
    }

    [HttpPut("{id}/history/{historyId}")]
    [HttpPut("/api/lenses/{id}/history/{historyId}")]
    [ProducesResponseType(typeof(LensStatusHistoryResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<LensStatusHistoryResponse>> UpdateHistory(Guid id, Guid historyId, [FromBody] LensStatusHistoryUpdateRequest request, CancellationToken cancellationToken)
    {
        var result = await _lensService.UpdateStatusHistoryAsync(id, historyId, new UpdateLensStatusHistoryRequest(request.Comment), cancellationToken);
        return Ok(result.ToResponse());
    }

    [HttpGet("{id}/detail")]
    [HttpGet("/api/lenses/{id}/detail")]
    [ProducesResponseType(typeof(LensDetailResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<LensDetailResponse>> GetDetail(Guid id, CancellationToken cancellationToken)
    {
        var detail = await _lensService.GetLensDetailAsync(id, cancellationToken);
        return Ok(detail.ToResponse());
    }

    [HttpPost("{id}/bindings")]
    [HttpPost("/api/lenses/{id}/bindings")]
    [ProducesResponseType(typeof(LensFileBindingResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<LensFileBindingResponse>> SyncFileBinding(Guid id, [FromBody] LensFileBindingSyncRequest request, CancellationToken cancellationToken)
    {
        var result = await _lensService.SyncLensFileBindingAsync(id, request.ToRequest(), cancellationToken);
        return Ok(result.ToResponse());
    }

    [HttpDelete("{id}/bindings")]
    [HttpDelete("/api/lenses/{id}/bindings")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult> DeleteFileBinding(Guid id, [FromQuery] string? bindingType, [FromQuery] string? versionNum, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(bindingType))
        {
            return BadRequest(new ApiErrorResponse("validation", "binding_type_required", "Binding type is required.", null, null));
        }

        await _lensService.DeleteLensFileBindingAsync(id, bindingType, versionNum, cancellationToken);
        return NoContent();
    }
}

public static class LensContractsExtensions
{
    public static CreateLensRequest ToRequest(this LensCreateRequest request) => new(
        request.Code, request.Name, request.Sequence, request.Description, 
        request.RootCode, request.LogicalPath, request.VersionTag, request.LayoutTag, request.SingleFrame, request.Maker)
    {
        MakerUserId = request.MakerUserId,
        MakerNameRaw = request.MakerNameRaw,
        MakerMatchStatus = request.MakerMatchStatus
    };

    public static UpdateLensRequest ToRequest(this LensUpdateRequest request) => new(
        request.Name, request.Description, request.RootCode, request.LogicalPath, 
        request.VersionTag, request.LayoutTag, request.Comment, request.SingleFrame, request.Maker)
    {
        RowVersion = request.RowVersion,
        MakerUserId = request.MakerUserId,
        MakerNameRaw = request.MakerNameRaw,
        MakerMatchStatus = request.MakerMatchStatus
    };

    public static LensResponse ToResponse(this LensResult result) => new(
        result.Id, result.Code, result.Name, result.EpisodeId, result.Status, result.Sequence, 
        result.Description, result.RootCode, result.LogicalPath, result.VersionTag, result.VersionNum, result.LayoutTag, 
        result.Comment, result.IsArchived, result.RowVersion, result.CreatedAtUtc, result.UpdatedAtUtc, result.SingleFrame, result.Maker)
    {
        MakerUserId = result.MakerUserId,
        MakerNameRaw = result.MakerNameRaw,
        MakerDisplayName = result.MakerDisplayName,
        MakerMatchStatus = result.MakerMatchStatus,
        InternalReviewStatusCode = result.InternalReviewStatusCode,
        InternalReviewStatusName = result.InternalReviewStatusName,
        InternalReviewUpdatedAtUtc = result.InternalReviewUpdatedAtUtc,
        LatestReviewTaskId = result.LatestReviewTaskId,
        LatestDirectorFeedbackAtUtc = result.LatestDirectorFeedbackAtUtc,
        PendingDirectorFeedbackCount = result.PendingDirectorFeedbackCount,
        SubmissionAllowed = result.SubmissionAllowed,
        FileBindingCount = result.FileBindingCount,
        LatestFileBindingUpdatedAtUtc = result.LatestFileBindingUpdatedAtUtc
    };

    public static LensStatusHistoryResponse ToResponse(this LensStatusHistoryResult result) => new(
        result.Id, result.LensId, result.FromStatus, result.ToStatus, 
        result.ChangedByUserName, result.Comment, result.CreatedAtUtc);

    public static LensStatusHistoryUpdateRequest ToRequest(this LensStatusHistoryUpdateRequest request) => request;

    public static LensDetailResponse ToResponse(this LensDetailResult result) => new(
        result.Lens.ToResponse(),
        result.Versions.Select(v => new LensVersionResponse(
            v.VersionNum,
            v.FileName,
            v.LogicalPath,
            v.Issues.Select(i => new VersionIssueResponse(i.IssueType, i.Description, i.FilePath)).ToArray(),
            v.Bindings.Select(b => new VersionBindingResponse(b.BindingType, b.FileName, b.FilePath, b.IsMatched)).ToArray()
        )).ToArray(),
        result.FileBindings.Select(b => new LensFileBindingResponse(
            b.BindingId,
            b.LensId,
            b.LensCode,
            b.BindingType,
            b.RelativePath,
            b.SourceRoot,
            b.VersionNum,
            b.FileName,
            b.BindTime
        )).ToArray(),
        result.LayoutCandidates.Select(l => new LayoutCandidateResponse(
            l.FileName,
            l.RelativePath,
            l.MatchedLensCode,
            l.MatchScore,
            l.ScannedAt
        )).ToArray(),
        result.CurrentLayout != null ? new LayoutInfoResponse(
            result.CurrentLayout.FileName,
            result.CurrentLayout.RelativePath,
            result.CurrentLayout.VideoFileName,
            result.CurrentLayout.VideoRelativePath,
            result.CurrentLayout.VideoReady,
            result.CurrentLayout.SelectedAt
        ) : null,
        result.LayoutReferenceCheck != null ? new LayoutReferenceCheckResponse(
            result.LayoutReferenceCheck.TotalReferences,
            result.LayoutReferenceCheck.ValidReferences,
            result.LayoutReferenceCheck.MissingReferences,
            result.LayoutReferenceCheck.MissingReferencePaths
        ) : null
    );

    public static LensFileBindingResponse ToResponse(this LensFileBindingResult result) => new(
        result.BindingId,
        result.LensId,
        result.LensCode,
        result.BindingType,
        result.RelativePath,
        result.SourceRoot,
        result.VersionNum,
        result.FileName,
        result.BindTime
    );

    public static SyncLensFileBindingRequest ToRequest(this LensFileBindingSyncRequest request) => new(
        request.BindingType,
        request.RelativePath,
        request.SourceRoot,
        request.VersionNum,
        request.FileName);
}
