namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 活动日志实体 - 记录系统中的所有操作
/// </summary>
public sealed class ActivityLog : EntityBase
{
    /// <summary>
    /// 实体类型（如：Lens, Project等）
    /// </summary>
    public string EntityType { get; set; } = string.Empty;

    /// <summary>
    /// 实体ID
    /// </summary>
    public Guid EntityId { get; set; }

    /// <summary>
    /// 操作类型（如：Created, Updated, Deleted等）
    /// </summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>
    /// 变更前的值（JSON格式）
    /// </summary>
    public string? OldValue { get; set; }

    /// <summary>
    /// 变更后的值（JSON格式）
    /// </summary>
    public string? NewValue { get; set; }

    /// <summary>
    /// 操作人用户ID
    /// </summary>
    public Guid? UserId { get; set; }

    /// <summary>
    /// 操作人用户实体
    /// </summary>
    public User? User { get; set; }

    /// <summary>
    /// 序号（用于排序）
    /// </summary>
    public long Sequence { get; set; }
}