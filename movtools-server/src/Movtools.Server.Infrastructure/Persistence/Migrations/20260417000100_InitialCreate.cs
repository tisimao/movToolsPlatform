using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Movtools.Server.Infrastructure.Persistence;

#nullable disable

namespace Movtools.Server.Infrastructure.Persistence.Migrations;

[DbContext(typeof(MovtoolsDbContext))]
[Migration("20260417000100_InitialCreate")]
public partial class InitialCreate : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "roles",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                is_system = table.Column<bool>(type: "boolean", nullable: false),
                created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_roles", x => x.id);
            });

        migrationBuilder.CreateTable(
            name: "users",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                user_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                normalized_user_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                password_hash = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_users", x => x.id);
            });

        migrationBuilder.CreateTable(
            name: "project_members",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                project_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                user_id = table.Column<Guid>(type: "uuid", nullable: false),
                project_role_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_project_members", x => x.id);
                table.ForeignKey(
                    name: "fk_project_members_users_user_id",
                    column: x => x.user_id,
                    principalTable: "users",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "user_roles",
            columns: table => new
            {
                user_id = table.Column<Guid>(type: "uuid", nullable: false),
                role_id = table.Column<Guid>(type: "uuid", nullable: false),
                created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_user_roles", x => new { x.user_id, x.role_id });
                table.ForeignKey(
                    name: "fk_user_roles_roles_role_id",
                    column: x => x.role_id,
                    principalTable: "roles",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "fk_user_roles_users_user_id",
                    column: x => x.user_id,
                    principalTable: "users",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "ix_roles_code",
            table: "roles",
            column: "code",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "ix_project_members_project_code_user_id",
            table: "project_members",
            columns: new[] { "project_code", "user_id" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "ix_project_members_user_id",
            table: "project_members",
            column: "user_id");

        migrationBuilder.CreateIndex(
            name: "ix_users_normalized_user_name",
            table: "users",
            column: "normalized_user_name",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "ix_user_roles_role_id",
            table: "user_roles",
            column: "role_id");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "project_members");
        migrationBuilder.DropTable(name: "user_roles");
        migrationBuilder.DropTable(name: "roles");
        migrationBuilder.DropTable(name: "users");
    }
}
