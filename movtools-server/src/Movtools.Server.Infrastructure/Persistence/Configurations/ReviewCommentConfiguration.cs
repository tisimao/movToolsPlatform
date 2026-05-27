using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class ReviewCommentConfiguration : IEntityTypeConfiguration<ReviewComment>
{
    public void Configure(EntityTypeBuilder<ReviewComment> builder)
    {
        builder.ToTable("review_comments");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Content).HasMaxLength(4000).IsRequired();
        builder.Property(x => x.CreatedByUserName).HasMaxLength(100);
        builder.Property(x => x.VersionNum).HasMaxLength(50);
        builder.Property(x => x.FrameImagePath).HasMaxLength(500);
        builder.Property(x => x.AnnotatedImagePath).HasMaxLength(500);
        builder.Property(x => x.ThumbnailPath).HasMaxLength(500);
        builder.Property(x => x.AnnotationDataJson).HasColumnType("jsonb");
        builder.Property(x => x.FeedbackRoundId).HasColumnType("uuid");
        builder.Property(x => x.DecisionCode).HasMaxLength(50);
        builder.Property(x => x.Timecode).HasMaxLength(50);
        builder.Property(x => x.TagsJson).HasColumnType("jsonb");

        builder.HasOne(x => x.Lens)
            .WithMany()
            .HasForeignKey(x => x.LensId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasOne(x => x.ReviewTask)
            .WithMany(x => x.Comments)
            .HasForeignKey(x => x.ReviewTaskId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.CreatedByUser)
            .WithMany()
            .HasForeignKey(x => x.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.ReviewTaskId);
        builder.HasIndex(x => x.LensId);
        builder.HasIndex(x => x.CreatedByUserId);
        builder.HasIndex(x => x.TaskShotId);
        builder.HasIndex(x => x.FeedbackRoundId);

        builder.Property(x => x.TaskShotId).HasColumnType("uuid");
    }
}
