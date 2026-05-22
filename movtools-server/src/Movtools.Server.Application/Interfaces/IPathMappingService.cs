namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 路径映射服务接口 - 管理存储根节点、客户端节点和路径映射
/// </summary>
public interface IPathMappingService
{
    // ========== Storage Root 操作 ==========
    
    /// <summary>
    /// 创建存储根节点
    /// </summary>
    Task<StorageRootResult> CreateStorageRootAsync(string code, string name, string? description, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取存储根节点列表
    /// </summary>
    Task<IReadOnlyList<StorageRootResult>> GetStorageRootsAsync(CancellationToken cancellationToken = default);
    
    // ========== Client Node 操作 ==========
    
    /// <summary>
    /// 注册客户端节点
    /// </summary>
    Task<ClientNodeResult> RegisterClientNodeAsync(string clientId, string clientName, string? machineName, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 根据客户端ID获取客户端节点
    /// </summary>
    Task<ClientNodeResult?> GetClientNodeAsync(string clientId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 根据ID获取客户端节点
    /// </summary>
    Task<ClientNodeResult?> GetClientNodeByIdAsync(Guid id, CancellationToken cancellationToken = default);
    
    // ========== Path Mapping 操作 ==========
    
    /// <summary>
    /// 设置路径映射
    /// </summary>
    Task<PathMappingResult> SetPathMappingAsync(Guid clientNodeId, string rootCode, string localPath, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取路径映射
    /// </summary>
    Task<PathMappingResult?> GetPathMappingAsync(Guid clientNodeId, string rootCode, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取客户端所有路径映射
    /// </summary>
    Task<IReadOnlyList<PathMappingResult>> GetPathMappingsAsync(Guid clientNodeId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 删除路径映射
    /// </summary>
    Task DeletePathMappingAsync(Guid clientNodeId, string rootCode, CancellationToken cancellationToken = default);
}

/// <summary>
/// 存储根节点结果
/// </summary>
public sealed record StorageRootResult(
    Guid Id,
    string Code,
    string Name,
    string? Description,
    bool IsActive,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);

/// <summary>
/// 客户端节点结果
/// </summary>
public sealed record ClientNodeResult(
    Guid Id,
    string ClientId,
    string ClientName,
    string? MachineName,
    bool IsActive,
    Guid? OwnerUserId,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);

/// <summary>
/// 路径映射结果
/// </summary>
public sealed record PathMappingResult(
    Guid Id,
    Guid ClientNodeId,
    string RootCode,
    string LocalPath,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);