using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class ProjectsController : ControllerBase
{
    private readonly IProjectService _projectService;

    public ProjectsController(IProjectService projectService)
    {
        _projectService = projectService;
    }

    [HttpPost]
    [ProducesResponseType(typeof(ProjectCreateResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ProjectCreateResponse>> Create([FromBody] ProjectCreateRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
        {
            return BadRequest(new ApiErrorResponse("validation", "code_required", "Project code is required.", null, null));
        }

        var hasInitialEpisodeCode = !string.IsNullOrWhiteSpace(request.InitialEpisodeCode);
        var hasInitialEpisodeName = !string.IsNullOrWhiteSpace(request.InitialEpisodeName);
        if (hasInitialEpisodeCode != hasInitialEpisodeName)
        {
            return BadRequest(new ApiErrorResponse("validation", "initial_episode_incomplete", "Initial episode code and name must be provided together.", null, null));
        }

        var result = await _projectService.CreateAsync(request.ToRequest(), cancellationToken);
        return CreatedAtAction(nameof(GetByCode), new { code = result.Project.Code }, result.ToResponse());
    }

    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<ProjectResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ProjectResponse>>> List(CancellationToken cancellationToken)
    {
        var projects = await _projectService.GetListAsync(cancellationToken);
        return Ok(projects.Select(x => x.ToResponse()).ToArray());
    }

    [HttpGet("{code}")]
    [ProducesResponseType(typeof(ProjectResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProjectResponse>> GetByCode(string code, CancellationToken cancellationToken)
    {
        var project = await _projectService.GetByCodeAsync(code, cancellationToken);
        return Ok(project.ToResponse());
    }

    [HttpPut("{code}")]
    [ProducesResponseType(typeof(ProjectResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ProjectResponse>> Update(string code, [FromBody] ProjectUpdateRequest request, CancellationToken cancellationToken)
    {
        var result = await _projectService.UpdateAsync(code, request.ToRequest(), request.RowVersion, cancellationToken);
        return Ok(result.ToResponse());
    }

    [HttpDelete("{code}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult> Delete(string code, CancellationToken cancellationToken)
    {
        await _projectService.DeleteAsync(code, cancellationToken);
        return NoContent();
    }
}

public static class ProjectContractsExtensions
{
    public static CreateProjectRequest ToRequest(this ProjectCreateRequest request) => new(
        request.Code,
        request.Name,
        request.Description,
        request.VersionTag,
        request.LayoutTag,
        request.InitialEpisodeCode,
        request.InitialEpisodeName,
        request.InitExcelPath,
        request.LensRoots?.Select(root => new Movtools.Server.Application.Interfaces.ProjectScanRootRequest(
            root.RootId,
            root.Label,
            root.AbsolutePath,
            root.Priority,
            root.IsEnabled,
            root.InitExcelPath,
            root.FileKind)).ToArray(),
        request.LayoutRoots?.Select(root => new Movtools.Server.Application.Interfaces.ProjectScanRootRequest(
            root.RootId,
            root.Label,
            root.AbsolutePath,
            root.Priority,
            root.IsEnabled,
            root.InitExcelPath,
            root.FileKind)).ToArray(),
        request.Members?.Select(member => new ProjectMemberRequest(member.UserId, member.ProjectRoleCode)).ToArray(),
        request.ProjectRootPath,
        request.LensFolderRootPath,
        request.MaCheckPath,
        request.MovCheckPath,
        request.LayoutCheckPath);

    public static UpdateProjectRequest ToRequest(this ProjectUpdateRequest request) => new(
        request.Name,
        request.Description,
        request.VersionTag,
        request.LayoutTag,
        request.ProjectRootPath,
        request.LensFolderRootPath,
        request.MaCheckPath,
        request.MovCheckPath,
        request.LayoutCheckPath);

    public static ProjectResponse ToResponse(this ProjectResult result) => new(
        result.Code, result.Name, result.Description, result.VersionTag, result.LayoutTag,
        result.InitExcelPath,
        result.ProjectRootPath,
        result.LensFolderRootPath,
        result.MaCheckPath,
        result.MovCheckPath,
        result.LayoutCheckPath,
        result.LensRoots.Select(root => new ProjectScanRootResponse(root.RootId, root.Label, root.AbsolutePath, root.Priority, root.IsEnabled, root.InitExcelPath, root.FileKind)).ToArray(),
        result.LayoutRoots.Select(root => new ProjectScanRootResponse(root.RootId, root.Label, root.AbsolutePath, root.Priority, root.IsEnabled, root.InitExcelPath, root.FileKind)).ToArray(),
        result.IsArchived, result.RowVersion, result.CreatedAtUtc, result.UpdatedAtUtc);

    public static ProjectCreateResponse ToResponse(this ProjectCreationResult result) => new(
        result.Project.ToResponse(),
        result.InitialEpisode?.ToResponse(),
        result.InitResult);
}
