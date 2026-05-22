namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 剧集实体
/// </summary>
public sealed class Episode : EntityBase
{
    /// <summary>
    /// 剧集代码（唯一标识）
    /// </summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>
    /// 剧集名称
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 序号（用于排序）
    /// </summary>
    public int Sequence { get; set; }

    /// <summary>
    /// 所属项目ID
    /// </summary>
    public Guid ProjectId { get; set; }

    /// <summary>
    /// 所属项目实体
    /// </summary>
    public Project Project { get; set; } = null!;

    /// <summary>
    /// 剧集描述
    /// </summary>
    public string? Description { get; set; }

    public string? LensFolderRootPath { get; set; }

    public string? LayoutCheckPath { get; set; }

    /// <summary>
    /// 是否已归档
    /// </summary>
    public bool IsArchived { get; set; }

    /// <summary>
    /// 行版本（用于并发控制）
    /// </summary>
    public long RowVersion { get; set; }

    /// <summary>
    /// 镜头关联集合
    /// </summary>
    public ICollection<Lens> Lenses { get; set; } = [];
}
