using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Persistence.Configurations;

public sealed class ReviewTaskConfiguration : IEntityTypeConfiguration<ReviewTask>
{
    public void Configure(EntityTypeBuilder<ReviewTask> builder)
    {
        builder.ToTable("review_tasks");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.ProjectCode).HasMaxLength(50).IsRequired();
        builder.Property(x => x.EpisodeCode).HasMaxLength(50);
        builder.Property(x => x.Name).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Description).HasMaxLength(2000);
        builder.Property(x => x.Status).HasMaxLength(50).IsRequired();
        builder.Property(x => x.ResultComment).HasMaxLength(2000);
        builder.Property(x => x.SubmittedAtUtc);
        builder.Property(x => x.CompletedAtUtc);
        builder.Property(x => x.DueAtUtc);
        
        builder.HasOne(x => x.DirectorUser)
            .WithMany()
            .HasForeignKey(x => x.DirectorUserId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasOne(x => x.Lens)
            .WithMany()
            .HasForeignKey(x => x.LensId)
            .IsRequired(false)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.AssignedToUser)
            .WithMany()
            .HasForeignKey(x => x.AssignedToUserId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasOne(x => x.CreatedByUser)
            .WithMany()
            .HasForeignKey(x => x.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.LensId);
        builder.HasIndex(x => x.Status);
        builder.HasIndex(x => x.ProjectCode);
    }
}
