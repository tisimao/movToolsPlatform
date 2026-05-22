using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Infrastructure.Services;

/// <summary>
/// 同步服务实现 - 使用 ActivityLogService 提供增量同步能力
/// </summary>
public sealed class SyncService : ISyncService
{
    private readonly IActivityLogService _activityLogService;

    public SyncService(IActivityLogService activityLogService)
    {
        _activityLogService = activityLogService;
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<SyncChangeResult>> GetChangesAsync(long since, int limit = 100, CancellationToken cancellationToken = default)
    {
        var logs = await _activityLogService.GetLogsAsync(since, limit, cancellationToken);

        return logs.Select(log => new SyncChangeResult(
            log.Sequence,
            log.EntityType,
            log.EntityId,
            log.Action,
            log.OldValue,
            log.NewValue,
            log.UserId,
            log.CreatedAtUtc)).ToArray();
    }

    /// <inheritdoc/>
    public async Task<long> GetCurrentSequenceAsync(CancellationToken cancellationToken = default)
    {
        return await _activityLogService.GetCurrentSequenceAsync(cancellationToken);
    }
}