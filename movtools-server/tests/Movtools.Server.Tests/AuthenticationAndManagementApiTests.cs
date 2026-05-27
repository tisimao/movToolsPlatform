using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Infrastructure.Persistence;
using Movtools.Server.Infrastructure.Services;

namespace Movtools.Server.Tests;

[Collection("postgres integration")]
public sealed class AuthenticationAndManagementApiTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly PostgresFixture _fixture;

    public AuthenticationAndManagementApiTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task Migration_can_run_twice_without_breaking_structure()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();

        await dbContext.Database.MigrateAsync();
        await dbContext.Database.MigrateAsync();

        Assert.True(await dbContext.Database.CanConnectAsync());
        Assert.Contains(await dbContext.Database.GetAppliedMigrationsAsync(), migration => migration.Contains("InitialCreate", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Login_current_user_and_protected_endpoints_work()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var client = factory.CreateClient();

        var login = await LoginAsync(client, "admin", DatabaseSeeder.AdminPassword);
        Assert.NotEmpty(login.AccessToken);

        var meResponse = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, meResponse.StatusCode);

        using var authedClient = factory.CreateClient();
        authedClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);

        var me = await authedClient.GetFromJsonAsync<CurrentUserResponse>("/api/auth/me", JsonOptions);
        Assert.NotNull(me);
        Assert.Equal("admin", me!.UserName);
    }

    [Fact]
    public async Task Wrong_password_is_rejected()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest("admin", "wrong-password"), JsonOptions);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_access_is_denied()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/users");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task User_creation_role_assignment_and_project_membership_work()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var createdUser = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("alice", "Alice", "Alice@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        Assert.NotNull(createdUser);

        var assigned = await adminClient.PostAsJsonAsync($"/api/users/{createdUser!.UserId}/roles", new AssignRolesRequest(["maker"]), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        Assert.NotNull(assigned);
        Assert.Contains("maker", assigned!.Roles);

        var member = await adminClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest("project-a", createdUser.UserId, "maker"), JsonOptions)
            .ReadAsJsonAsync<ProjectMemberResponse>(JsonOptions);
        Assert.NotNull(member);
        Assert.Equal("project-a", member!.ProjectCode);
    }

    [Fact]
    public async Task Producer_can_list_users_for_project_member_selection()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        var producerUser = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("producer-list", "Producer List", "Producer@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        Assert.NotNull(producerUser);

        await adminClient.PostAsJsonAsync($"/api/users/{producerUser!.UserId}/roles", new AssignRolesRequest(["producer"]), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);

        using var producerClient = factory.CreateClient();
        var login = await LoginAsync(producerClient, "producer-list", "Producer@123456");
        producerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);

        var response = await producerClient.GetAsync("/api/users");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task User_update_and_role_replacement_work()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var createdUser = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("carol", "Carol", "Carol@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        Assert.NotNull(createdUser);

        var updatedUser = await adminClient.PutAsJsonAsync($"/api/users/{createdUser!.UserId}", new UpdateUserRequest("carol-new", "Carol New", null, false), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        Assert.NotNull(updatedUser);
        Assert.Equal("carol-new", updatedUser!.UserName);
        Assert.Equal("Carol New", updatedUser.DisplayName);
        Assert.False(updatedUser.IsActive);

        var firstRoles = await adminClient.PostAsJsonAsync($"/api/users/{createdUser.UserId}/roles", new AssignRolesRequest(["maker"]), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        Assert.Equal(["maker"], firstRoles!.Roles);

        var replacedRoles = await adminClient.PostAsJsonAsync($"/api/users/{createdUser.UserId}/roles", new AssignRolesRequest(["director"]), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        Assert.Equal(["director"], replacedRoles!.Roles);
    }

    [Fact]
    public async Task Producer_can_create_project_and_see_it_in_workspace()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        var producerUser = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("producer1", "Producer 1", "Producer@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        Assert.NotNull(producerUser);

        await adminClient.PostAsJsonAsync($"/api/users/{producerUser!.UserId}/roles", new AssignRolesRequest(["producer"]), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);

        using var producerClient = factory.CreateClient();
        var login = await LoginAsync(producerClient, "producer1", "Producer@123456");
        producerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);

        var createdProject = await producerClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("proj-collab", "协同项目", null, "ANI", "LAY"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        Assert.NotNull(createdProject);
        Assert.Equal("PROJ-COLLAB", createdProject!.Code);
        Assert.Equal(30, createdProject.ProjectDefaultFps);

        var projects = await producerClient.GetFromJsonAsync<IReadOnlyList<ProjectResponse>>("/api/projects", JsonOptions);
        Assert.NotNull(projects);
        Assert.Contains(projects!, project => project.Code == "PROJ-COLLAB");
        Assert.Contains(projects!, project => project.Code == "PROJ-COLLAB" && project.ProjectDefaultFps == 30);
    }

    [Fact]
    public async Task Deleted_project_code_can_be_reused()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        var producerUser = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("producer-reuse", "Producer Reuse", "Producer@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        Assert.NotNull(producerUser);

        await adminClient.PostAsJsonAsync($"/api/users/{producerUser!.UserId}/roles", new AssignRolesRequest(["producer"]), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);

        using var producerClient = factory.CreateClient();
        var login = await LoginAsync(producerClient, "producer-reuse", "Producer@123456");
        producerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);

        var createdProject = await producerClient.PostAsJsonAsync(
            "/api/projects",
            new ProjectCreateRequest("reuse-proj", "Reusable Project", null, "ANI", "LAY", "EP01", "Episode 1"),
            JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        Assert.NotNull(createdProject);

        var deleteResponse = await producerClient.DeleteAsync("/api/projects/REUSE-PROJ");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var recreatedProject = await producerClient.PostAsJsonAsync(
            "/api/projects",
            new ProjectCreateRequest("reuse-proj", "Reusable Project Again", null, "ANI", "LAY", "EP01", "Episode 1"),
            JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        Assert.NotNull(recreatedProject);
        Assert.Equal("REUSE-PROJ", recreatedProject!.Project.Code);
    }

    [Fact]
    public async Task Non_admin_users_cannot_call_admin_endpoints()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        var createdUser = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("bob", "Bob", "Bob@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);

        using var userClient = factory.CreateClient();
        var login = await LoginAsync(userClient, "bob", "Bob@123456");
        userClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);

        var denied = await userClient.GetAsync("/api/users");
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
    }

    [Fact]
    public async Task Roles_endpoint_returns_display_name()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var roles = await adminClient.GetFromJsonAsync<IReadOnlyList<RoleResponse>>("/api/roles", JsonOptions);
        Assert.NotNull(roles);
        Assert.Contains(roles!, role => role.DisplayName == "制片");
        Assert.All(roles!, role => Assert.False(string.IsNullOrWhiteSpace(role.DisplayName)));
    }

    private ServerApiFactory CreateFactory() => new();

    private async Task ResetDatabaseAsync(ServerApiFactory factory)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        var seeder = scope.ServiceProvider.GetRequiredService<DatabaseSeeder>();

        await dbContext.Database.MigrateAsync();
        await dbContext.Database.ExecuteSqlRawAsync("""
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '__EFMigrationsHistory'
  ) LOOP
    EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE;', r.tablename);
  END LOOP;
END $$;
""");
        await seeder.SeedCoreDataAsync();
    }

    private async Task<HttpClient> CreateAdminClientAsync(ServerApiFactory factory)
    {
        var client = factory.CreateClient();
        var login = await LoginAsync(client, "admin", DatabaseSeeder.AdminPassword);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        return client;
    }

    private static async Task<LoginResponse> LoginAsync(HttpClient client, string userName, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(userName, password), JsonOptions);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<LoginResponse>(JsonOptions))!;
    }
}

internal static class HttpResponseMessageExtensions
{
    public static async Task<T?> ReadAsJsonAsync<T>(this Task<HttpResponseMessage> responseTask, JsonSerializerOptions options)
    {
        var response = await responseTask;
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            throw new HttpRequestException($"Response status code does not indicate success: {(int)response.StatusCode} ({response.StatusCode}). Body: {body}");
        }

        return await response.Content.ReadFromJsonAsync<T>(options);
    }
}
