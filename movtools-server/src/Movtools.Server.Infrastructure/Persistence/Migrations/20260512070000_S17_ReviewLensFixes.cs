using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class S17_ReviewLensFixes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "LensId",
                table: "review_tasks",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<Guid>(
                name: "LensId",
                table: "review_comments",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_review_comments_LensId",
                table: "review_comments",
                column: "LensId");

            migrationBuilder.AddForeignKey(
                name: "FK_review_comments_lenses_LensId",
                table: "review_comments",
                column: "LensId",
                principalTable: "lenses",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_review_comments_lenses_LensId",
                table: "review_comments");

            migrationBuilder.DropIndex(
                name: "IX_review_comments_LensId",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "LensId",
                table: "review_comments");

            migrationBuilder.AlterColumn<Guid>(
                name: "LensId",
                table: "review_tasks",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
