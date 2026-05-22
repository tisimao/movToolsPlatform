using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Movtools.Server.Infrastructure.Persistence;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    [DbContext(typeof(MovtoolsDbContext))]
    [Migration("20260425000000_S09_LensFileBindingSync")]
    public partial class S09_LensFileBindingSync : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "lens_file_bindings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LensId = table.Column<Guid>(type: "uuid", nullable: false),
                    LensCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    BindingType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    RelativePath = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    SourceRoot = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    VersionNum = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    FileName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lens_file_bindings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_lens_file_bindings_lenses_LensId",
                        column: x => x.LensId,
                        principalTable: "lenses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_lens_file_bindings_LensId",
                table: "lens_file_bindings",
                column: "LensId");

            migrationBuilder.CreateIndex(
                name: "IX_lens_file_bindings_LensId_BindingType",
                table: "lens_file_bindings",
                columns: new[] { "LensId", "BindingType" },
                unique: true,
                filter: "\"VersionNum\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_lens_file_bindings_LensId_BindingType_VersionNum",
                table: "lens_file_bindings",
                columns: new[] { "LensId", "BindingType", "VersionNum" },
                unique: true,
                filter: "\"VersionNum\" IS NOT NULL");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "lens_file_bindings");
        }
    }
}
