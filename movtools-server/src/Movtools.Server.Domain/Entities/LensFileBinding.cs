namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 镜头文件绑定实体
/// </summary>
public sealed class LensFileBinding : EntityBase
{
    /// <summary>
    /// 镜头ID
    /// </summary>
    public Guid LensId { get; set; }

    /// <summary>
    /// 镜头实体
    /// </summary>
    public Lens Lens { get; set; } = null!;

    /// <summary>
    /// 镜头代码
    /// </summary>
    public string LensCode { get; set; } = string.Empty;

    /// <summary>
    /// 绑定类型
    /// </summary>
    public string BindingType { get; set; } = string.Empty;

    /// <summary>
    /// 相对路径
    /// </summary>
    public string RelativePath { get; set; } = string.Empty;

    /// <summary>
    /// 来源根目录
    /// </summary>
    public string? SourceRoot { get; set; }

    /// <summary>
    /// 版本号
    /// </summary>
    public string? VersionNum { get; set; }

    /// <summary>
    /// 文件名
    /// </summary>
    public string? FileName { get; set; }
}
