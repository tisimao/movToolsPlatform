using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class S16_ReviewFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CompletedAtUtc",
                table: "review_tasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "review_tasks",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DirectorUserId",
                table: "review_tasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DueAtUtc",
                table: "review_tasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EpisodeCode",
                table: "review_tasks",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "EpisodeId",
                table: "review_tasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "review_tasks",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ProjectCode",
                table: "review_tasks",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "SubmittedAtUtc",
                table: "review_tasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LensId",
                table: "review_comments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "LensId",
                table: "review_tasks",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "AnnotatedImagePath",
                table: "review_comments",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AnnotationDataJson",
                table: "review_comments",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DecisionCode",
                table: "review_comments",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FrameImagePath",
                table: "review_comments",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FrameNumber",
                table: "review_comments",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TagsJson",
                table: "review_comments",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ThumbnailPath",
                table: "review_comments",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Timecode",
                table: "review_comments",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InternalReviewStatusCode",
                table: "lenses",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "NOT_IN_REVIEW");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "InternalReviewUpdatedAtUtc",
                table: "lenses",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LatestDirectorFeedbackAtUtc",
                table: "lenses",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LatestReviewTaskId",
                table: "lenses",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PendingDirectorFeedbackCount",
                table: "lenses",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "review_task_shots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ReviewTaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    LensId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<int>(type: "integer", nullable: false),
                    SubmitVersionNum = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    PlayVersionNum = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    FeedbackCount = table.Column<int>(type: "integer", nullable: false),
                    LastFeedbackAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_review_task_shots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_review_task_shots_lenses_LensId",
                        column: x => x.LensId,
                        principalTable: "lenses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_review_task_shots_review_tasks_ReviewTaskId",
                        column: x => x.ReviewTaskId,
                        principalTable: "review_tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_review_tasks_DirectorUserId",
                table: "review_tasks",
                column: "DirectorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_review_tasks_ProjectCode",
                table: "review_tasks",
                column: "ProjectCode");

            migrationBuilder.CreateIndex(
                name: "IX_review_task_shots_LensId",
                table: "review_task_shots",
                column: "LensId");

            migrationBuilder.CreateIndex(
                name: "IX_review_task_shots_ReviewTaskId",
                table: "review_task_shots",
                column: "ReviewTaskId");

            migrationBuilder.CreateIndex(
                name: "IX_review_task_shots_ReviewTaskId_Sequence",
                table: "review_task_shots",
                columns: new[] { "ReviewTaskId", "Sequence" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_review_tasks_users_DirectorUserId",
                table: "review_tasks",
                column: "DirectorUserId",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_review_tasks_users_DirectorUserId",
                table: "review_tasks");

            migrationBuilder.DropTable(
                name: "review_task_shots");

            migrationBuilder.DropIndex(
                name: "IX_review_tasks_DirectorUserId",
                table: "review_tasks");

            migrationBuilder.DropIndex(
                name: "IX_review_tasks_ProjectCode",
                table: "review_tasks");

            migrationBuilder.DropColumn(
                name: "CompletedAtUtc",
                table: "review_tasks");

            migrationBuilder.DropColumn(
                name: "Description",
                table: "review_tasks");

            migrationBuilder.DropColumn(
                name: "DirectorUserId",
                table: "review_tasks");

            migrationBuilder.DropColumn(
                name: "DueAtUtc",
                table: "review_tasks");

            migrationBuilder.DropColumn(
                name: "EpisodeCode",
                table: "review_tasks");

            migrationBuilder.DropColumn(
                name: "EpisodeId",
                table: "review_tasks");

            migrationBuilder.DropColumn(
                name: "Name",
                table: "review_tasks");

            migrationBuilder.DropColumn(
                name: "ProjectCode",
                table: "review_tasks");

            migrationBuilder.DropColumn(
                name: "SubmittedAtUtc",
                table: "review_tasks");

            migrationBuilder.DropColumn(
                name: "LensId",
                table: "review_comments");

            migrationBuilder.AlterColumn<Guid>(
                name: "LensId",
                table: "review_tasks",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.DropColumn(
                name: "AnnotatedImagePath",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "AnnotationDataJson",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "DecisionCode",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "FrameImagePath",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "FrameNumber",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "TagsJson",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "ThumbnailPath",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "Timecode",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "InternalReviewStatusCode",
                table: "lenses");

            migrationBuilder.DropColumn(
                name: "InternalReviewUpdatedAtUtc",
                table: "lenses");

            migrationBuilder.DropColumn(
                name: "LatestDirectorFeedbackAtUtc",
                table: "lenses");

            migrationBuilder.DropColumn(
                name: "LatestReviewTaskId",
                table: "lenses");

            migrationBuilder.DropColumn(
                name: "PendingDirectorFeedbackCount",
                table: "lenses");
        }
    }
}
