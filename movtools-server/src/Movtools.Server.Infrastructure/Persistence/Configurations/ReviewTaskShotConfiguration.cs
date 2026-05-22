using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class ReviewTaskShotConfiguration : IEntityTypeConfiguration<ReviewTaskShot>
{
    public void Configure(EntityTypeBuilder<ReviewTaskShot> builder)
    {
        builder.ToTable("review_task_shots");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.SubmitVersionNum).HasMaxLength(50);
        builder.Property(x => x.PlayVersionNum).HasMaxLength(50);
        builder.Property(x => x.ParticipationMode).HasMaxLength(20).IsRequired().HasDefaultValue(ReviewTaskShotParticipationModes.Review);
        builder.Property(x => x.Status).HasMaxLength(50).IsRequired();

        builder.HasOne(x => x.ReviewTask)
            .WithMany(x => x.Shots)
            .HasForeignKey(x => x.ReviewTaskId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Lens)
            .WithMany()
            .HasForeignKey(x => x.LensId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.ReviewTaskId);
        builder.HasIndex(x => x.LensId);
        builder.HasIndex(x => new { x.ReviewTaskId, x.Sequence }).IsUnique();
        builder.HasIndex(x => new { x.ReviewTaskId, x.LensId }).IsUnique();

        builder.Property(x => x.LatestFeedbackId).HasColumnType("uuid");
    }
}
