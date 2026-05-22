using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class EpisodeConfiguration : IEntityTypeConfiguration<Episode>
{
    public void Configure(EntityTypeBuilder<Episode> builder)
    {
        builder.ToTable("episodes");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Code).HasMaxLength(50).IsRequired();
        builder.Property(x => x.Name).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Description).HasMaxLength(1000);
        builder.Property(x => x.ProjectId).IsRequired();
        builder.Property(x => x.LensFolderRootPath).HasMaxLength(500);
        builder.Property(x => x.LayoutCheckPath).HasMaxLength(500);

        builder.HasIndex(x => new { x.ProjectId, x.Code }).IsUnique();

        builder.Property(x => x.RowVersion).IsConcurrencyToken();

        builder.HasMany(x => x.Lenses)
            .WithOne(x => x.Episode)
            .HasForeignKey(x => x.EpisodeId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
