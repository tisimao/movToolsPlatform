using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Movtools.Server.Infrastructure.Persistence;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(MovtoolsDbContext))]
    [Migration("20260425010000_S10_LensSingleFrameAndMaker")]
    public partial class S10_LensSingleFrameAndMaker : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SingleFrame",
                table: "lenses",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Maker",
                table: "lenses",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SingleFrame",
                table: "lenses");

            migrationBuilder.DropColumn(
                name: "Maker",
                table: "lenses");
        }
    }
}
