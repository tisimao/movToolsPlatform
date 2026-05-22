using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Movtools.Server.Infrastructure.Persistence;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(MovtoolsDbContext))]
    [Migration("20260425020000_S11_LensMakerAccountStatus")]
    public partial class S11_LensMakerAccountStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "MakerUserId",
                table: "lenses",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MakerNameRaw",
                table: "lenses",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MakerMatchStatus",
                table: "lenses",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "unassigned");

            migrationBuilder.Sql("""
                UPDATE lenses
                SET
                    "MakerNameRaw" = CASE
                        WHEN "Maker" IS NULL OR btrim("Maker") = '' THEN NULL
                        ELSE "Maker"
                    END,
                    "MakerMatchStatus" = CASE
                        WHEN "Maker" IS NULL OR btrim("Maker") = '' THEN 'unassigned'
                        ELSE 'unmatched'
                    END
            """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MakerUserId",
                table: "lenses");

            migrationBuilder.DropColumn(
                name: "MakerNameRaw",
                table: "lenses");

            migrationBuilder.DropColumn(
                name: "MakerMatchStatus",
                table: "lenses");
        }
    }
}
