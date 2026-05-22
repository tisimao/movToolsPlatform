namespace Movtools.Server.Application.Contracts.Users;

/// <summary>
/// 用户结果
/// </summary>
public sealed record UserResult(
    Guid UserId,
    string UserName,
    string DisplayName,
    bool IsActive,
    IReadOnlyList<string> Roles);