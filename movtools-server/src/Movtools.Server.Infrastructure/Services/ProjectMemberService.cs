using Microsoft.EntityFrameworkCore;
using Movtools.Server.Application.Contracts.Users;
using Movtools.Server.Application.Exceptions;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;
using Movtools.Server.Infrastructure.Security;

namespace Movtools.Server.Infrastructure.Services;

public sealed class ProjectMemberService : IProjectMemberService
{
    private readonly MovtoolsDbContext _dbContext;
    private readonly ICurrentUserAccessor _currentUserAccessor;

    public ProjectMemberService(MovtoolsDbContext dbContext, ICurrentUserAccessor currentUserAccessor)
    {
        _dbContext = dbContext;
        _currentUserAccessor = currentUserAccessor;
    }

    public async Task<ProjectMemberResult> AddMemberAsync(string projectCode, Guid userId, string projectRoleCode, CancellationToken cancellationToken = default)
    {
        // 权限检查：只有制片可以添加成员
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        var isProducer = await IsProducerInternalAsync(projectCode, currentUser.Id, cancellationToken);
        if (!isProducer)
        {
            throw new UnauthorizedAppException("project_access_denied", "Only project producer can add members.");
        }

        var user = await _dbContext.Users.FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
            ?? throw new NotFoundAppException("user_not_found", "The user could not be found.");

        var normalizedProjectCode = projectCode.Trim();
        var normalizedRoleCode = projectRoleCode.Trim();

        var exists = await _dbContext.ProjectMembers.AnyAsync(x => x.ProjectCode == normalizedProjectCode && x.UserId == userId, cancellationToken);
        if (exists)
        {
            throw new BusinessException("project_member_exists", "The user is already a member of the project.");
        }

        var member = new ProjectMember
        {
            ProjectCode = normalizedProjectCode,
            UserId = user.Id,
            ProjectRoleCode = normalizedRoleCode,
            IsActive = true
        };

        _dbContext.ProjectMembers.Add(member);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new ProjectMemberResult(member.Id, member.ProjectCode, user.Id, user.UserName, user.DisplayName, member.ProjectRoleCode, member.IsActive);
    }

    public async Task<IReadOnlyList<ProjectMemberResult>> GetMembersAsync(string projectCode, CancellationToken cancellationToken = default)
    {
        // 权限检查
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        var canAccess = await CanAccessProjectInternalAsync(projectCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this project.");
        }

        var normalizedProjectCode = projectCode.Trim();
        var members = await _dbContext.ProjectMembers
            .Include(x => x.User)
            .Where(x => x.ProjectCode == normalizedProjectCode)
            .OrderBy(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        return members.Select(member => new ProjectMemberResult(
            member.Id,
            member.ProjectCode,
            member.UserId,
            member.User.UserName,
            member.User.DisplayName,
            member.ProjectRoleCode,
            member.IsActive)).ToArray();
    }

    public async Task RemoveMemberAsync(string projectCode, Guid userId, CancellationToken cancellationToken = default)
    {
        // 权限检查：只有制片可以移除成员
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        var isProducer = await IsProducerInternalAsync(projectCode, currentUser.Id, cancellationToken);
        if (!isProducer)
        {
            throw new UnauthorizedAppException("project_access_denied", "Only project producer can remove members.");
        }

        var normalizedProjectCode = projectCode.Trim();
        var member = await _dbContext.ProjectMembers.FirstOrDefaultAsync(
            x => x.ProjectCode == normalizedProjectCode && x.UserId == userId, 
            cancellationToken)
            ?? throw new NotFoundAppException("project_member_not_found", "The project member could not be found.");

        _dbContext.ProjectMembers.Remove(member);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> IsProducerAsync(string projectCode, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            return false;
        }

        return await IsProducerInternalAsync(projectCode, currentUser.Id, cancellationToken);
    }

    private async Task<bool> IsProducerInternalAsync(string projectCode, Guid userId, CancellationToken cancellationToken)
    {
        // 检查是否是管理员
        var isAdmin = await _dbContext.UserRoles
            .AnyAsync(x => x.UserId == userId && x.Role.Code == "admin", cancellationToken);
        if (isAdmin) return true;

        // 检查是否是项目制片
        return await _dbContext.ProjectMembers
            .AnyAsync(x => x.ProjectCode == projectCode && x.UserId == userId && 
                          x.ProjectRoleCode == "producer" && x.IsActive, cancellationToken);
    }

    private async Task<bool> CanAccessProjectInternalAsync(string projectCode, Guid userId, CancellationToken cancellationToken)
    {
        // 管理员可以访问所有项目
        var isAdmin = await _dbContext.UserRoles
            .AnyAsync(x => x.UserId == userId && x.Role.Code == "admin", cancellationToken);
        if (isAdmin) return true;

        // 项目成员可以访问
        return await _dbContext.ProjectMembers
            .AnyAsync(x => x.ProjectCode == projectCode && x.UserId == userId && x.IsActive, cancellationToken);
    }
}
