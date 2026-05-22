using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class S14_LensVersionNum : Migration
    {
        /// <inheritdoc />
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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "VersionNum",
                table: "lenses");
        }
    }
}
