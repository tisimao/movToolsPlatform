using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations;

[DbContext(typeof(MovtoolsDbContext))]
[Migration("20260515000000_S19_Batch19")]
public partial class S19_Batch19 : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "lens_repair_attachments",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                LensId = table.Column<Guid>(type: "uuid", nullable: false),
                LensStatusHistoryId = table.Column<Guid>(type: "uuid", nullable: true),
                FileName = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                OriginalName = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                ContentType = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                FileSize = table.Column<long>(type: "bigint", nullable: false),
                SortOrder = table.Column<int>(type: "integer", nullable: false),
                StorageRelativePath = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_lens_repair_attachments", x => x.Id);
                table.ForeignKey(
                    name: "FK_lens_repair_attachments_lenses_LensId",
                    column: x => x.LensId,
                    principalTable: "lenses",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_lens_repair_attachments_lens_status_histories_LensStatusHis~",
                    column: x => x.LensStatusHistoryId,
                    principalTable: "lens_status_histories",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.SetNull);
            });

        migrationBuilder.AddColumn<Guid>(
            name: "TaskShotId",
            table: "review_comments",
            type: "uuid",
            nullable: true);

        migrationBuilder.AddColumn<Guid>(
            name: "LatestFeedbackId",
            table: "review_task_shots",
            type: "uuid",
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_review_comments_TaskShotId",
            table: "review_comments",
            column: "TaskShotId");

        migrationBuilder.CreateIndex(
            name: "IX_lens_repair_attachments_LensId",
            table: "lens_repair_attachments",
            column: "LensId");

        migrationBuilder.CreateIndex(
            name: "IX_lens_repair_attachments_LensStatusHistoryId",
            table: "lens_repair_attachments",
            column: "LensStatusHistoryId");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "lens_repair_attachments");

        migrationBuilder.DropColumn(
            name: "TaskShotId",
            table: "review_comments");

        migrationBuilder.DropColumn(
            name: "LatestFeedbackId",
            table: "review_task_shots");
    }
}
