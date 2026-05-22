namespace Movtools.Server.Api.Contracts;

public record DiagnosticEchoRequest(string? Message);

public record DiagnosticsConfigResponse(
    string Environment,
    string[]? AllowedOrigins,
    bool DatabaseConfigured,
    string JwtIssuer,
    string JwtAudience,
    string LoggingMinimumLevel,
    bool LoggingIncludeScopes);