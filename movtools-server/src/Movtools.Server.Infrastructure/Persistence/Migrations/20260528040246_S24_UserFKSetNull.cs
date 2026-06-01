using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class S24_UserFKSetNull : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_lens_status_histories_users_ChangedByUserId",
                table: "lens_status_histories");

            migrationBuilder.DropForeignKey(
                name: "FK_review_comments_users_CreatedByUserId",
                table: "review_comments");

            migrationBuilder.DropForeignKey(
                name: "FK_review_tasks_users_CreatedByUserId",
                table: "review_tasks");

            migrationBuilder.AlterColumn<Guid>(
                name: "CreatedByUserId",
                table: "review_tasks",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "CreatedByUserId",
                table: "review_comments",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "ChangedByUserId",
                table: "lens_status_histories",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddForeignKey(
                name: "FK_lens_status_histories_users_ChangedByUserId",
                table: "lens_status_histories",
                column: "ChangedByUserId",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_review_comments_users_CreatedByUserId",
                table: "review_comments",
                column: "CreatedByUserId",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_review_tasks_users_CreatedByUserId",
                table: "review_tasks",
                column: "CreatedByUserId",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_lens_status_histories_users_ChangedByUserId",
                table: "lens_status_histories");

            migrationBuilder.DropForeignKey(
                name: "FK_review_comments_users_CreatedByUserId",
                table: "review_comments");

            migrationBuilder.DropForeignKey(
                name: "FK_review_tasks_users_CreatedByUserId",
                table: "review_tasks");

            migrationBuilder.AlterColumn<Guid>(
                name: "CreatedByUserId",
                table: "review_tasks",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "CreatedByUserId",
                table: "review_comments",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "ChangedByUserId",
                table: "lens_status_histories",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_lens_status_histories_users_ChangedByUserId",
                table: "lens_status_histories",
                column: "ChangedByUserId",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_review_comments_users_CreatedByUserId",
                table: "review_comments",
                column: "CreatedByUserId",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_review_tasks_users_CreatedByUserId",
                table: "review_tasks",
                column: "CreatedByUserId",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
