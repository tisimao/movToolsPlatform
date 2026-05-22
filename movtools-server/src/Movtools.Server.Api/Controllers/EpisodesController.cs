using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Controllers;

[ApiController]
[Route("api/projects/{projectCode}/episodes")]
[Authorize]
public sealed class EpisodesController : ControllerBase
{
    private readonly IEpisodeService _episodeService;

    public EpisodesController(IEpisodeService episodeService)
    {
        _episodeService = episodeService;
    }

    [HttpPost]
    [ProducesResponseType(typeof(EpisodeResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<EpisodeResponse>> Create(string projectCode, [FromBody] EpisodeCreateRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
        {
            return BadRequest(new ApiErrorResponse("validation", "code_required", "Episode code is required.", null, null));
        }

        var result = await _episodeService.CreateAsync(projectCode, request.ToRequest(), cancellationToken);
        return CreatedAtAction(nameof(GetById), new { projectCode, id = result.Id }, result.ToResponse());
    }

    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<EpisodeResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<EpisodeResponse>>> List(string projectCode, CancellationToken cancellationToken)
    {
        var episodes = await _episodeService.GetListByProjectAsync(projectCode, cancellationToken);
        return Ok(episodes.Select(x => x.ToResponse()).ToArray());
    }

    [HttpGet("{id}")]
    [HttpGet("/api/episodes/{id}")]
    [ProducesResponseType(typeof(EpisodeResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<EpisodeResponse>> GetById(Guid id, CancellationToken cancellationToken)
    {
        var episode = await _episodeService.GetByIdAsync(id, cancellationToken);
        return Ok(episode.ToResponse());
    }

    [HttpPut("{id}")]
    [ProducesResponseType(typeof(EpisodeResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<EpisodeResponse>> Update(string projectCode, Guid id, [FromBody] EpisodeUpdateRequest request, CancellationToken cancellationToken)
    {
        var result = await _episodeService.UpdateAsync(id, request.ToRequest(), request.RowVersion, cancellationToken);
        return Ok(result.ToResponse());
    }

    [HttpPost("{id}/lenses/batch")]
    [ProducesResponseType(typeof(IReadOnlyList<LensResponse>), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<LensResponse>>> CreateLensesBatch(string projectCode, Guid id, [FromBody] LensBatchCreateRequest request, CancellationToken cancellationToken)
    {
        if (request.Lenses == null || request.Lenses.Count == 0)
        {
            return BadRequest(new ApiErrorResponse("validation", "lenses_required", "Lenses list is required.", null, null));
        }

        var lenses = await _episodeService.CreateLensesBatchAsync(projectCode, id, request.Lenses.Select(l => new Application.Interfaces.CreateLensRequest(
            l.Code, l.Name, l.Sequence, l.Description, l.RootCode, l.LogicalPath, l.VersionTag, l.LayoutTag, l.SingleFrame, l.Maker)
        {
            MakerUserId = l.MakerUserId,
            MakerNameRaw = l.MakerNameRaw,
            MakerMatchStatus = l.MakerMatchStatus
        }).ToList(), cancellationToken);

        return CreatedAtAction(nameof(GetById), new { projectCode, id }, lenses.Select(l => new LensResponse(
            l.Id, l.Code, l.Name, l.EpisodeId, l.Status, l.Sequence, l.Description, l.RootCode, 
            l.LogicalPath, l.VersionTag, l.VersionNum, l.LayoutTag, l.Comment, l.IsArchived, l.RowVersion, 
            l.CreatedAtUtc, l.UpdatedAtUtc, l.SingleFrame, l.Maker)
        {
            MakerUserId = l.MakerUserId,
            MakerNameRaw = l.MakerNameRaw,
            MakerDisplayName = l.MakerDisplayName,
            MakerMatchStatus = l.MakerMatchStatus,
            InternalReviewStatusCode = l.InternalReviewStatusCode,
            InternalReviewStatusName = l.InternalReviewStatusName,
            InternalReviewUpdatedAtUtc = l.InternalReviewUpdatedAtUtc,
            LatestReviewTaskId = l.LatestReviewTaskId,
            LatestDirectorFeedbackAtUtc = l.LatestDirectorFeedbackAtUtc,
            PendingDirectorFeedbackCount = l.PendingDirectorFeedbackCount,
            SubmissionAllowed = l.SubmissionAllowed,
            FileBindingCount = l.FileBindingCount,
            LatestFileBindingUpdatedAtUtc = l.LatestFileBindingUpdatedAtUtc
        }).ToArray());
    }
}

public static class EpisodeContractsExtensions
{
    public static CreateEpisodeRequest ToRequest(this EpisodeCreateRequest request) => new(
        request.Code, request.Name, request.Sequence, request.Description);

    public static UpdateEpisodeRequest ToRequest(this EpisodeUpdateRequest request) => new(
        request.Name, request.Sequence, request.Description);

    public static EpisodeResponse ToResponse(this EpisodeResult result) => new(
        result.Id, result.Code, result.Name, result.Sequence, result.Description, 
        result.ProjectId, result.ProjectCode, result.IsArchived, result.RowVersion, 
        result.CreatedAtUtc, result.UpdatedAtUtc,
        result.VersionTag, result.LayoutTag, result.InitExcelPath,
        result.ProjectRootPath,
        result.LensFolderRootPath,
        result.MaCheckPath,
        result.MovCheckPath,
        result.LayoutCheckPath,
        result.LensRoots.Select(root => new ProjectScanRootResponse(root.RootId, root.Label, root.AbsolutePath, root.Priority, root.IsEnabled, root.InitExcelPath, root.FileKind)).ToArray(),
        result.LayoutRoots.Select(root => new ProjectScanRootResponse(root.RootId, root.Label, root.AbsolutePath, root.Priority, root.IsEnabled, root.InitExcelPath, root.FileKind)).ToArray());
}
