using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    public partial class S13_LensVersionNum : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "VersionNum",
                table: "lenses",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "V01");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "VersionNum",
                table: "lenses");
        }
    }
}
