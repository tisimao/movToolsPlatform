namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 用户实体
/// </summary>
public sealed class User : EntityBase
{
    /// <summary>
    /// 用户名（登录账号）
    /// </summary>
    public string UserName { get; set; } = string.Empty;

    /// <summary>
    /// 标准化的用户名（大写，用于比对）
    /// </summary>
    public string NormalizedUserName { get; set; } = string.Empty;

    /// <summary>
    /// 显示名称
    /// </summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>
    /// 密码哈希值
    /// </summary>
    public string PasswordHash { get; set; } = string.Empty;

    /// <summary>
    /// 是否激活
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// 用户角色关联集合
    /// </summary>
    public ICollection<UserRole> UserRoles { get; set; } = [];

    /// <summary>
    /// 项目成员关联集合
    /// </summary>
    public ICollection<ProjectMember> ProjectMembers { get; set; } = [];
}