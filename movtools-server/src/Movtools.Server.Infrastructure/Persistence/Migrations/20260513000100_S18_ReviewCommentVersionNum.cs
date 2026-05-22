using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Movtools.Server.Infrastructure.Persistence;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations;

[DbContext(typeof(MovtoolsDbContext))]
[Migration("20260513000100_S18_ReviewCommentVersionNum")]
public partial class S18_ReviewCommentVersionNum : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "VersionNum",
            table: "review_comments",
            type: "character varying(50)",
            maxLength: 50,
            nullable: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "VersionNum",
            table: "review_comments");
    }
}
