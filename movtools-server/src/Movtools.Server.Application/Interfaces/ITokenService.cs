using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// JWT令牌服务接口
/// </summary>
public interface ITokenService
{
    /// <summary>
    /// 创建访问令牌
    /// </summary>
    /// <param name="user">用户实体</param>
    /// <param name="roles">用户角色集合</param>
    /// <returns>令牌字符串和过期时间</returns>
    (string Token, DateTimeOffset ExpiresAtUtc) CreateAccessToken(User user, IReadOnlyCollection<string> roles);
}