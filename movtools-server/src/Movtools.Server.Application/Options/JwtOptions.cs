namespace Movtools.Server.Application.Options;

/// <summary>
/// JWT 配置选项
/// </summary>
public sealed class JwtOptions
{
    /// <summary>
    /// 配置节名称
    /// </summary>
    public const string SectionName = "Jwt";

    /// <summary>
    /// Token 签发方
    /// </summary>
    public string Issuer { get; init; } = string.Empty;

    /// <summary>
    /// Token 接收方
    /// </summary>
    public string Audience { get; init; } = string.Empty;

    /// <summary>
    /// 签名密钥，长度不足时直接拒绝启动
    /// </summary>
    public string SigningKey { get; init; } = string.Empty;
}