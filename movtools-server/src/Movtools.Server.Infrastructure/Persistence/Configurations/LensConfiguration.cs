using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class LensConfiguration : IEntityTypeConfiguration<Lens>
{
    public void Configure(EntityTypeBuilder<Lens> builder)
    {
        builder.ToTable("lenses");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Code).HasMaxLength(50).IsRequired();
        builder.Property(x => x.Name).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Maker).HasMaxLength(200);
        builder.Property(x => x.MakerNameRaw).HasMaxLength(200);
        builder.Property(x => x.MakerMatchStatus).HasMaxLength(20).IsRequired();
        builder.Property(x => x.Description).HasMaxLength(1000);
        builder.Property(x => x.RootCode).HasMaxLength(100);
        builder.Property(x => x.LogicalPath).HasMaxLength(500);
        builder.Property(x => x.VersionTag).HasMaxLength(50);
        builder.Property(x => x.VersionNum)
            .HasMaxLength(50)
            .IsRequired()
            .HasDefaultValue("V01");
        builder.Property(x => x.InternalReviewStatusCode).HasMaxLength(50).IsRequired().HasDefaultValue(LensInternalReviewStatuses.NotInReview);
        builder.Property(x => x.InternalReviewUpdatedAtUtc);
        builder.Property(x => x.LatestReviewTaskId);
        builder.Property(x => x.LatestDirectorFeedbackAtUtc);
        builder.Property(x => x.PendingDirectorFeedbackCount).HasDefaultValue(0);
        builder.Property(x => x.LayoutTag).HasMaxLength(50);
        builder.Property(x => x.Comment).HasMaxLength(2000);
        builder.Property(x => x.Status).HasMaxLength(20).IsRequired();

        builder.HasIndex(x => new { x.EpisodeId, x.Code }).IsUnique();

        builder.Property(x => x.RowVersion).IsConcurrencyToken();

        builder.HasMany(x => x.StatusHistories)
            .WithOne(x => x.Lens)
            .HasForeignKey(x => x.LensId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
