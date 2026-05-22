using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations;

[DbContext(typeof(MovtoolsDbContext))]
[Migration("20260522000000_S20_ReviewTaskShotParticipationMode")]
public partial class S20_ReviewTaskShotParticipationMode : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "ParticipationMode",
            table: "review_task_shots",
            type: "character varying(20)",
            maxLength: 20,
            nullable: false,
            defaultValue: "review");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "ParticipationMode",
            table: "review_task_shots");
    }
}
