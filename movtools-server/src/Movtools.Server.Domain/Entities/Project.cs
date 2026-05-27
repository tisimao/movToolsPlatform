namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 项目实体
/// </summary>
public sealed class Project : EntityBase
{
    /// <summary>
    /// 项目代码（唯一标识）
    /// </summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>
    /// 项目名称
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 项目描述
    /// </summary>
    public string? Description { get; set; }

    public string? ProjectRootPath { get; set; }

    public string? LensFolderRootPath { get; set; }

    public string? MaCheckPath { get; set; }

    public string? MovCheckPath { get; set; }

    public string? LayoutCheckPath { get; set; }

    /// <summary>
    /// 项目默认帧率
    /// </summary>
    public int ProjectDefaultFps { get; set; } = 30;

    /// <summary>
    /// 版本标签
    /// </summary>
    public string VersionTag { get; set; } = string.Empty;

    /// <summary>
    /// 布局标签
    /// </summary>
    public string LayoutTag { get; set; } = string.Empty;

    /// <summary>
    /// 初始化 Excel 默认路径（协同上下文）
    /// </summary>
    public string? InitExcelPath { get; set; }

    /// <summary>
    /// 镜头根目录快照 JSON
    /// </summary>
    public string? LensRootsJson { get; set; }

    /// <summary>
    /// Layout 根目录快照 JSON
    /// </summary>
    public string? LayoutRootsJson { get; set; }

    /// <summary>
    /// 是否已归档
    /// </summary>
    public bool IsArchived { get; set; }

    /// <summary>
    /// 行版本（用于并发控制）
    /// </summary>
    public long RowVersion { get; set; }

    /// <summary>
    /// 剧集关联集合
    /// </summary>
    public ICollection<Episode> Episodes { get; set; } = [];
}
