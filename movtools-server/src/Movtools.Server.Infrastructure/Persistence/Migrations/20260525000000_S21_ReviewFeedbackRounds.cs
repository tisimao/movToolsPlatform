using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations;

[DbContext(typeof(MovtoolsDbContext))]
[Migration("20260525000000_S21_ReviewFeedbackRounds")]
public partial class S21_ReviewFeedbackRounds : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<Guid>(
            name: "FeedbackRoundId",
            table: "review_comments",
            type: "uuid",
            nullable: true);

        migrationBuilder.CreateTable(
            name: "review_feedback_rounds",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                ReviewTaskId = table.Column<Guid>(type: "uuid", nullable: false),
                LensId = table.Column<Guid>(type: "uuid", nullable: false),
                FeedbackRoundId = table.Column<Guid>(type: "uuid", nullable: false),
                DrawingFramesJson = table.Column<string>(type: "jsonb", nullable: false),
                FeedbackCount = table.Column<int>(type: "integer", nullable: false),
                LatestFeedbackAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                RowVersion = table.Column<long>(type: "bigint", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_review_feedback_rounds", x => x.Id);
                table.ForeignKey(
                    name: "FK_review_feedback_rounds_lenses_LensId",
                    column: x => x.LensId,
                    principalTable: "lenses",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_review_feedback_rounds_review_tasks_ReviewTaskId",
                    column: x => x.ReviewTaskId,
                    principalTable: "review_tasks",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_review_comments_FeedbackRoundId",
            table: "review_comments",
            column: "FeedbackRoundId");

        migrationBuilder.CreateIndex(
            name: "IX_review_feedback_rounds_FeedbackRoundId",
            table: "review_feedback_rounds",
            column: "FeedbackRoundId",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_review_feedback_rounds_LatestFeedbackAtUtc",
            table: "review_feedback_rounds",
            column: "LatestFeedbackAtUtc");

        migrationBuilder.CreateIndex(
            name: "IX_review_feedback_rounds_ReviewTaskId_LensId",
            table: "review_feedback_rounds",
            columns: new[] { "ReviewTaskId", "LensId" });

        migrationBuilder.CreateIndex(
            name: "IX_review_feedback_rounds_ReviewTaskId_LensId_FeedbackRoundId",
            table: "review_feedback_rounds",
            columns: new[] { "ReviewTaskId", "LensId", "FeedbackRoundId" },
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "review_feedback_rounds");

        migrationBuilder.DropIndex(
            name: "IX_review_comments_FeedbackRoundId",
            table: "review_comments");

        migrationBuilder.DropColumn(
            name: "FeedbackRoundId",
            table: "review_comments");
    }
}
