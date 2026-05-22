using Microsoft.EntityFrameworkCore;
using Movtools.Server.Application.Exceptions;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;
using Movtools.Server.Infrastructure.Security;

namespace Movtools.Server.Infrastructure.Services;

/// <summary>
/// 路径映射服务实现 - 管理存储根节点、客户端节点和路径映射
/// </summary>
public sealed class PathMappingService : IPathMappingService
{
    private readonly MovtoolsDbContext _dbContext;
    private readonly ICurrentUserAccessor _currentUserAccessor;
    private readonly IPermissionService _permissionService;

    public PathMappingService(
        MovtoolsDbContext dbContext,
        ICurrentUserAccessor currentUserAccessor,
        IPermissionService permissionService)
    {
        _dbContext = dbContext;
        _currentUserAccessor = currentUserAccessor;
        _permissionService = permissionService;
    }

    /// <inheritdoc/>
    public async Task<StorageRootResult> CreateStorageRootAsync(string code, string name, string? description, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        // 只有管理员才能创建存储根节点
        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        if (!isAdmin)
        {
            throw new UnauthorizedAppException("admin_required", "Only administrators can create storage roots.");
        }

        var normalizedCode = code.Trim().ToUpperInvariant();
        
        // 检查存储根节点是否已存在
        var exists = await _dbContext.StorageRoots.AnyAsync(x => x.Code == normalizedCode, cancellationToken);
        if (exists)
        {
            throw new BusinessException("storage_root_exists", "A storage root with this code already exists.");
        }

        var storageRoot = new StorageRoot
        {
            Code = normalizedCode,
            Name = name.Trim(),
            Description = description?.Trim(),
            IsActive = true
        };

        _dbContext.StorageRoots.Add(storageRoot);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new StorageRootResult(
            storageRoot.Id,
            storageRoot.Code,
            storageRoot.Name,
            storageRoot.Description,
            storageRoot.IsActive,
            storageRoot.CreatedAtUtc,
            storageRoot.UpdatedAtUtc);
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<StorageRootResult>> GetStorageRootsAsync(CancellationToken cancellationToken = default)
    {
        var roots = await _dbContext.StorageRoots
            .Where(x => x.IsActive)
            .OrderBy(x => x.Code)
            .ToListAsync(cancellationToken);

        return roots.Select(r => new StorageRootResult(
            r.Id,
            r.Code,
            r.Name,
            r.Description,
            r.IsActive,
            r.CreatedAtUtc,
            r.UpdatedAtUtc)).ToArray();
    }

    /// <inheritdoc/>
    public async Task<ClientNodeResult> RegisterClientNodeAsync(string clientId, string clientName, string? machineName, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        // 标准化输入
        var normalizedClientId = clientId.Trim();
        var normalizedClientName = clientName.Trim();

        // 检查客户端节点是否已存在
        var existingNode = await _dbContext.ClientNodes
            .FirstOrDefaultAsync(x => x.ClientId == normalizedClientId, cancellationToken);

        if (existingNode != null)
        {
            // 更新现有节点
            existingNode.ClientName = normalizedClientName;
            existingNode.MachineName = machineName?.Trim();
            existingNode.OwnerUserId = currentUser.Id;
            existingNode.IsActive = true;
            await _dbContext.SaveChangesAsync(cancellationToken);

            return new ClientNodeResult(
                existingNode.Id,
                existingNode.ClientId,
                existingNode.ClientName,
                existingNode.MachineName,
                existingNode.IsActive,
                existingNode.OwnerUserId,
                existingNode.CreatedAtUtc,
                existingNode.UpdatedAtUtc);
        }

        // 创建新客户端节点
        var clientNode = new ClientNode
        {
            ClientId = normalizedClientId,
            ClientName = normalizedClientName,
            MachineName = machineName?.Trim(),
            OwnerUserId = currentUser.Id,
            IsActive = true
        };

        _dbContext.ClientNodes.Add(clientNode);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new ClientNodeResult(
            clientNode.Id,
            clientNode.ClientId,
            clientNode.ClientName,
            clientNode.MachineName,
            clientNode.IsActive,
            clientNode.OwnerUserId,
            clientNode.CreatedAtUtc,
            clientNode.UpdatedAtUtc);
    }

    /// <inheritdoc/>
    public async Task<ClientNodeResult?> GetClientNodeAsync(string clientId, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var node = await _dbContext.ClientNodes
            .FirstOrDefaultAsync(x => x.ClientId == clientId && x.IsActive, cancellationToken);

        if (node == null) return null;

        // 只有所有者或管理员可以访问
        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        if (node.OwnerUserId != currentUser.Id && !isAdmin)
        {
            throw new UnauthorizedAppException("access_denied", "You do not have permission to access this client node.");
        }

        return new ClientNodeResult(
            node.Id,
            node.ClientId,
            node.ClientName,
            node.MachineName,
            node.IsActive,
            node.OwnerUserId,
            node.CreatedAtUtc,
            node.UpdatedAtUtc);
    }

    /// <inheritdoc/>
    public async Task<ClientNodeResult?> GetClientNodeByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var node = await _dbContext.ClientNodes
            .FirstOrDefaultAsync(x => x.Id == id && x.IsActive, cancellationToken);

        if (node == null) return null;

        // 只有所有者或管理员可以访问
        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        if (node.OwnerUserId != currentUser.Id && !isAdmin)
        {
            throw new UnauthorizedAppException("access_denied", "You do not have permission to access this client node.");
        }

        return new ClientNodeResult(
            node.Id,
            node.ClientId,
            node.ClientName,
            node.MachineName,
            node.IsActive,
            node.OwnerUserId,
            node.CreatedAtUtc,
            node.UpdatedAtUtc);
    }

