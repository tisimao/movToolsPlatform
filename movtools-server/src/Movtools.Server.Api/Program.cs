using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
using Movtools.Server.Api.Extensions;
using Movtools.Server.Api.Hubs;
using Movtools.Server.Api.Middleware;
using Movtools.Server.Application.Options;
using Movtools.Server.Infrastructure.Persistence;
using Movtools.Server.Infrastructure.Services;

// WebAPI 启动入口：负责组装配置、日志、中间件和基础路由。
var builder = WebApplication.CreateBuilder(args);

// 先读取观测配置，确保日志系统在应用启动前就按环境值生效。
var observability = builder.Configuration.GetRequiredSection(ObservabilityOptions.SectionName).Get<ObservabilityOptions>()
    ?? throw new InvalidOperationException($"{ObservabilityOptions.SectionName} configuration is invalid.");

// 日志级别必须是合法的 LogLevel，否则直接终止启动，避免静默降级。
if (!Enum.TryParse<LogLevel>(observability.MinimumLevel, true, out var minimumLevel))
{
    throw new InvalidOperationException($"{ObservabilityOptions.SectionName}:MinimumLevel must be a valid LogLevel value.");
}

var databaseOptions = builder.Configuration.GetRequiredSection(DatabaseOptions.SectionName).Get<DatabaseOptions>()
    ?? throw new InvalidOperationException($"{DatabaseOptions.SectionName} configuration is invalid.");
var resolvedConnectionString = await ResolveDevelopmentConnectionStringAsync(databaseOptions, builder.Environment);
if (!string.Equals(resolvedConnectionString, databaseOptions.ConnectionString, StringComparison.Ordinal))
{
    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        [$"{DatabaseOptions.SectionName}:{nameof(DatabaseOptions.ConnectionString)}"] = resolvedConnectionString
    });
}

// 使用结构化 JSON 日志，便于后续接入集中日志系统。
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(options => options.IncludeScopes = observability.IncludeScopes);
builder.Logging.SetMinimumLevel(minimumLevel);

// 注册服务端基础能力：控制器、健康检查、配置绑定、错误处理。
builder.Services.AddMovtoolsServer(builder.Configuration, builder.Environment);

var app = builder.Build();

// 启动时先确保数据库结构和基础种子数据就绪，避免登录链路在首次查询时才暴露初始化问题。
await using (var scope = app.Services.CreateAsyncScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
    var seeder = scope.ServiceProvider.GetRequiredService<DatabaseSeeder>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup.DatabaseInitialization");

    try
    {
        await dbContext.Database.MigrateAsync();
        await seeder.SeedCoreDataAsync();
    }
    catch (Exception exception)
    {
        logger.LogWarning(exception, "Database initialization skipped during startup. Health endpoints remain available, but database-backed endpoints will fail until PostgreSQL is reachable and migrations can run.");
        if (app.Environment.IsDevelopment())
        {
            throw;
        }
    }
}

static async Task<string> ResolveDevelopmentConnectionStringAsync(DatabaseOptions databaseOptions, IHostEnvironment environment)
{
    if (!environment.IsDevelopment())
    {
        return databaseOptions.ConnectionString;
    }

    var connectionBuilder = new NpgsqlConnectionStringBuilder(databaseOptions.ConnectionString);
    if (string.IsNullOrWhiteSpace(connectionBuilder.ConnectionString) || string.IsNullOrWhiteSpace(connectionBuilder.Database))
    {
        throw new InvalidOperationException("Database:ConnectionString must specify a database name.");
    }

    var databaseName = connectionBuilder.Database;
    var appMaintenanceBuilder = new NpgsqlConnectionStringBuilder(connectionBuilder.ConnectionString)
    {
        Database = "postgres"
    };

    var openOutcome = await TryOpenConnectionAsync(connectionBuilder.ConnectionString);
    if (openOutcome == "success")
    {
        return connectionBuilder.ConnectionString;
    }

    using var loggerFactory = LoggerFactory.Create(logging => logging.AddSimpleConsole());
    var logger = loggerFactory.CreateLogger("Startup.DatabaseResolution");

    if (openOutcome == "missing_database" &&
        await TryRecreateDevelopmentDatabaseAsync(appMaintenanceBuilder.ConnectionString, databaseName, logger, "application role"))
    {
        return connectionBuilder.ConnectionString;
    }

    if (openOutcome == "missing_database" && !string.IsNullOrWhiteSpace(databaseOptions.BootstrapConnectionString))
    {
        var bootstrapBuilder = new NpgsqlConnectionStringBuilder(databaseOptions.BootstrapConnectionString)
        {
            Database = "postgres"
        };

        if (await TryRecreateDevelopmentDatabaseAsync(bootstrapBuilder.ConnectionString, databaseName, logger, "bootstrap role"))
        {
            return connectionBuilder.ConnectionString;
        }
    }

    if (openOutcome == "missing_database" && await TryOpenConnectionAsync(appMaintenanceBuilder.ConnectionString) == "success")
    {
        logger.LogWarning("Development database {DatabaseName} does not exist and could not be recreated automatically. Falling back to maintenance database 'postgres' for local development.", databaseName);
        return appMaintenanceBuilder.ConnectionString;
    }

    if (openOutcome == "missing_database")
    {
        throw new InvalidOperationException($"Development database '{databaseName}' does not exist and PostgreSQL maintenance database fallback is unavailable. Check the application role credentials or create the database manually.");
    }

    if (openOutcome == "invalid_password")
    {
        throw new InvalidOperationException("Database:ConnectionString authentication failed. Fix the PostgreSQL username/password in development settings.");
    }

    return connectionBuilder.ConnectionString;
}

