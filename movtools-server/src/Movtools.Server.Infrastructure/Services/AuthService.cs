using Microsoft.EntityFrameworkCore;
using Movtools.Server.Application.Contracts.Auth;
using Movtools.Server.Application.Exceptions;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;

namespace Movtools.Server.Infrastructure.Services;

/// <summary>
/// 认证服务实现
/// </summary>
public sealed class AuthService : IAuthService
{
    private readonly MovtoolsDbContext _dbContext;
    private readonly IPasswordHashService _passwordHashService;
    private readonly ITokenService _tokenService;

    public AuthService(MovtoolsDbContext dbContext, IPasswordHashService passwordHashService, ITokenService tokenService)
    {
        _dbContext = dbContext;
        _passwordHashService = passwordHashService;
        _tokenService = tokenService;
    }

    /// <inheritdoc/>
    public async Task<LoginResult> LoginAsync(string userName, string password, CancellationToken cancellationToken = default)
    {
        var normalized = Normalize(userName);
        var user = await _dbContext.Users
            .Include(x => x.UserRoles).ThenInclude(x => x.Role)
            .FirstOrDefaultAsync(x => x.NormalizedUserName == normalized, cancellationToken)
            ?? throw new UnauthorizedAppException("invalid_credentials", "Invalid username or password.");

        if (!user.IsActive || !_passwordHashService.Verify(user.PasswordHash, password))
        {
            throw new UnauthorizedAppException("invalid_credentials", "Invalid username or password.");
        }

        var roles = user.UserRoles.Select(x => x.Role.Code).OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToArray();
        var (token, expiresAtUtc) = _tokenService.CreateAccessToken(user, roles);

        return new LoginResult(user.Id, user.UserName, user.DisplayName, token, expiresAtUtc, roles);
    }

    /// <inheritdoc/>
    public async Task<CurrentUserResult> GetCurrentUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var user = await _dbContext.Users
            .Include(x => x.UserRoles).ThenInclude(x => x.Role)
            .FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
            ?? throw new NotFoundAppException("user_not_found", "The current user could not be found.");

        var roles = user.UserRoles.Select(x => x.Role.Code).OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToArray();
        return new CurrentUserResult(user.Id, user.UserName, user.DisplayName, roles);
    }

    /// <summary>
    /// 标准化用户名（去除空格并转为大写）
    /// </summary>
    private static string Normalize(string value) => value.Trim().ToUpperInvariant();
}