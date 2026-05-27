using Microsoft.EntityFrameworkCore;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence;

public sealed class MovtoolsDbContext : DbContext
{
    public MovtoolsDbContext(DbContextOptions<MovtoolsDbContext> options)
        : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();

    public DbSet<Role> Roles => Set<Role>();

    public DbSet<UserRole> UserRoles => Set<UserRole>();

    public DbSet<ProjectMember> ProjectMembers => Set<ProjectMember>();

    public DbSet<Project> Projects => Set<Project>();

    public DbSet<Episode> Episodes => Set<Episode>();

    public DbSet<Lens> Lenses => Set<Lens>();

    public DbSet<LensFileBinding> LensFileBindings => Set<LensFileBinding>();

    public DbSet<LensStatusHistory> LensStatusHistories => Set<LensStatusHistory>();

    public DbSet<ActivityLog> ActivityLogs => Set<ActivityLog>();

    public DbSet<ReviewTask> ReviewTasks => Set<ReviewTask>();

    public DbSet<ReviewComment> ReviewComments => Set<ReviewComment>();

    public DbSet<ReviewFeedbackRound> ReviewFeedbackRounds => Set<ReviewFeedbackRound>();

    public DbSet<ReviewTaskShot> ReviewTaskShots => Set<ReviewTaskShot>();

    public DbSet<LensRepairAttachment> LensRepairAttachments => Set<LensRepairAttachment>();

    public DbSet<StorageRoot> StorageRoots => Set<StorageRoot>();

    public DbSet<ClientNode> ClientNodes => Set<ClientNode>();

    public DbSet<ClientPathMapping> ClientPathMappings => Set<ClientPathMapping>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(MovtoolsDbContext).Assembly);
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        ApplyAuditInformation();
        return base.SaveChangesAsync(cancellationToken);
    }

    public override int SaveChanges()
    {
        ApplyAuditInformation();
        return base.SaveChanges();
    }

    private void ApplyAuditInformation()
    {
        var now = DateTimeOffset.UtcNow;

        foreach (var entry in ChangeTracker.Entries<EntityBase>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Entity.CreatedAtUtc = now;
                entry.Entity.UpdatedAtUtc = now;
            }
            else if (entry.State == EntityState.Modified)
            {
                entry.Entity.UpdatedAtUtc = now;
            }
        }

        foreach (var entry in ChangeTracker.Entries<UserRole>().Where(entry => entry.State == EntityState.Added))
        {
            entry.Entity.CreatedAtUtc = now;
        }
    }
}
