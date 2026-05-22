using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> builder)
    {
        builder.ToTable("projects");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Code).HasMaxLength(50).IsRequired();
        builder.Property(x => x.Name).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Description).HasMaxLength(1000);
        builder.Property(x => x.ProjectRootPath).HasMaxLength(500);
        builder.Property(x => x.LensFolderRootPath).HasMaxLength(500);
        builder.Property(x => x.MaCheckPath).HasMaxLength(500);
        builder.Property(x => x.MovCheckPath).HasMaxLength(500);
        builder.Property(x => x.LayoutCheckPath).HasMaxLength(500);
        builder.Property(x => x.VersionTag).HasMaxLength(50).IsRequired();
        builder.Property(x => x.LayoutTag).HasMaxLength(50).IsRequired();
        builder.Property(x => x.InitExcelPath).HasMaxLength(500);
        builder.Property(x => x.LensRootsJson).HasColumnType("text");
        builder.Property(x => x.LayoutRootsJson).HasColumnType("text");

        builder.HasIndex(x => x.Code).IsUnique();

        builder.Property(x => x.RowVersion).IsConcurrencyToken();

        builder.HasMany(x => x.Episodes)
            .WithOne(x => x.Project)
            .HasForeignKey(x => x.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
