namespace Movtools.Server.Api.Contracts;

public record ApiErrorResponse(
    string Category,
    string Code,
    string Message,
    string? TraceId = null,
    Dictionary<string, string[]>? Errors = null);