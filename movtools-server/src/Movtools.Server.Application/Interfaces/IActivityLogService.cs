namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 活动日志服务接口
/// </summary>
public interface IActivityLogService
{
    /// <summary>
    /// 记录活动日志
    /// </summary>
    Task LogAsync(string entityType, Guid entityId, string action, string? oldValue, string? newValue, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取活动日志列表
    /// </summary>
    /// <param name="since">从指定序号开始获取</param>
    /// <param name="limit">返回数量限制</param>
    Task<IReadOnlyList<ActivityLogResult>> GetLogsAsync(long since, int limit = 100, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取当前最大序号
    /// </summary>
    Task<long> GetCurrentSequenceAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// 活动日志结果
/// </summary>
public record ActivityLogResult(Guid Id, string EntityType, Guid EntityId, string Action, string? OldValue, string? NewValue, Guid? UserId, long Sequence, DateTimeOffset CreatedAtUtc);