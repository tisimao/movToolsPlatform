using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    public partial class S23_ReviewTaskShotParticipationModeNoDefault : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "ParticipationMode",
                table: "review_task_shots",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20,
                oldDefaultValue: "review");

            migrationBuilder.Sql("ALTER TABLE review_task_shots ALTER COLUMN \"ParticipationMode\" DROP DEFAULT;");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE review_task_shots ALTER COLUMN \"ParticipationMode\" SET DEFAULT 'review';");

            migrationBuilder.AlterColumn<string>(
                name: "ParticipationMode",
                table: "review_task_shots",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "review",
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20);
        }
    }
}
