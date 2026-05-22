namespace Movtools.Server.Api.Contracts;

public record StorageRootCreateRequest(string Code, string Name, string? Description);

public record StorageRootResponse(
    Guid Id, string Code, string Name, string? Description, bool IsActive, 
    DateTimeOffset CreatedAtUtc, DateTimeOffset UpdatedAtUtc);

public record ClientNodeRegisterRequest(string ClientId, string ClientName, string? MachineName);

public record ClientNodeResponse(
    Guid Id, string ClientId, string ClientName, string? MachineName, 
    bool IsActive, Guid? OwnerUserId, DateTimeOffset CreatedAtUtc, DateTimeOffset UpdatedAtUtc);

public record PathMappingCreateRequest(string RootCode, string LocalPath);

public record PathMappingUpdateRequest(string LocalPath);

public record PathMappingResponse(
    Guid Id, Guid ClientNodeId, string RootCode, string LocalPath, 
    DateTimeOffset CreatedAtUtc, DateTimeOffset UpdatedAtUtc);

public record PathMappingBatchRequest(IReadOnlyList<PathMappingCreateRequest> Mappings);

public record PathMappingBatchResponse(IReadOnlyList<PathMappingResponse> Mappings);