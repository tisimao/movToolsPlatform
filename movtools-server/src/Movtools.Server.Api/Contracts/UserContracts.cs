namespace Movtools.Server.Api.Contracts;

public record CreateUserRequest(string UserName, string DisplayName, string Password);

public record UpdateUserRequest(string UserName, string DisplayName, string? Password, bool IsActive);

public record AssignRolesRequest(IReadOnlyList<string> RoleCodes);

public record UserResponse(
    Guid UserId,
    string UserName,
    string DisplayName,
    bool IsActive,
    IReadOnlyList<string> Roles);