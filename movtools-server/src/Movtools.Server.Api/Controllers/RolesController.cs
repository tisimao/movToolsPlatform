using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "admin")]
public sealed class RolesController : ControllerBase
{
    private readonly IUserManagementService _userManagementService;

    public RolesController(IUserManagementService userManagementService)
    {
        _userManagementService = userManagementService;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<RoleResponse>>> GetRoles(CancellationToken cancellationToken)
    {
        var roles = await _userManagementService.GetRolesAsync(cancellationToken);
        return Ok(roles.Select(role => new RoleResponse(role.RoleId, role.Code, role.Name, role.DisplayName, role.IsSystem)).ToArray());
    }
}
