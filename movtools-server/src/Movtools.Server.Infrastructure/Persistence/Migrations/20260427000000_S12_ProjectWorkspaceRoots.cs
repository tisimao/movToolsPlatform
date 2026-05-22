using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Movtools.Server.Infrastructure.Persistence;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations;

[DbContext(typeof(MovtoolsDbContext))]
[Migration("20260427000000_S12_ProjectWorkspaceRoots")]
public sealed class S12_ProjectWorkspaceRoots : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "InitExcelPath",
            table: "projects",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "LensRootsJson",
            table: "projects",
            type: "text",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "LayoutRootsJson",
            table: "projects",
            type: "text",
            nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "InitExcelPath",
            table: "projects");

        migrationBuilder.DropColumn(
            name: "LensRootsJson",
            table: "projects");

        migrationBuilder.DropColumn(
            name: "LayoutRootsJson",
            table: "projects");
    }
}
