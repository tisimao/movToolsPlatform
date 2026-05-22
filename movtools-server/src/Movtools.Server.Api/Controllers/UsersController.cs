using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class UsersController : ControllerBase
{
    private readonly IUserManagementService _userManagementService;

    public UsersController(IUserManagementService userManagementService)
    {
        _userManagementService = userManagementService;
    }

    [HttpGet]
    [Authorize(Roles = "admin,producer")]
    public async Task<ActionResult<IReadOnlyList<UserResponse>>> GetUsers(CancellationToken cancellationToken)
    {
        var users = await _userManagementService.GetUsersAsync(cancellationToken);
        return Ok(users.Select(user => new UserResponse(user.UserId, user.UserName, user.DisplayName, user.IsActive, user.Roles.ToArray())).ToArray());
    }

    [HttpPost]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<UserResponse>> CreateUser([FromBody] CreateUserRequest request, CancellationToken cancellationToken)
    {
        var user = await _userManagementService.CreateUserAsync(request.UserName, request.DisplayName, request.Password, cancellationToken);
        return Ok(new UserResponse(user.UserId, user.UserName, user.DisplayName, user.IsActive, user.Roles.ToArray()));
    }

    [HttpPut("{userId:guid}")]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<UserResponse>> UpdateUser([FromRoute] Guid userId, [FromBody] UpdateUserRequest request, CancellationToken cancellationToken)
    {
        var user = await _userManagementService.UpdateUserAsync(userId, request.UserName, request.DisplayName, request.Password, request.IsActive, cancellationToken);
        return Ok(new UserResponse(user.UserId, user.UserName, user.DisplayName, user.IsActive, user.Roles.ToArray()));
    }

    [HttpPost("{userId:guid}/roles")]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult<UserResponse>> AssignRoles([FromRoute] Guid userId, [FromBody] AssignRolesRequest request, CancellationToken cancellationToken)
    {
        var user = await _userManagementService.AssignRolesAsync(userId, request.RoleCodes, cancellationToken);
        return Ok(new UserResponse(user.UserId, user.UserName, user.DisplayName, user.IsActive, user.Roles.ToArray()));
    }

    [HttpDelete("{userId:guid}")]
    [Authorize(Roles = "admin")]
    public async Task<ActionResult> DeleteUser([FromRoute] Guid userId, CancellationToken cancellationToken)
    {
        await _userManagementService.DeleteUserAsync(userId, cancellationToken);
        return NoContent();
    }
}
