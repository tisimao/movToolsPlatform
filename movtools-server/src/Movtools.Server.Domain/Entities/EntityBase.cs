namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 实体基类，所有实体继承此类
/// </summary>
public abstract class EntityBase
{
    protected EntityBase()
    {
        Id = Guid.NewGuid();
        CreatedAtUtc = DateTimeOffset.UtcNow;
        UpdatedAtUtc = DateTimeOffset.UtcNow;
    }

    /// <summary>
    /// 实体唯一标识符
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// 创建时间（UTC时间）
    /// </summary>
    public DateTimeOffset CreatedAtUtc { get; set; }

    /// <summary>
    /// 最后更新时间（UTC时间）
    /// </summary>
    public DateTimeOffset UpdatedAtUtc { get; set; }
}