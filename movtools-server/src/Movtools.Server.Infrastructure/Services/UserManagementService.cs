using Microsoft.EntityFrameworkCore;
using Movtools.Server.Application.Contracts.Users;
using Movtools.Server.Application.Exceptions;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;

namespace Movtools.Server.Infrastructure.Services;

/// <summary>
/// 用户管理服务实现
/// </summary>
public sealed class UserManagementService : IUserManagementService
{
    private readonly MovtoolsDbContext _dbContext;
    private readonly IPasswordHashService _passwordHashService;

    public UserManagementService(MovtoolsDbContext dbContext, IPasswordHashService passwordHashService)
    {
        _dbContext = dbContext;
        _passwordHashService = passwordHashService;
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<UserResult>> GetUsersAsync(CancellationToken cancellationToken = default)
    {
        var users = await _dbContext.Users
            .Include(x => x.UserRoles).ThenInclude(x => x.Role)
            .OrderBy(x => x.UserName)
            .ToListAsync(cancellationToken);

        return users.Select(MapUser).ToArray();
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<RoleResult>> GetRolesAsync(CancellationToken cancellationToken = default)
    {
        var roles = await _dbContext.Roles
            .OrderBy(x => x.Code)
            .ToListAsync(cancellationToken);

        return roles.Select(role => new RoleResult(role.Id, role.Code, role.Name, ResolveRoleDisplayName(role.Code, role.Name), role.IsSystem)).ToArray();
    }

    /// <inheritdoc/>
    public async Task<UserResult> CreateUserAsync(string userName, string displayName, string password, CancellationToken cancellationToken = default)
    {
        var normalized = Normalize(userName);
        var exists = await _dbContext.Users.AnyAsync(x => x.NormalizedUserName == normalized, cancellationToken);
        if (exists)
        {
            throw new BusinessException("user_exists", "A user with the same username already exists.");
        }

        var user = new User
        {
            UserName = userName.Trim(),
            NormalizedUserName = normalized,
            DisplayName = displayName.Trim(),
            PasswordHash = _passwordHashService.Hash(password),
            IsActive = true
        };

        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return MapUser(user);
    }

    /// <inheritdoc/>
    public async Task<UserResult> UpdateUserAsync(Guid userId, string? userName, string? displayName, string? password, bool? isActive, CancellationToken cancellationToken = default)
    {
        var user = await _dbContext.Users
            .Include(x => x.UserRoles).ThenInclude(x => x.Role)
            .FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
            ?? throw new NotFoundAppException("user_not_found", "The user could not be found.");

        if (!string.IsNullOrWhiteSpace(userName))
        {
            var trimmedUserName = userName.Trim();
            var normalized = Normalize(trimmedUserName);
            var exists = await _dbContext.Users.AnyAsync(x => x.Id != userId && x.NormalizedUserName == normalized, cancellationToken);
            if (exists)
            {
                throw new BusinessException("user_exists", "A user with the same username already exists.");
            }

            user.UserName = trimmedUserName;
            user.NormalizedUserName = normalized;
        }

        if (!string.IsNullOrWhiteSpace(displayName))
        {
            user.DisplayName = displayName.Trim();
        }

        if (!string.IsNullOrWhiteSpace(password))
        {
            user.PasswordHash = _passwordHashService.Hash(password);
        }

        if (isActive.HasValue)
        {
            user.IsActive = isActive.Value;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return MapUser(user);
    }

    /// <inheritdoc/>
    public async Task<UserResult> AssignRolesAsync(Guid userId, IReadOnlyCollection<string> roleCodes, CancellationToken cancellationToken = default)
    {
        var user = await _dbContext.Users
            .Include(x => x.UserRoles).ThenInclude(x => x.Role)
            .FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
            ?? throw new NotFoundAppException("user_not_found", "The user could not be found.");

        var submittedRoleTokens = roleCodes
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (submittedRoleTokens.Length == 0)
        {
            throw new ValidationAppException("role_codes_required", "At least one role code is required.");
        }

        var allRoles = await _dbContext.Roles.ToListAsync(cancellationToken);
        var roles = new List<Role>();
        var missing = new List<string>();

        foreach (var token in submittedRoleTokens)
        {
            var matchedRole = allRoles.FirstOrDefault(role =>
                string.Equals(role.Code, token, StringComparison.OrdinalIgnoreCase)
                || string.Equals(role.Name, token, StringComparison.OrdinalIgnoreCase)
                || string.Equals(ResolveRoleDisplayName(role.Code, role.Name), token, StringComparison.OrdinalIgnoreCase));

            if (matchedRole is null)
            {
                missing.Add(token);
                continue;
            }

            if (roles.All(role => !string.Equals(role.Code, matchedRole.Code, StringComparison.OrdinalIgnoreCase)))
            {
                roles.Add(matchedRole);
            }
        }

        if (missing.Count > 0)
        {
            throw new NotFoundAppException("role_not_found", $"Role(s) not found: {string.Join(", ", missing)}.");
        }

        user.UserRoles.Clear();
        foreach (var role in roles)
        {
            user.UserRoles.Add(new UserRole { UserId = user.Id, RoleId = role.Id, Role = role });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return MapUser(user);
    }

    /// <inheritdoc/>
    public async Task DeleteUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var user = await _dbContext.Users
            .Include(x => x.UserRoles)
            .FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
            ?? throw new NotFoundAppException("user_not_found", "The user could not be found.");

        // 禁止删除管理员用户
        if (user.NormalizedUserName == "ADMIN")
        {
            throw new BusinessException("cannot_delete_admin", "Cannot delete the admin user.");
        }

        _dbContext.UserRoles.RemoveRange(user.UserRoles);
        _dbContext.Users.Remove(user);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// 映射用户实体到结果对象
    /// </summary>
    private static UserResult MapUser(User user)
    {
        var roles = user.UserRoles
            .Select(x => x.Role.Code)
            .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new UserResult(user.Id, user.UserName, user.DisplayName, user.IsActive, roles);
    }

    /// <summary>
    /// 标准化用户名
    /// </summary>
    private static string Normalize(string value) => value.Trim().ToUpperInvariant();

    private static string ResolveRoleDisplayName(string code, string fallbackName)
        => code.Trim().ToLowerInvariant() switch
        {
            "admin" => "系统管理员",
            "producer" => "制片",
            "director" => "导演",
            "maker" => "制作人员",
            "reader" => "只读查看者",
            _ => string.IsNullOrWhiteSpace(fallbackName) ? code : fallbackName.Trim()
        };
}
