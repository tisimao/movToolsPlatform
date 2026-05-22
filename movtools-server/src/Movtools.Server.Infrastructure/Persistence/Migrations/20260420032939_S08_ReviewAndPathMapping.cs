using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class S08_ReviewAndPathMapping : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "client_nodes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ClientName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    MachineName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_client_nodes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_client_nodes_users_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "review_tasks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LensId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ResultComment = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    AssignedToUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    RowVersion = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_review_tasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_review_tasks_lenses_LensId",
                        column: x => x.LensId,
                        principalTable: "lenses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_review_tasks_users_AssignedToUserId",
                        column: x => x.AssignedToUserId,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_review_tasks_users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "storage_roots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_storage_roots", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "client_path_mappings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientNodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    RootCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LocalPath = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_client_path_mappings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_client_path_mappings_client_nodes_ClientNodeId",
                        column: x => x.ClientNodeId,
                        principalTable: "client_nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "review_comments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ReviewTaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Content = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    TimestampSeconds = table.Column<double>(type: "double precision", nullable: true),
                    CreatedByUserName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_review_comments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_review_comments_review_tasks_ReviewTaskId",
                        column: x => x.ReviewTaskId,
                        principalTable: "review_tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_review_comments_users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_client_nodes_ClientId",
                table: "client_nodes",
                column: "ClientId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_client_nodes_OwnerUserId",
                table: "client_nodes",
                column: "OwnerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_client_path_mappings_ClientNodeId_RootCode",
                table: "client_path_mappings",
                columns: new[] { "ClientNodeId", "RootCode" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_review_comments_CreatedByUserId",
                table: "review_comments",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_review_comments_ReviewTaskId",
                table: "review_comments",
                column: "ReviewTaskId");

            migrationBuilder.CreateIndex(
                name: "IX_review_tasks_AssignedToUserId",
                table: "review_tasks",
                column: "AssignedToUserId");

            migrationBuilder.CreateIndex(
                name: "IX_review_tasks_CreatedByUserId",
                table: "review_tasks",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_review_tasks_LensId",
                table: "review_tasks",
                column: "LensId");

            migrationBuilder.CreateIndex(
                name: "IX_review_tasks_Status",
                table: "review_tasks",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_storage_roots_Code",
                table: "storage_roots",
                column: "Code",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "client_path_mappings");

            migrationBuilder.DropTable(
                name: "review_comments");

            migrationBuilder.DropTable(
                name: "storage_roots");

            migrationBuilder.DropTable(
                name: "client_nodes");

            migrationBuilder.DropTable(
                name: "review_tasks");
        }
    }
}
