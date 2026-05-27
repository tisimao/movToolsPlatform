using Microsoft.EntityFrameworkCore;
using Npgsql;
using MysticMind.PostgresEmbed;

namespace Movtools.Server.Tests;

public sealed class PostgresFixture : IAsyncLifetime
{
    private const string DatabaseName = "movtools_server_dev";
    private PgServer? _server;

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        var workingDirectory = Path.Combine(AppContext.BaseDirectory, "pg_embed-tests", Guid.NewGuid().ToString("N"));

        _server = new PgServer("15.3.0", dbDir: workingDirectory, instanceId: Guid.NewGuid(), port: 0, addLocalUserAccessPermission: true, clearInstanceDirOnStop: true, clearWorkingDirOnStart: true, pgServerParams: new Dictionary<string, string>
        {
            ["max_connections"] = "50"
        });

        await _server.StartAsync();

        var adminConnectionString = $"Host=localhost;Port={_server.PgPort};Database=postgres;Username=postgres;Password=test;Pooling=false";
        await using var connection = new NpgsqlConnection(adminConnectionString);
        await connection.OpenAsync();

        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"SELECT 1 FROM pg_database WHERE datname = '{DatabaseName}'";
            var exists = await command.ExecuteScalarAsync();
            if (exists is null)
            {
                command.CommandText = $"CREATE DATABASE \"{DatabaseName}\"";
                await command.ExecuteNonQueryAsync();
            }
        }

        ConnectionString = $"Host=localhost;Port={_server.PgPort};Database={DatabaseName};Username=postgres;Password=test;Pooling=false";
        Environment.SetEnvironmentVariable("Database__ConnectionString", ConnectionString);
    }

    public Task DisposeAsync()
    {
        if (_server is not null)
        {
            _server.Stop();
            _server.Dispose();
        }

        Environment.SetEnvironmentVariable("Database__ConnectionString", null);
        return Task.CompletedTask;
    }
}

[CollectionDefinition("postgres integration", DisableParallelization = true)]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>
{
}
