namespace Movtools.Server.Application.Contracts.Auth;

/// <summary>
/// 当前用户结果
/// </summary>
public sealed record CurrentUserResult(
    Guid UserId,
    string UserName,
    string DisplayName,
    IReadOnlyList<string> Roles);