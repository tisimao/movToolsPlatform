using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class AuthController : ControllerBase
{
    private readonly IAuthService _authService;

    public AuthController(IAuthService authService)
    {
        _authService = authService;
    }

    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<ActionResult<LoginResponse>> Login([FromBody] LoginRequest request, CancellationToken cancellationToken)
    {
        var result = await _authService.LoginAsync(request.UserName, request.Password, cancellationToken);
        return Ok(new LoginResponse(result.UserId, result.UserName, result.DisplayName, result.AccessToken, result.ExpiresAtUtc, result.Roles.ToArray()));
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<ActionResult<CurrentUserResponse>> Me(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userId, out var parsedUserId))
        {
            return Unauthorized();
        }

        var result = await _authService.GetCurrentUserAsync(parsedUserId, cancellationToken);
        return Ok(new CurrentUserResponse(result.UserId, result.UserName, result.DisplayName, result.Roles.ToArray()));
    }
}
