namespace Movtools.Server.Application.Contracts.Users;

/// <summary>
/// 项目成员结果
/// </summary>
public sealed record ProjectMemberResult(
    Guid ProjectMemberId,
    string ProjectCode,
    Guid UserId,
    string UserName,
    string DisplayName,
    string ProjectRoleCode,
    bool IsActive);