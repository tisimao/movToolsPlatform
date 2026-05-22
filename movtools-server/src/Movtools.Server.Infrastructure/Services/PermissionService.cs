using Microsoft.EntityFrameworkCore;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;

namespace Movtools.Server.Infrastructure.Services;

/// <summary>
/// 权限服务实现
/// </summary>
public sealed class PermissionService : IPermissionService
{
    private readonly MovtoolsDbContext _dbContext;

    public PermissionService(MovtoolsDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <inheritdoc/>
    public async Task<bool> IsProjectMemberAsync(string projectCode, Guid userId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(projectCode) || userId == Guid.Empty)
        {
            return false;
        }

        var normalizedCode = projectCode.Trim().ToUpperInvariant();
        return await _dbContext.ProjectMembers
            .AnyAsync(x => x.ProjectCode == normalizedCode && x.UserId == userId && x.IsActive, cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<bool> IsAdminAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        if (userId == Guid.Empty)
        {
            return false;
        }

        return await _dbContext.UserRoles
            .AnyAsync(x => x.UserId == userId && x.Role.Code == "admin", cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<bool> CanAccessProjectAsync(string projectCode, Guid userId, CancellationToken cancellationToken = default)
    {
        // 管理员可以访问所有项目
        if (await IsAdminAsync(userId, cancellationToken))
        {
            return true;
        }

        // 项目成员可以访问其所属项目
        return await IsProjectMemberAsync(projectCode, userId, cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<bool> CanReadLensAsync(string projectCode, Guid userId, Guid? makerUserId, CancellationToken cancellationToken = default)
    {
        if (await IsAdminAsync(userId, cancellationToken))
        {
            return true;
        }

        var roleCode = await GetProjectRoleCodeAsync(projectCode, userId, cancellationToken);
        if (roleCode is null)
        {
            return false;
        }

        return roleCode switch
        {
            "producer" or "director" => true,
            "maker" => makerUserId.HasValue && makerUserId.Value == userId,
            _ => false
        };
    }

    /// <inheritdoc/>
    public async Task<bool> CanWriteLensAsync(string projectCode, Guid userId, CancellationToken cancellationToken = default)
    {
        if (await IsAdminAsync(userId, cancellationToken))
        {
            return true;
        }

        var roleCode = await GetProjectRoleCodeAsync(projectCode, userId, cancellationToken);
        return roleCode is "producer" or "director";
    }

    /// <inheritdoc/>
    public async Task<string?> GetProjectRoleCodeAsync(string projectCode, Guid userId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(projectCode) || userId == Guid.Empty)
        {
            return null;
        }

        if (await IsAdminAsync(userId, cancellationToken))
        {
            return "admin";
        }

        var normalizedCode = projectCode.Trim().ToUpperInvariant();
        return await _dbContext.ProjectMembers
            .Where(x => x.ProjectCode == normalizedCode && x.UserId == userId && x.IsActive)
            .Select(x => x.ProjectRoleCode)
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<bool> IsInRoleAsync(Guid userId, string roleCode, CancellationToken cancellationToken = default)
    {
        if (userId == Guid.Empty || string.IsNullOrWhiteSpace(roleCode))
        {
            return false;
        }

        var normalizedRoleCode = roleCode.Trim().ToLowerInvariant();
        return await _dbContext.UserRoles
            .AnyAsync(x => x.UserId == userId && x.Role.Code.ToLower() == normalizedRoleCode, cancellationToken);
    }
}
