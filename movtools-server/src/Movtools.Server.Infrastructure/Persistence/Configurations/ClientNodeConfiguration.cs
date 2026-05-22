using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class ClientNodeConfiguration : IEntityTypeConfiguration<ClientNode>
{
    public void Configure(EntityTypeBuilder<ClientNode> builder)
    {
        builder.ToTable("client_nodes");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.ClientId).HasMaxLength(100).IsRequired();
        builder.Property(x => x.ClientName).HasMaxLength(200).IsRequired();
        builder.Property(x => x.MachineName).HasMaxLength(100);

        builder.HasOne(x => x.OwnerUser)
            .WithMany()
            .HasForeignKey(x => x.OwnerUserId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasIndex(x => x.ClientId).IsUnique();
    }
}

public sealed class ClientPathMappingConfiguration : IEntityTypeConfiguration<ClientPathMapping>
{
    public void Configure(EntityTypeBuilder<ClientPathMapping> builder)
    {
        builder.ToTable("client_path_mappings");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.RootCode).HasMaxLength(100).IsRequired();
        builder.Property(x => x.LocalPath).HasMaxLength(500).IsRequired();

        builder.HasOne(x => x.ClientNode)
            .WithMany(x => x.PathMappings)
            .HasForeignKey(x => x.ClientNodeId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => new { x.ClientNodeId, x.RootCode }).IsUnique();
    }
}