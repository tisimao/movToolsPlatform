using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class S0607_ProjectEpisodeLens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameIndex(
                name: "ix_users_normalized_user_name",
                table: "users",
                newName: "IX_users_normalized_user_name");

            migrationBuilder.RenameIndex(
                name: "ix_roles_code",
                table: "roles",
                newName: "IX_roles_code");

            migrationBuilder.RenameIndex(
                name: "ix_project_members_project_code_user_id",
                table: "project_members",
                newName: "IX_project_members_project_code_user_id");

            migrationBuilder.CreateTable(
                name: "activity_logs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    OldValue = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    NewValue = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Sequence = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_activity_logs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_activity_logs_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "projects",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    VersionTag = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    LayoutTag = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    RowVersion = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_projects", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "episodes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Sequence = table.Column<int>(type: "integer", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    RowVersion = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_episodes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_episodes_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "lenses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    EpisodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Sequence = table.Column<int>(type: "integer", nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    RootCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    LogicalPath = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    VersionTag = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    LayoutTag = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Comment = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    RowVersion = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lenses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_lenses_episodes_EpisodeId",
                        column: x => x.EpisodeId,
                        principalTable: "episodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "lens_status_histories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LensId = table.Column<Guid>(type: "uuid", nullable: false),
                    FromStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ToStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ChangedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Comment = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lens_status_histories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_lens_status_histories_lenses_LensId",
                        column: x => x.LensId,
                        principalTable: "lenses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_lens_status_histories_users_ChangedByUserId",
                        column: x => x.ChangedByUserId,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_activity_logs_CreatedAtUtc",
                table: "activity_logs",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_activity_logs_EntityType_EntityId",
                table: "activity_logs",
                columns: new[] { "EntityType", "EntityId" });

            migrationBuilder.CreateIndex(
                name: "IX_activity_logs_Sequence",
                table: "activity_logs",
                column: "Sequence");

            migrationBuilder.CreateIndex(
                name: "IX_activity_logs_UserId",
                table: "activity_logs",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_episodes_ProjectId_Code",
                table: "episodes",
                columns: new[] { "ProjectId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_lens_status_histories_ChangedByUserId",
                table: "lens_status_histories",
                column: "ChangedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_lens_status_histories_LensId",
                table: "lens_status_histories",
                column: "LensId");

            migrationBuilder.CreateIndex(
                name: "IX_lenses_EpisodeId_Code",
                table: "lenses",
                columns: new[] { "EpisodeId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_projects_Code",
                table: "projects",
                column: "Code",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "activity_logs");

            migrationBuilder.DropTable(
                name: "lens_status_histories");

            migrationBuilder.DropTable(
                name: "lenses");

            migrationBuilder.DropTable(
                name: "episodes");

            migrationBuilder.DropTable(
                name: "projects");

            migrationBuilder.RenameIndex(
                name: "IX_users_normalized_user_name",
                table: "users",
                newName: "ix_users_normalized_user_name");

            migrationBuilder.RenameIndex(
                name: "IX_roles_code",
                table: "roles",
                newName: "ix_roles_code");

            migrationBuilder.RenameIndex(
                name: "IX_project_members_project_code_user_id",
                table: "project_members",
                newName: "ix_project_members_project_code_user_id");
        }
    }
}
