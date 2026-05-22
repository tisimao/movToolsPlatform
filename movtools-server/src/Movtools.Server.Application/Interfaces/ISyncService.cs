namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 同步服务接口 - 提供增量拉取能力
/// </summary>
public interface ISyncService
{
    /// <summary>
    /// 获取同步变更列表
    /// </summary>
    /// <param name="since">从指定序号开始获取（不包含）</param>
    /// <param name="limit">返回数量限制</param>
    Task<IReadOnlyList<SyncChangeResult>> GetChangesAsync(long since, int limit = 100, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取当前同步序号
    /// </summary>
    Task<long> GetCurrentSequenceAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// 同步变更结果
/// </summary>
public sealed record SyncChangeResult(
    long Sequence,
    string EntityType,
    Guid EntityId,
    string Action,
    string? OldValue,
    string? NewValue,
    Guid? UserId,
    DateTimeOffset CreatedAtUtc);