using Movtools.Server.Application.Contracts.Users;

namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 用户管理服务接口
/// </summary>
public interface IUserManagementService
{
    /// <summary>
    /// 获取用户列表
    /// </summary>
    Task<IReadOnlyList<UserResult>> GetUsersAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 获取角色列表
    /// </summary>
    Task<IReadOnlyList<RoleResult>> GetRolesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 创建用户
    /// </summary>
    Task<UserResult> CreateUserAsync(string userName, string displayName, string password, CancellationToken cancellationToken = default);

    /// <summary>
    /// 更新用户
    /// </summary>
    Task<UserResult> UpdateUserAsync(Guid userId, string? userName, string? displayName, string? password, bool? isActive, CancellationToken cancellationToken = default);

    /// <summary>
    /// 分配角色给用户
    /// </summary>
    Task<UserResult> AssignRolesAsync(Guid userId, IReadOnlyCollection<string> roleCodes, CancellationToken cancellationToken = default);

    /// <summary>
    /// 删除用户
    /// </summary>
    Task DeleteUserAsync(Guid userId, CancellationToken cancellationToken = default);
}
