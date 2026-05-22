using Movtools.Server.Application.Contracts.Auth;

namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 认证服务接口
/// </summary>
public interface IAuthService
{
    /// <summary>
    /// 用户登录
    /// </summary>
    Task<LoginResult> LoginAsync(string userName, string password, CancellationToken cancellationToken = default);

    /// <summary>
    /// 获取当前用户信息
    /// </summary>
    Task<CurrentUserResult> GetCurrentUserAsync(Guid userId, CancellationToken cancellationToken = default);
}