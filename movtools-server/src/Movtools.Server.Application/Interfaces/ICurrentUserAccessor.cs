namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 当前用户访问器接口 - 用于在请求中获取当前登录用户信息
/// </summary>
public interface ICurrentUserAccessor
{
    /// <summary>
    /// 当前用户ID
    /// </summary>
    Guid? UserId { get; }

    /// <summary>
    /// 当前用户名
    /// </summary>
    string? UserName { get; }

    /// <summary>
    /// 获取当前用户完整信息
    /// </summary>
    CurrentUserInfo? GetCurrentUser();
}

/// <summary>
/// 当前用户信息记录
/// </summary>
public record CurrentUserInfo(Guid Id, string UserName, string DisplayName);