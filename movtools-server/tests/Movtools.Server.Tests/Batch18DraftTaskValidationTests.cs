using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Movtools.Server.Application.Contracts.Auth;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Infrastructure.Persistence;
using Movtools.Server.Infrastructure.Services;

namespace Movtools.Server.Tests;

[Collection("postgres integration")]
public sealed class Batch18DraftTaskValidationTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly PostgresFixture _fixture;

    public Batch18DraftTaskValidationTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task Draft_task_rejects_nonexistent_director_id()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (project, episode) = await CreateProjectEpisodeAsync(adminClient, "DRAFT-DIRECTOR-TEST");

        var response = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project!.Code,
                episode!.Id,
                "Draft Task",
                Guid.NewGuid(),
                null,
                null,
                []),
            JsonOptions);

        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Draft_task_preserves_context_participation_mode()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (project, episode) = await CreateProjectEpisodeAsync(adminClient, "DRAFT-CONTEXT-TEST");
        var lens1 = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{episode!.Id}/lenses",
            new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
        var lens2 = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{episode.Id}/lenses",
            new LensCreateRequest("L002", "Lens 2", 2, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var response = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project!.Code,
                episode.Id,
                "Draft With Context",
                null,
                null,
                null,
                [lens1!.Id, lens2!.Id],
                [
                    new ReviewTaskShotCreateRequest(lens1.Id, 0, null, "review"),
                    new ReviewTaskShotCreateRequest(lens2.Id, 1, null, "context")
                ]),
            JsonOptions);

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = body.GetProperty("taskId").GetGuid();

        var detail = await adminClient.GetFromJsonAsync<JsonElement>($"/api/review-tasks/{taskId}/detail", JsonOptions);
        var shots = detail.GetProperty("shots").EnumerateArray().ToArray();

        Assert.Equal("review", shots[0].GetProperty("participationMode").GetString());
        Assert.Equal("context", shots[1].GetProperty("participationMode").GetString());
    }

    [Fact]
    public async Task Update_task_persists_context_participation_mode_changes()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (project, episode) = await CreateProjectEpisodeAsync(adminClient, "UPDATE-CONTEXT-TEST");
        var lens1 = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{episode!.Id}/lenses",
            new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
        var lens2 = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{episode.Id}/lenses",
            new LensCreateRequest("L002", "Lens 2", 2, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var createResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project!.Code,
                episode.Id,
                "Update Context Task",
                null,
                null,
                null,
                [lens1!.Id, lens2!.Id],
                [
                    new ReviewTaskShotCreateRequest(lens1.Id, 0, null, "review"),
                    new ReviewTaskShotCreateRequest(lens2.Id, 1, null, "review")
                ]),
            JsonOptions);

        createResponse.EnsureSuccessStatusCode();
        var createBody = await createResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = createBody.GetProperty("taskId").GetGuid();

        var updateResponse = await adminClient.PutAsJsonAsync(
            $"/api/review-tasks/{taskId}",
            new ProducerReviewTaskUpdateRequest(
                "Update Context Task",
                null,
                null,
                null,
                [
                    new ReviewTaskShotCreateRequest(lens1.Id, 0, null, "review"),
                    new ReviewTaskShotCreateRequest(lens2.Id, 1, null, "context")
                ]),
            JsonOptions);

        updateResponse.EnsureSuccessStatusCode();

        var detail = await adminClient.GetFromJsonAsync<JsonElement>($"/api/review-tasks/{taskId}/detail", JsonOptions);
        var shots = detail.GetProperty("shots").EnumerateArray().ToArray();

        Assert.Equal("review", shots[0].GetProperty("participationMode").GetString());
        Assert.Equal("context", shots[1].GetProperty("participationMode").GetString());
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
        var login = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest("admin", DatabaseSeeder.AdminPassword), JsonOptions);
        login.EnsureSuccessStatusCode();
        var loginBody = await login.Content.ReadFromJsonAsync<LoginResponse>(JsonOptions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", loginBody!.AccessToken);
        return client;
    }

    private static async Task<(ProjectCreateResponse? Project, EpisodeResponse? Episode)> CreateProjectEpisodeAsync(HttpClient client, string projectCode)
    {
        var project = await client.PostAsJsonAsync(
            "/api/projects",
            new ProjectCreateRequest(projectCode, $"{projectCode} Project", null, "v1", "l1"),
            JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        var episode = await client.PostAsJsonAsync(
            $"/api/projects/{project!.Code}/episodes",
            new EpisodeCreateRequest("E01", "Episode 1", 1, null),
            JsonOptions).ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        return (project, episode);
    }
}
