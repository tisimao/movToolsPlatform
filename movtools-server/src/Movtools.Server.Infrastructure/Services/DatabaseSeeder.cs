using Microsoft.EntityFrameworkCore;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;

namespace Movtools.Server.Infrastructure.Services;

public sealed class DatabaseSeeder
{
    public const string AdminUserName = "admin";
    public const string AdminPassword = "Admin@123456";
    public const string AdminDisplayName = "系统管理员";

    private static readonly (string Code, string Name)[] DefaultRoles =
    [
        ("admin", "系统管理员"),
        ("producer", "制片"),
        ("director", "导演"),
        ("maker", "制作人员"),
        ("reader", "只读查看者")
    ];

    private readonly MovtoolsDbContext _dbContext;
    private readonly IPasswordHashService _passwordHashService;

    public DatabaseSeeder(MovtoolsDbContext dbContext, IPasswordHashService passwordHashService)
    {
        _dbContext = dbContext;
        _passwordHashService = passwordHashService;
    }

    public async Task SeedCoreDataAsync(CancellationToken cancellationToken = default)
    {
        foreach (var (code, name) in DefaultRoles)
        {
            if (!await _dbContext.Roles.AnyAsync(x => x.Code == code, cancellationToken))
            {
                _dbContext.Roles.Add(new Role
                {
                    Code = code,
                    Name = name,
                    IsSystem = true
                });
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        var adminRole = await _dbContext.Roles.FirstAsync(x => x.Code == "admin", cancellationToken);
        var admin = await _dbContext.Users
            .Include(x => x.UserRoles)
            .FirstOrDefaultAsync(x => x.NormalizedUserName == AdminUserName.ToUpperInvariant(), cancellationToken);

        if (admin is null)
        {
            admin = new User
            {
                UserName = AdminUserName,
                NormalizedUserName = AdminUserName.ToUpperInvariant(),
                DisplayName = AdminDisplayName,
                PasswordHash = _passwordHashService.Hash(AdminPassword),
                IsActive = true
            };

            _dbContext.Users.Add(admin);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        if (!await _dbContext.UserRoles.AnyAsync(x => x.UserId == admin.Id && x.RoleId == adminRole.Id, cancellationToken))
        {
            _dbContext.UserRoles.Add(new UserRole { UserId = admin.Id, RoleId = adminRole.Id });
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        // Seed default storage roots
        var defaultStorageRoots = new[]
        {
            ("LENS-ROOT-MAIN", "Main Lens Storage", "Primary storage for lens files"),
            ("LAYOUT-ROOT-MAIN", "Main Layout Storage", "Primary storage for layout files"),
            ("ASSET-ROOT-MAIN", "Main Asset Storage", "Primary storage for assets")
        };

        foreach (var (code, name, desc) in defaultStorageRoots)
        {
            if (!await _dbContext.StorageRoots.AnyAsync(x => x.Code == code, cancellationToken))
            {
                _dbContext.StorageRoots.Add(new StorageRoot
                {
                    Code = code,
                    Name = name,
                    Description = desc,
                    IsActive = true
                });
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }
}
