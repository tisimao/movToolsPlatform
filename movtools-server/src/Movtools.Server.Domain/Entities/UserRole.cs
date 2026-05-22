namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 用户角色关联实体（多对多关系）
/// </summary>
public sealed class UserRole
{
    /// <summary>
    /// 用户ID
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 用户实体
    /// </summary>
    public User User { get; set; } = null!;

    /// <summary>
    /// 角色ID
    /// </summary>
    public Guid RoleId { get; set; }

    /// <summary>
    /// 角色实体
    /// </summary>
    public Role Role { get; set; } = null!;

    /// <summary>
    /// 关联创建时间
    /// </summary>
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}