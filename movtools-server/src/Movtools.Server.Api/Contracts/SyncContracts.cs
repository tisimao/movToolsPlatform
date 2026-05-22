namespace Movtools.Server.Api.Contracts;

public record SyncChangesResponse(long CurrentSequence, IReadOnlyList<SyncChangeResponse> Changes);

public record SyncChangeResponse(
    long Sequence,
    string EntityType,
    Guid EntityId,
    string Action,
    string? OldValue,
    string? NewValue,
    Guid? UserId,
    DateTimeOffset CreatedAtUtc);

public record SyncSequenceResponse(long Sequence);