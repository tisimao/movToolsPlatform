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
public sealed class Batch18InternalReviewStatusTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly PostgresFixture _fixture;

    public Batch18InternalReviewStatusTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task Version_change_preserves_PENDING_FEEDBACK_FIX()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, _) = await CreateProjectEpisodeLensAsync(adminClient, "VFIX-TEST");

        var pending = await AdminTransitionToPendingFeedbackFixAsync(adminClient, lens!);
        Assert.NotNull(pending);
        Assert.Equal("PENDING_FEEDBACK_FIX", pending!.InternalReviewStatusCode);

        var updated = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{lens.Id}",
            new LensUpdateRequest(
                lens.Name, lens.Description, lens.RootCode, lens.LogicalPath,
                lens.VersionTag, lens.LayoutTag, lens.Comment, lens.RowVersion, lens.SingleFrame, lens.Maker)
            {
                VersionNum = "V02"
            }, JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        Assert.NotNull(updated);
        Assert.Equal("PENDING_FEEDBACK_FIX", updated!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Maker_can_transition_PENDING_FEEDBACK_FIX_to_FIX_UPDATED()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, _) = await CreateProjectEpisodeLensAsync(adminClient, "FIXUP-TEST");

        var pending = await AdminTransitionToPendingFeedbackFixAsync(adminClient, lens!);
        Assert.NotNull(pending);

        var fixUpdated = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{lens.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("FIX_UPDATED", null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        Assert.NotNull(fixUpdated);
        Assert.Equal("FIX_UPDATED", fixUpdated!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Draft_task_does_not_change_shot_internal_review_status()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "DRAFT-TEST");

        var ready = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{lens!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("READY_FOR_REVIEW", null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(ready);
        Assert.Equal("READY_FOR_REVIEW", ready!.InternalReviewStatusCode);

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project!.Code, null, "Draft Task", null, null, null, [lens.Id]),
            JsonOptions);
        Assert.True(draftResponse.IsSuccessStatusCode);

        var lensAfterDraft = await adminClient.GetFromJsonAsync<LensResponse>(
            $"/api/lenses/{lens.Id}", JsonOptions);
        Assert.NotNull(lensAfterDraft);
        Assert.Equal("READY_FOR_REVIEW", lensAfterDraft!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Formal_submit_only_promotes_READY_FOR_REVIEW_and_FIX_UPDATED()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "SUBMIT-TEST");

        var ready = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{lens!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("READY_FOR_REVIEW", null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(ready);

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project!.Code, null, "Submit Test", null, null, null, [lens.Id]),
            JsonOptions);
        Assert.True(draftResponse.IsSuccessStatusCode);
        var draftBody = await draftResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = draftBody.GetProperty("taskId").GetGuid();

        var submitResponse = await adminClient.PostAsJsonAsync(
            $"/api/review-tasks/{taskId}/submit", new { }, JsonOptions);
        Assert.True(submitResponse.IsSuccessStatusCode);

        var lensAfterSubmit = await adminClient.GetFromJsonAsync<LensResponse>(
            $"/api/lenses/{lens.Id}", JsonOptions);
        Assert.NotNull(lensAfterSubmit);
        Assert.Equal("IN_DIRECTOR_REVIEW", lensAfterSubmit!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task DIRECTOR_APPROVED_shot_remains_approved_after_task_submit()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "APPROVED-KEEP");

        var approved = await AdminTransitionToDirectorApprovedAsync(adminClient, lens!);
        Assert.Equal("DIRECTOR_APPROVED", approved!.InternalReviewStatusCode);

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project!.Code, null, "Approved Keep Test", null, null, null, [lens.Id]),
            JsonOptions);
        Assert.True(draftResponse.IsSuccessStatusCode);
        var draftBody = await draftResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = draftBody.GetProperty("taskId").GetGuid();

        await adminClient.PostAsJsonAsync(
            $"/api/review-tasks/{taskId}/submit", new { }, JsonOptions);

        var lensAfterTask = await adminClient.GetFromJsonAsync<LensResponse>(
            $"/api/lenses/{lens.Id}", JsonOptions);
        Assert.NotNull(lensAfterTask);
        Assert.Equal("DIRECTOR_APPROVED", lensAfterTask!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Formal_submission_is_blocked_when_not_DIRECTOR_APPROVED()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, _) = await CreateProjectEpisodeLensAsync(adminClient, "BLOCK-TEST");

        var response = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{lens!.Id}/status",
            new LensStatusChangeRequest("SUBMITTED", null, lens.RowVersion),
            JsonOptions);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

        var approved = await AdminTransitionToDirectorApprovedAsync(adminClient, lens);

        var submitResponse = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{approved!.Id}/status",
            new LensStatusChangeRequest("SUBMITTED", null, approved.RowVersion),
            JsonOptions);
        Assert.True(submitResponse.IsSuccessStatusCode);
    }

    [Fact]
    public async Task Rework_resets_internal_review_status_to_FIX_UPDATED()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, _) = await CreateProjectEpisodeLensAsync(adminClient, "REWORK-TEST");

        var pending = await AdminTransitionToPendingFeedbackFixAsync(adminClient, lens!);
        Assert.NotNull(pending);

        var fixUpdated = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{pending!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("FIX_UPDATED", null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(fixUpdated);

        var ready = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{fixUpdated!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("READY_FOR_REVIEW", null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(ready);

        var inReview = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{ready!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("IN_DIRECTOR_REVIEW", null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(inReview);

        var approved = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{inReview!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("DIRECTOR_APPROVED", null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(approved);
        Assert.Equal("DIRECTOR_APPROVED", approved!.InternalReviewStatusCode);

        var submitted = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{approved.Id}/status",
            new LensStatusChangeRequest("SUBMITTED", null, approved.RowVersion),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(submitted);
        Assert.Equal("SUBMITTED", submitted!.Status);

        var reworked = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{submitted.Id}/status",
            new LensStatusChangeRequest("REWORK", "Need rework", submitted.RowVersion),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        Assert.NotNull(reworked);
        Assert.Equal("FIX_UPDATED", reworked!.InternalReviewStatusCode);
        Assert.NotEqual(lens.VersionNum, reworked.VersionNum);
    }

    [Fact]
    public async Task Producer_task_summary_counts_DIRECTOR_APPROVED_shots()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens1, project) = await CreateProjectEpisodeLensAsync(adminClient, "SUMMARY-1");
        var lens2 = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{lens1!.EpisodeId}/lenses",
            new LensCreateRequest("S002", "Lens 2", 2, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        await AdminTransitionToDirectorApprovedAsync(adminClient, lens1);

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project!.Code, null, "Summary Test", null, null, null, [lens1.Id, lens2!.Id]),
            JsonOptions);
        Assert.True(draftResponse.IsSuccessStatusCode);
        var draftBody = await draftResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = draftBody.GetProperty("taskId").GetGuid();

        var detail = await adminClient.GetFromJsonAsync<JsonElement>(
            $"/api/review-tasks/{taskId}/detail", JsonOptions);

        Assert.True(detail.TryGetProperty("approvedShotCount", out var approvedCount));
        Assert.Equal(1, approvedCount.GetInt32());
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

    private static async Task<(LensResponse? Lens, ProjectCreateResponse? Project)> CreateProjectEpisodeLensAsync(
        HttpClient client, string projectCode)
    {
        var project = await client.PostAsJsonAsync(
            "/api/projects",
            new ProjectCreateRequest(projectCode, $"{projectCode} Project", null, "v1", "l1"),
            JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        var episode = await client.PostAsJsonAsync(
            $"/api/projects/{project!.Code}/episodes",
            new EpisodeCreateRequest("E01", "Episode 1", 1, null),
            JsonOptions).ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var lens = await client.PostAsJsonAsync(
            $"/api/episodes/{episode!.Id}/lenses",
            new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        return (lens, project);
    }

    private static async Task<LensResponse> AdminTransitionToDirectorApprovedAsync(HttpClient client, LensResponse lens)
    {
        var current = lens;

        var readyResponse = await client.PutAsJsonAsync(
            $"/api/lenses/{current.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("READY_FOR_REVIEW", null, null),
            JsonOptions);
        current = (await readyResponse.Content.ReadFromJsonAsync<LensResponse>(JsonOptions))!;

        var inReviewResponse = await client.PutAsJsonAsync(
            $"/api/lenses/{current.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("IN_DIRECTOR_REVIEW", null, null),
            JsonOptions);
        current = (await inReviewResponse.Content.ReadFromJsonAsync<LensResponse>(JsonOptions))!;

        var approvedResponse = await client.PutAsJsonAsync(
            $"/api/lenses/{current.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("DIRECTOR_APPROVED", null, null),
            JsonOptions);
        return (await approvedResponse.Content.ReadFromJsonAsync<LensResponse>(JsonOptions))!;
    }

    private static async Task<LensResponse> AdminTransitionToPendingFeedbackFixAsync(HttpClient client, LensResponse lens)
    {
        var current = lens;

        if (current.InternalReviewStatusCode != "READY_FOR_REVIEW")
        {
            var readyResponse = await client.PutAsJsonAsync(
                $"/api/lenses/{current.Id}/internal-review-status",
                new LensInternalReviewStatusUpdateRequest("READY_FOR_REVIEW", null, null),
                JsonOptions);
            current = (await readyResponse.Content.ReadFromJsonAsync<LensResponse>(JsonOptions))!;
        }

        var inReviewResponse = await client.PutAsJsonAsync(
            $"/api/lenses/{current.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("IN_DIRECTOR_REVIEW", null, null),
            JsonOptions);
        current = (await inReviewResponse.Content.ReadFromJsonAsync<LensResponse>(JsonOptions))!;

        var pendingResponse = await client.PutAsJsonAsync(
            $"/api/lenses/{current.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("PENDING_FEEDBACK_FIX", null, null),
            JsonOptions);
        return (await pendingResponse.Content.ReadFromJsonAsync<LensResponse>(JsonOptions))!;
    }
}
