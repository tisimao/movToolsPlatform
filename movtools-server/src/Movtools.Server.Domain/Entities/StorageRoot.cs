namespace Movtools.Server.Domain.Entities;

/// <summary>
/// Represents a logical storage root that can be referenced in path mappings.
/// </summary>
public sealed class StorageRoot : EntityBase
{
    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public bool IsActive { get; set; } = true;
}

/// <summary>
/// Represents a client machine that can have its own path mappings.
/// </summary>
public sealed class ClientNode : EntityBase
{
    public string ClientId { get; set; } = string.Empty;

    public string ClientName { get; set; } = string.Empty;

    public string? MachineName { get; set; }

    public bool IsActive { get; set; } = true;

    public Guid? OwnerUserId { get; set; }

    public User? OwnerUser { get; set; }

    public ICollection<ClientPathMapping> PathMappings { get; set; } = [];
}

/// <summary>
/// Maps a logical root_code to a local path for a specific client.
/// </summary>
public sealed class ClientPathMapping : EntityBase
{
    public Guid ClientNodeId { get; set; }

    public ClientNode ClientNode { get; set; } = null!;

    public string RootCode { get; set; } = string.Empty;

    public string LocalPath { get; set; } = string.Empty;
}