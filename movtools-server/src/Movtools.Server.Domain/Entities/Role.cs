namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 角色实体
/// </summary>
public sealed class Role : EntityBase
{
    /// <summary>
    /// 角色代码（唯一标识）
    /// </summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>
    /// 角色名称
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 是否为系统角色（系统角色不可删除）
    /// </summary>
    public bool IsSystem { get; set; }

    /// <summary>
    /// 用户角色关联集合
    /// </summary>
    public ICollection<UserRole> UserRoles { get; set; } = [];
}