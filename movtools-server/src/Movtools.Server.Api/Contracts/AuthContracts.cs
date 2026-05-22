namespace Movtools.Server.Api.Contracts;

public record LoginRequest(string UserName, string Password);

public record LoginResponse(
    Guid UserId,
    string UserName,
    string DisplayName,
    string AccessToken,
    DateTimeOffset ExpiresAtUtc,
    IReadOnlyList<string> Roles);

public record CurrentUserResponse(
    Guid UserId,
    string UserName,
    string DisplayName,
    IReadOnlyList<string> Roles);