namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 密码哈希服务接口
/// </summary>
public interface IPasswordHashService
{
    /// <summary>
    /// 对密码进行哈希处理
    /// </summary>
    string Hash(string password);

    /// <summary>
    /// 验证密码是否匹配
    /// </summary>
    /// <param name="passwordHash">存储的哈希值</param>
    /// <param name="password">待验证的密码</param>
    /// <returns>是否匹配</returns>
    bool Verify(string passwordHash, string password);
}