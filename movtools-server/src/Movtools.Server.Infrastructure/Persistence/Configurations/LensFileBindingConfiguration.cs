using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class LensFileBindingConfiguration : IEntityTypeConfiguration<LensFileBinding>
{
    public void Configure(EntityTypeBuilder<LensFileBinding> builder)
    {
        builder.ToTable("lens_file_bindings");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.LensCode).HasMaxLength(50).IsRequired();
        builder.Property(x => x.BindingType).HasMaxLength(32).IsRequired();
        builder.Property(x => x.RelativePath).HasMaxLength(500).IsRequired();
        builder.Property(x => x.SourceRoot).HasMaxLength(100);
        builder.Property(x => x.VersionNum).HasMaxLength(50);
        builder.Property(x => x.FileName).HasMaxLength(255);

        builder.HasOne(x => x.Lens)
            .WithMany(x => x.FileBindings)
            .HasForeignKey(x => x.LensId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => new { x.LensId, x.BindingType, x.VersionNum })
            .IsUnique()
            .HasFilter("\"VersionNum\" IS NOT NULL");

        builder.HasIndex(x => new { x.LensId, x.BindingType })
            .IsUnique()
            .HasFilter("\"VersionNum\" IS NULL");

        builder.HasIndex(x => x.LensId);
    }
}
