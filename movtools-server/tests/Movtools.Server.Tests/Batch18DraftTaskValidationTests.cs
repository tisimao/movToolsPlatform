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
