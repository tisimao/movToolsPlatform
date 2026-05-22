using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class StorageRootConfiguration : IEntityTypeConfiguration<StorageRoot>
{
    public void Configure(EntityTypeBuilder<StorageRoot> builder)
    {
        builder.ToTable("storage_roots");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Code).HasMaxLength(100).IsRequired();
        builder.Property(x => x.Name).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Description).HasMaxLength(500);

        builder.HasIndex(x => x.Code).IsUnique();
    }
}