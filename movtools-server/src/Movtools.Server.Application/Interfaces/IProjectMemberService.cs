using Movtools.Server.Application.Contracts.Users;

namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 项目成员服务接口
/// </summary>
public interface IProjectMemberService
{
    /// <summary>
    /// 添加项目成员
    /// </summary>
    Task<ProjectMemberResult> AddMemberAsync(string projectCode, Guid userId, string projectRoleCode, CancellationToken cancellationToken = default);

    /// <summary>
    /// 获取项目成员列表
    /// </summary>
    Task<IReadOnlyList<ProjectMemberResult>> GetMembersAsync(string projectCode, CancellationToken cancellationToken = default);

    /// <summary>
    /// 移除项目成员
    /// </summary>
    Task RemoveMemberAsync(string projectCode, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 检查当前用户是否是项目制片
    /// </summary>
    Task<bool> IsProducerAsync(string projectCode, CancellationToken cancellationToken = default);
}