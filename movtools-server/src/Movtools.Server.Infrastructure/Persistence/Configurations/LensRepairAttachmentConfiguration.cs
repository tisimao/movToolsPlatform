using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class LensRepairAttachmentConfiguration : IEntityTypeConfiguration<LensRepairAttachment>
{
    public void Configure(EntityTypeBuilder<LensRepairAttachment> builder)
    {
        builder.ToTable("lens_repair_attachments");
        builder.HasKey(x => x.Id);

        builder.Property(x => x.FileName).HasMaxLength(500).IsRequired();
        builder.Property(x => x.OriginalName).HasMaxLength(500).IsRequired();
        builder.Property(x => x.ContentType).HasMaxLength(200).IsRequired();
        builder.Property(x => x.StorageRelativePath).HasMaxLength(2000).IsRequired();

        builder.HasOne(x => x.Lens)
            .WithMany()
            .HasForeignKey(x => x.LensId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.LensStatusHistory)
            .WithMany()
            .HasForeignKey(x => x.LensStatusHistoryId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
