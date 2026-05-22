using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Movtools.Server.Infrastructure.Persistence;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(MovtoolsDbContext))]
    [Migration("20260506070000_S15_BackfillLensVersionNum")]
    public partial class S15_BackfillLensVersionNum : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "VersionNum",
                table: "lenses",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "V01",
                oldClrType: typeof(string),
                oldType: "character varying(50)",
                oldMaxLength: 50,
                oldNullable: true,
                oldDefaultValue: "V01");

            migrationBuilder.Sql("UPDATE lenses SET \"VersionNum\" = 'V01' WHERE \"VersionNum\" IS NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "VersionNum",
                table: "lenses",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(50)",
                oldMaxLength: 50);
        }
    }
}
