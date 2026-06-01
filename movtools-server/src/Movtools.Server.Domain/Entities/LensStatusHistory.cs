namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 镜头状态历史记录实体
/// </summary>
public sealed class LensStatusHistory : EntityBase
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
    /// 变更前状态
    /// </summary>
    public string FromStatus { get; set; } = string.Empty;

    /// <summary>
    /// 变更后状态
    /// </summary>
    public string ToStatus { get; set; } = string.Empty;

    /// <summary>
    /// 变更人用户ID
    /// </summary>
    public Guid? ChangedByUserId { get; set; }

    /// <summary>
    /// 变更人用户实体
    /// </summary>
    public User? ChangedByUser { get; set; }

    /// <summary>
    /// 备注
    /// </summary>
    public string? Comment { get; set; }
}