static async Task<bool> TryRecreateDevelopmentDatabaseAsync(string maintenanceConnectionString, string databaseName, ILogger logger, string source)
{
    try
    {
        await using var connection = new NpgsqlConnection(maintenanceConnectionString);
        await connection.OpenAsync();

        await using var existsCommand = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = @databaseName);", connection);
        existsCommand.Parameters.AddWithValue("databaseName", databaseName);
        var exists = (bool)(await existsCommand.ExecuteScalarAsync() ?? false);

        if (exists)
        {
            logger.LogWarning("Development database {DatabaseName} already exists; recreating it before migration using {Source}.", databaseName, source);
            await ExecuteDatabaseCommandAsync(connection, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @databaseName AND pid <> pg_backend_pid();", databaseName);
            await ExecuteDatabaseCommandAsync(connection, $"DROP DATABASE IF EXISTS {QuoteIdentifier(databaseName)};");
        }

        logger.LogWarning("Creating development database {DatabaseName} using {Source}.", databaseName, source);
        await ExecuteDatabaseCommandAsync(connection, $"CREATE DATABASE {QuoteIdentifier(databaseName)};");
        return true;
    }
    catch (PostgresException exception) when (
        exception.SqlState == PostgresErrorCodes.InvalidPassword ||
        exception.SqlState == PostgresErrorCodes.InsufficientPrivilege ||
        exception.SqlState == PostgresErrorCodes.InvalidCatalogName)
    {
        logger.LogWarning(exception, "Failed to recreate development database {DatabaseName} using {Source}.", databaseName, source);
        return false;
    }
    catch (NpgsqlException exception)
    {
        logger.LogWarning(exception, "Unexpected connection failure while recreating development database {DatabaseName} using {Source}.", databaseName, source);
        return false;
    }
}

static async Task<string> TryOpenConnectionAsync(string connectionString)
{
    try
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        return "success";
    }
    catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.InvalidCatalogName)
    {
        return "missing_database";
    }
    catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.InvalidPassword)
    {
        return "invalid_password";
    }
    catch (NpgsqlException)
    {
        return "unavailable";
    }
}

static async Task ExecuteDatabaseCommandAsync(NpgsqlConnection connection, string commandText, string? databaseName = null)
{
    await using var command = new NpgsqlCommand(commandText, connection);
    if (!string.IsNullOrWhiteSpace(databaseName))
    {
        command.Parameters.AddWithValue("databaseName", databaseName);
    }

    await command.ExecuteNonQueryAsync();
}

static string QuoteIdentifier(string identifier)
{
    return $"\"{identifier.Replace("\"", "\"\"")}\"";
}

// 全局异常处理中间件：统一处理未捕获异常，避免返回不一致错误格式。
app.UseMiddleware<ExceptionHandlingMiddleware>();

// 为返修图片附件提供静态文件服务
var uploadsPath = Path.Combine(Directory.GetCurrentDirectory(), "uploads");
if (!Directory.Exists(uploadsPath))
{
    Directory.CreateDirectory(uploadsPath);
}
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(uploadsPath),
    RequestPath = "/uploads"
});

app.UseRouting();

// 默认 CORS 策略由配置决定，避免前端地址硬编码。
app.UseCors(policyName: "Default");

app.UseAuthentication();
app.UseAuthorization();

// 暴露 API 控制器。
app.MapControllers();

// 暴露 SignalR Hub。
app.MapHub<MovtoolsHub>("/hubs/movtools");

// 提供基础健康检查，供本机/容器/编排平台探活。
app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = HealthCheckResponseWriter.WriteAsync
});

app.Run();

public partial class Program { }