    /// <inheritdoc/>
    public async Task<PathMappingResult> SetPathMappingAsync(Guid clientNodeId, string rootCode, string localPath, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        // 获取客户端节点并验证所有权
        var clientNode = await _dbContext.ClientNodes
            .FirstOrDefaultAsync(x => x.Id == clientNodeId, cancellationToken)
            ?? throw new NotFoundAppException("client_node_not_found", "The client node could not be found.");

        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        if (clientNode.OwnerUserId != currentUser.Id && !isAdmin)
        {
            throw new UnauthorizedAppException("access_denied", "You do not have permission to modify this client node's path mappings.");
        }

        // 验证存储根节点是否存在
        var normalizedRootCode = rootCode.Trim().ToUpperInvariant();
        var rootExists = await _dbContext.StorageRoots.AnyAsync(x => x.Code == normalizedRootCode && x.IsActive, cancellationToken);
        if (!rootExists)
        {
            throw new NotFoundAppException("storage_root_not_found", "The storage root could not be found.");
        }

        // 检查映射是否已存在
        var existingMapping = await _dbContext.ClientPathMappings
            .FirstOrDefaultAsync(x => x.ClientNodeId == clientNodeId && x.RootCode == normalizedRootCode, cancellationToken);

        if (existingMapping != null)
        {
            // 更新现有映射
            existingMapping.LocalPath = localPath.Trim();
            await _dbContext.SaveChangesAsync(cancellationToken);

            return new PathMappingResult(
                existingMapping.Id,
                existingMapping.ClientNodeId,
                existingMapping.RootCode,
                existingMapping.LocalPath,
                existingMapping.CreatedAtUtc,
                existingMapping.UpdatedAtUtc);
        }

        // 创建新映射
        var mapping = new ClientPathMapping
        {
            ClientNodeId = clientNodeId,
            RootCode = normalizedRootCode,
            LocalPath = localPath.Trim()
        };

        _dbContext.ClientPathMappings.Add(mapping);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new PathMappingResult(
            mapping.Id,
            mapping.ClientNodeId,
            mapping.RootCode,
            mapping.LocalPath,
            mapping.CreatedAtUtc,
            mapping.UpdatedAtUtc);
    }

    /// <inheritdoc/>
    public async Task<PathMappingResult?> GetPathMappingAsync(Guid clientNodeId, string rootCode, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        // 获取客户端节点并验证所有权
        var clientNode = await _dbContext.ClientNodes
            .FirstOrDefaultAsync(x => x.Id == clientNodeId, cancellationToken)
            ?? throw new NotFoundAppException("client_node_not_found", "The client node could not be found.");

        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        if (clientNode.OwnerUserId != currentUser.Id && !isAdmin)
        {
            throw new UnauthorizedAppException("access_denied", "You do not have permission to access this client node's path mappings.");
        }

        var mapping = await _dbContext.ClientPathMappings
            .FirstOrDefaultAsync(x => x.ClientNodeId == clientNodeId && x.RootCode == rootCode.Trim().ToUpperInvariant(), cancellationToken);

        if (mapping == null) return null;

        return new PathMappingResult(
            mapping.Id,
            mapping.ClientNodeId,
            mapping.RootCode,
            mapping.LocalPath,
            mapping.CreatedAtUtc,
            mapping.UpdatedAtUtc);
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<PathMappingResult>> GetPathMappingsAsync(Guid clientNodeId, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        // 获取客户端节点并验证所有权
        var clientNode = await _dbContext.ClientNodes
            .FirstOrDefaultAsync(x => x.Id == clientNodeId, cancellationToken)
            ?? throw new NotFoundAppException("client_node_not_found", "The client node could not be found.");

        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        if (clientNode.OwnerUserId != currentUser.Id && !isAdmin)
        {
            throw new UnauthorizedAppException("access_denied", "You do not have permission to access this client node's path mappings.");
        }

        var mappings = await _dbContext.ClientPathMappings
            .Where(x => x.ClientNodeId == clientNodeId)
            .OrderBy(x => x.RootCode)
            .ToListAsync(cancellationToken);

        return mappings.Select(m => new PathMappingResult(
            m.Id,
            m.ClientNodeId,
            m.RootCode,
            m.LocalPath,
            m.CreatedAtUtc,
            m.UpdatedAtUtc)).ToArray();
    }

    /// <inheritdoc/>
    public async Task DeletePathMappingAsync(Guid clientNodeId, string rootCode, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        // 获取客户端节点并验证所有权
        var clientNode = await _dbContext.ClientNodes
            .FirstOrDefaultAsync(x => x.Id == clientNodeId, cancellationToken)
            ?? throw new NotFoundAppException("client_node_not_found", "The client node could not be found.");

        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        if (clientNode.OwnerUserId != currentUser.Id && !isAdmin)
        {
            throw new UnauthorizedAppException("access_denied", "You do not have permission to delete this client node's path mapping.");
        }

        var mapping = await _dbContext.ClientPathMappings
            .FirstOrDefaultAsync(x => x.ClientNodeId == clientNodeId && x.RootCode == rootCode.Trim().ToUpperInvariant(), cancellationToken)
            ?? throw new NotFoundAppException("mapping_not_found", "The path mapping could not be found.");

        _dbContext.ClientPathMappings.Remove(mapping);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }
}