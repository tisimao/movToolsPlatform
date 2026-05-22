namespace Movtools.Server.Application.Options;

/// <summary>
/// 服务器配置选项
/// </summary>
public sealed class ServerOptions
{
    /// <summary>
    /// 配置节名称
    /// </summary>
    public const string SectionName = "Server";

    /// <summary>
    /// 允许访问 API 的前端来源地址（CORS白名单）
    /// </summary>
    public string[] AllowedOrigins { get; init; } = [];
}