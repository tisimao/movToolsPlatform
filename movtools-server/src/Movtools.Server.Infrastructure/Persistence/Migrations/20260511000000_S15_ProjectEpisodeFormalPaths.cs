using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Movtools.Server.Infrastructure.Persistence;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    [DbContext(typeof(MovtoolsDbContext))]
    [Migration("20260511000000_S15_ProjectEpisodeFormalPaths")]
    public partial class S15_ProjectEpisodeFormalPaths : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
        migrationBuilder.AddColumn<string>(
            name: "ProjectRootPath",
            table: "projects",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "LensFolderRootPath",
            table: "projects",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "MaCheckPath",
            table: "projects",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "MovCheckPath",
            table: "projects",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "LayoutCheckPath",
            table: "projects",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "LensFolderRootPath",
            table: "episodes",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "LayoutCheckPath",
            table: "episodes",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.Sql("""
UPDATE projects
SET "ProjectRootPath" = CASE
    WHEN "ProjectRootPath" IS NULL AND "Description" ~ '^[A-Za-z]:[\\/].+' THEN "Description"
    ELSE "ProjectRootPath"
END,
"Description" = CASE
    WHEN "ProjectRootPath" IS NULL AND "Description" ~ '^[A-Za-z]:[\\/].+' THEN NULL
    ELSE "Description"
END;
UPDATE projects
SET "LensFolderRootPath" = COALESCE("LensFolderRootPath", "ProjectRootPath")
WHERE "LensFolderRootPath" IS NULL AND "ProjectRootPath" IS NOT NULL;
UPDATE episodes
SET "LensFolderRootPath" = COALESCE(episodes."LensFolderRootPath", p."LensFolderRootPath", p."ProjectRootPath"),
    "LayoutCheckPath" = COALESCE(episodes."LayoutCheckPath", p."LayoutCheckPath")
FROM projects p
WHERE episodes."ProjectId" = p."Id";
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "ProjectRootPath", table: "projects");
            migrationBuilder.DropColumn(name: "LensFolderRootPath", table: "projects");
            migrationBuilder.DropColumn(name: "MaCheckPath", table: "projects");
            migrationBuilder.DropColumn(name: "MovCheckPath", table: "projects");
            migrationBuilder.DropColumn(name: "LayoutCheckPath", table: "projects");
            migrationBuilder.DropColumn(name: "LensFolderRootPath", table: "episodes");
            migrationBuilder.DropColumn(name: "LayoutCheckPath", table: "episodes");
        }
    }
}
