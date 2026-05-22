namespace Movtools.Server.Domain.Entities;

/// <summary>
/// 项目成员关联实体
/// </summary>
public sealed class ProjectMember : EntityBase
{
    /// <summary>
    /// 项目代码
    /// </summary>
    public string ProjectCode { get; set; } = string.Empty;

    /// <summary>
    /// 用户ID
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// 用户实体
    /// </summary>
    public User User { get; set; } = null!;

    /// <summary>
    /// 项目角色代码
    /// </summary>
    public string ProjectRoleCode { get; set; } = string.Empty;

    /// <summary>
    /// 是否激活
    /// </summary>
    public bool IsActive { get; set; } = true;
}