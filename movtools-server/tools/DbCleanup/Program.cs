using Microsoft.Extensions.Configuration;
using Npgsql;

var target = args.FirstOrDefault()?.Trim().ToLowerInvariant() ?? "dev";
if (target is not "dev")
{
    Console.Error.WriteLine("Only the local dev database cleanup is supported by this tool.");
    return 2;
}

var configuration = new ConfigurationBuilder()
    .SetBasePath(Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "Movtools.Server.Api")))
    .AddJsonFile("appsettings.Development.json", optional: false, reloadOnChange: false)
    .AddEnvironmentVariables()
    .Build();

var connectionString = configuration.GetSection("Database").GetValue<string>("ConnectionString");
if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine("Database:ConnectionString is missing.");
    return 1;
}

var builder = new NpgsqlConnectionStringBuilder(connectionString);
if (!string.Equals(builder.Host, "localhost", StringComparison.OrdinalIgnoreCase) || builder.Database != "movtools_server_dev")
{
    Console.Error.WriteLine($"Refusing to clean unexpected database: {builder.Host}/{builder.Database}");
    return 1;
}

Console.WriteLine($"Cleaning local dev database: {builder.Database} on {builder.Host}:{builder.Port}");

await using var connection = new NpgsqlConnection(connectionString);
await connection.OpenAsync();

await using (var command = connection.CreateCommand())
{
    command.CommandText = "SELECT 1 FROM pg_catalog.pg_class WHERE relkind = 'r' LIMIT 1";
    await command.ExecuteScalarAsync();
}

await using (var command = connection.CreateCommand())
{
    command.CommandText = """
        DO $$
        DECLARE r RECORD;
        BEGIN
          FOR r IN (
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
              AND tablename <> '__EFMigrationsHistory'
          ) LOOP
            EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE;', r.tablename);
          END LOOP;
        END $$;
        """;
    await command.ExecuteNonQueryAsync();
}

Console.WriteLine("Truncated all public tables.");
return 0;
