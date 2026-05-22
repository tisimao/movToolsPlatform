namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 权限服务接口
/// </summary>
public interface IPermissionService
{
    /// <summary>
    /// 检查用户是否为项目成员
    /// </summary>
    Task<bool> IsProjectMemberAsync(string projectCode, Guid userId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 检查用户是否为管理员
    /// </summary>
    Task<bool> IsAdminAsync(Guid userId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 检查用户是否可以访问项目
    /// </summary>
    Task<bool> CanAccessProjectAsync(string projectCode, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 检查用户是否可以读取镜头
    /// </summary>
    Task<bool> CanReadLensAsync(string projectCode, Guid userId, Guid? makerUserId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 检查用户是否可以写入镜头
    /// </summary>
    Task<bool> CanWriteLensAsync(string projectCode, Guid userId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取用户在项目中的角色代码
    /// </summary>
    Task<string?> GetProjectRoleCodeAsync(string projectCode, Guid userId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 检查用户是否具有指定角色
    /// </summary>
    Task<bool> IsInRoleAsync(Guid userId, string roleCode, CancellationToken cancellationToken = default);
}
