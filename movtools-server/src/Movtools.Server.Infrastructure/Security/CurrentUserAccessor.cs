using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Infrastructure.Security;

public sealed class CurrentUserAccessor : ICurrentUserAccessor
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public CurrentUserAccessor(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public Guid? UserId
    {
        get
        {
            var value = _httpContextAccessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
            return Guid.TryParse(value, out var userId) ? userId : null;
        }
    }

    public string? UserName => _httpContextAccessor.HttpContext?.User.Identity?.Name;

    public CurrentUserInfo? GetCurrentUser()
    {
        var userId = UserId;
        var userName = UserName;
        if (userId == null || userName == null)
        {
            return null;
        }

        var displayName = _httpContextAccessor.HttpContext?.User.FindFirstValue("display_name") ?? userName;
        return new CurrentUserInfo(userId.Value, userName, displayName);
    }
}
