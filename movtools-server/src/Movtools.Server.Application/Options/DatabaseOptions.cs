namespace Movtools.Server.Application.Options;

/// <summary>
/// 数据库配置选项
/// </summary>
public sealed class DatabaseOptions
{
    /// <summary>
    /// 配置节名称
    /// </summary>
    public const string SectionName = "Database";

    /// <summary>
    /// 数据库连接字符串，启动时必须可用
    /// </summary>
    public string ConnectionString { get; init; } = string.Empty;

    /// <summary>
    /// 开发环境下用于创建/重建数据库的管理员连接字符串
    /// </summary>
    public string? BootstrapConnectionString { get; init; }
}
