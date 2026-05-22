using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Movtools.Server.Api.Contracts;

namespace Movtools.Server.Tests;

public sealed class DiagnosticsApiTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task Health_endpoint_returns_success()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadAsStringAsync();
        Assert.Contains("Healthy", payload, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Development_config_is_read_successfully()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var payload = await client.GetFromJsonAsync<ConfigResponse>("/api/diagnostics/config", JsonOptions);

        Assert.NotNull(payload);
        Assert.Contains(payload!.AllowedOrigins, origin => origin.Contains("localhost", StringComparison.OrdinalIgnoreCase));
        Assert.Equal("Information", payload.LoggingMinimumLevel);
        Assert.True(payload.DatabaseConfigured);
    }

    [Fact]
    public async Task Missing_required_configuration_fails_on_startup()
    {
        using var factory = new MissingDatabaseFactory();

        var exception = await Assert.ThrowsAnyAsync<Exception>(async () => await factory.CreateClient().GetAsync("/health"));

        Assert.Contains("Database:ConnectionString is required", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Invalid_parameters_return_unified_validation_error()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/diagnostics/validate");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var payload = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(JsonOptions);

        Assert.NotNull(payload);
        Assert.Equal("validation", payload!.Category);
        Assert.Equal("validation_error", payload.Code);
        Assert.NotEmpty(payload.TraceId);
        Assert.Contains("name", payload.Errors!.Keys, StringComparer.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Unhandled_exception_returns_unified_500_error()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/diagnostics/boom");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);

        var payload = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(JsonOptions);

        Assert.NotNull(payload);
        Assert.Equal("system", payload!.Category);
        Assert.Equal("internal_server_error", payload.Code);
        Assert.NotEmpty(payload.TraceId);
    }

    [Fact]
    public async Task Error_requests_emit_traceable_logs()
    {
        var loggerProvider = new ListLoggerProvider();
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureLogging(logging =>
            {
                logging.ClearProviders();
                logging.AddProvider(loggerProvider);
            });
        });

        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/diagnostics/validate");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(loggerProvider.Entries, entry => entry.Level == LogLevel.Warning && entry.Message.Contains("Validation request rejected", StringComparison.OrdinalIgnoreCase));
    }

    private sealed record ConfigResponse(
        string Environment,
        string[] AllowedOrigins,
        bool DatabaseConfigured,
        string JwtIssuer,
        string JwtAudience,
        string LoggingMinimumLevel,
        bool LoggingIncludeScopes);
}

internal sealed class MissingDatabaseFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, configurationBuilder) =>
        {
            configurationBuilder.Sources.Clear();
            configurationBuilder.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Server:AllowedOrigins:0"] = "http://localhost:3000",
                ["Database:ConnectionString"] = string.Empty,
                ["Jwt:Issuer"] = "Movtools.Server.Development",
                ["Jwt:Audience"] = "Movtools.Client.Development",
                ["Jwt:SigningKey"] = "dev-placeholder-signing-key-32-chars-minimum",
                ["Observability:MinimumLevel"] = "Information",
                ["Observability:IncludeScopes"] = "true"
            });
        });
    }
}

internal sealed class ListLoggerProvider : ILoggerProvider
{
    public List<LogEntry> Entries { get; } = [];

    public ILogger CreateLogger(string categoryName) => new ListLogger(this);

    public void Dispose()
    {
    }

    internal sealed record LogEntry(LogLevel Level, string Message);

    private sealed class ListLogger : ILogger
    {
        private readonly ListLoggerProvider _provider;

        public ListLogger(ListLoggerProvider provider)
        {
            _provider = provider;
        }

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            _provider.Entries.Add(new LogEntry(logLevel, formatter(state, exception)));
        }
    }

    private sealed class NullScope : IDisposable
    {
        public static readonly NullScope Instance = new();

        public void Dispose()
        {
        }
    }
}
