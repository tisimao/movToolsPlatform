using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class ReviewFeedbackRoundConfiguration : IEntityTypeConfiguration<ReviewFeedbackRound>
{
    public void Configure(EntityTypeBuilder<ReviewFeedbackRound> builder)
    {
        builder.ToTable("review_feedback_rounds");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.DrawingFramesJson).HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.RowVersion).IsConcurrencyToken();

        builder.HasOne(x => x.ReviewTask)
            .WithMany()
            .HasForeignKey(x => x.ReviewTaskId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Lens)
            .WithMany()
            .HasForeignKey(x => x.LensId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => x.FeedbackRoundId).IsUnique();
        builder.HasIndex(x => new { x.ReviewTaskId, x.LensId, x.FeedbackRoundId }).IsUnique();
        builder.HasIndex(x => new { x.ReviewTaskId, x.LensId });
        builder.HasIndex(x => x.LatestFeedbackAtUtc);
    }
}
