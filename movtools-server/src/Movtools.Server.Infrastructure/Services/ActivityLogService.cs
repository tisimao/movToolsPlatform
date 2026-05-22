using Microsoft.EntityFrameworkCore;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;

namespace Movtools.Server.Infrastructure.Services;

/// <summary>
/// 活动日志服务实现
/// </summary>
public sealed class ActivityLogService : IActivityLogService
{
    private readonly MovtoolsDbContext _dbContext;

    public ActivityLogService(MovtoolsDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <inheritdoc/>
    public async Task LogAsync(string entityType, Guid entityId, string action, string? oldValue, string? newValue, CancellationToken cancellationToken = default)
    {
        var sequence = await GetCurrentSequenceAsync(cancellationToken) + 1;
        
        var log = new ActivityLog
        {
            EntityType = entityType,
            EntityId = entityId,
            Action = action,
            OldValue = oldValue,
            NewValue = newValue,
            Sequence = sequence
        };

        _dbContext.ActivityLogs.Add(log);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<ActivityLogResult>> GetLogsAsync(long since, int limit = 100, CancellationToken cancellationToken = default)
    {
        var logs = await _dbContext.ActivityLogs
            .Where(x => x.Sequence > since)
            .OrderBy(x => x.Sequence)
            .Take(limit)
            .ToListAsync(cancellationToken);

        return logs.Select(MapToResult).ToArray();
    }

    /// <inheritdoc/>
    public async Task<long> GetCurrentSequenceAsync(CancellationToken cancellationToken = default)
    {
        var maxSequence = await _dbContext.ActivityLogs.MaxAsync(x => (long?)x.Sequence, cancellationToken);
        return maxSequence ?? 0;
    }

    /// <summary>
    /// 映射到结果对象
    /// </summary>
    private static ActivityLogResult MapToResult(ActivityLog log) => new(
        log.Id,
        log.EntityType,
        log.EntityId,
        log.Action,
        log.OldValue,
        log.NewValue,
        log.UserId,
        log.Sequence,
        log.CreatedAtUtc);
}