using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Controllers;

[ApiController]
[Route("api/project-members")]
[Authorize]
public sealed class ProjectMembersController : ControllerBase
{
    private readonly IProjectMemberService _projectMemberService;

    public ProjectMembersController(IProjectMemberService projectMemberService)
    {
        _projectMemberService = projectMemberService;
    }

    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<ProjectMemberResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<IReadOnlyList<ProjectMemberResponse>>> GetMembers([FromQuery] string projectCode, CancellationToken cancellationToken)
    {
        var members = await _projectMemberService.GetMembersAsync(projectCode, cancellationToken);
        return Ok(members.Select(member => new ProjectMemberResponse(member.ProjectMemberId, member.ProjectCode, member.UserId, member.UserName, member.DisplayName, member.ProjectRoleCode, member.IsActive)).ToArray());
    }

    [HttpPost]
    [ProducesResponseType(typeof(ProjectMemberResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProjectMemberResponse>> AddMember([FromBody] CreateProjectMemberRequest request, CancellationToken cancellationToken)
    {
        var member = await _projectMemberService.AddMemberAsync(request.ProjectCode, request.UserId, request.ProjectRoleCode, cancellationToken);
        return CreatedAtAction(nameof(GetMembers), new { projectCode = request.ProjectCode }, new ProjectMemberResponse(member.ProjectMemberId, member.ProjectCode, member.UserId, member.UserName, member.DisplayName, member.ProjectRoleCode, member.IsActive));
    }

    [HttpDelete("{projectCode}/members/{userId}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult> RemoveMember(string projectCode, Guid userId, CancellationToken cancellationToken)
    {
        await _projectMemberService.RemoveMemberAsync(projectCode, userId, cancellationToken);
        return NoContent();
    }
}
