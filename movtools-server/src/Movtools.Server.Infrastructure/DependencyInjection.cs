using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Application.Options;
using Movtools.Server.Infrastructure.Persistence;
using Movtools.Server.Infrastructure.Security;
using Movtools.Server.Infrastructure.Services;

namespace Movtools.Server.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetRequiredSection(DatabaseOptions.SectionName).GetValue<string>(nameof(DatabaseOptions.ConnectionString))
            ?? throw new InvalidOperationException("Database:ConnectionString is required.");

        services.AddDbContext<MovtoolsDbContext>(options =>
        {
            options.ConfigureWarnings(warnings => warnings.Ignore(RelationalEventId.PendingModelChangesWarning));
            options.UseNpgsql(connectionString, npgsql => npgsql.MigrationsAssembly(typeof(MovtoolsDbContext).Assembly.FullName));
        });

        services.AddScoped<IPasswordHashService, PasswordHashService>();
        services.AddScoped<ITokenService, TokenService>();
        services.AddScoped<ICurrentUserAccessor, CurrentUserAccessor>();
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IUserManagementService, UserManagementService>();
        services.AddScoped<IProjectMemberService, ProjectMemberService>();
        services.AddScoped<IProjectService, ProjectService>();
        services.AddScoped<IEpisodeService, EpisodeService>();
        services.AddScoped<ILensService, LensService>();
        services.AddScoped<IActivityLogService, ActivityLogService>();
        services.AddScoped<IPermissionService, PermissionService>();
        services.AddScoped<IReviewService, ReviewService>();
        services.AddScoped<IRepairAttachmentService, RepairAttachmentService>();
        services.AddScoped<IPathMappingService, PathMappingService>();
        services.AddScoped<ISyncService, SyncService>();
        services.AddScoped<ISignalRPublisher, SignalRPublisher>();
        services.AddScoped<DatabaseSeeder>();
        return services;
    }
}
