namespace Movtools.Server.Application.Contracts.Users;

/// <summary>
/// 角色结果
/// </summary>
public sealed record RoleResult(
    Guid RoleId,
    string Code,
    string Name,
    string DisplayName,
    bool IsSystem);
