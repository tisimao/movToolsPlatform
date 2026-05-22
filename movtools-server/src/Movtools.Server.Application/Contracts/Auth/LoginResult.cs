namespace Movtools.Server.Application.Contracts.Auth;

/// <summary>
/// 登录结果
/// </summary>
public sealed record LoginResult(
    Guid UserId,
    string UserName,
    string DisplayName,
    string AccessToken,
    DateTimeOffset ExpiresAtUtc,
    IReadOnlyList<string> Roles);