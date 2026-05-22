using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace Movtools.Server.Infrastructure.Persistence;

public sealed class MovtoolsDbContextFactory : IDesignTimeDbContextFactory<MovtoolsDbContext>
{
    public MovtoolsDbContext CreateDbContext(string[] args)
    {
        var basePath = FindRepositoryRoot();

        var configuration = new ConfigurationBuilder()
            .SetBasePath(basePath)
            .AddJsonFile(@"src/Movtools.Server.Api/appsettings.json", optional: false)
            .AddJsonFile(@"src/Movtools.Server.Api/appsettings.Development.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        var connectionString = configuration.GetSection("Database").GetValue<string>("ConnectionString")
            ?? throw new InvalidOperationException("Database:ConnectionString is required.");

        var builder = new DbContextOptionsBuilder<MovtoolsDbContext>();
        builder.ConfigureWarnings(warnings => warnings.Ignore(RelationalEventId.PendingModelChangesWarning));
        builder.UseNpgsql(connectionString, npgsql => npgsql.MigrationsAssembly(typeof(MovtoolsDbContext).Assembly.FullName));
        return new MovtoolsDbContext(builder.Options);
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(Directory.GetCurrentDirectory());

        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "Movtools.Server.sln")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        return Directory.GetCurrentDirectory();
    }
}
