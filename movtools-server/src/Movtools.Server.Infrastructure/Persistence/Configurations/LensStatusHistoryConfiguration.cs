using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class LensStatusHistoryConfiguration : IEntityTypeConfiguration<LensStatusHistory>
{
    public void Configure(EntityTypeBuilder<LensStatusHistory> builder)
    {
        builder.ToTable("lens_status_histories");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.FromStatus).HasMaxLength(20).IsRequired();
        builder.Property(x => x.ToStatus).HasMaxLength(20).IsRequired();
        builder.Property(x => x.Comment).HasMaxLength(2000);

        builder.HasOne(x => x.Lens)
            .WithMany(x => x.StatusHistories)
            .HasForeignKey(x => x.LensId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.ChangedByUser)
            .WithMany()
            .HasForeignKey(x => x.ChangedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}