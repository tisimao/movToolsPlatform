using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Domain.Entities;
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
    public async Task Formal_submit_keeps_READY_FOR_REVIEW_until_director_action()
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
        Assert.Equal("READY_FOR_REVIEW", lensAfterSubmit!.InternalReviewStatusCode);

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

    [Fact]
    public async Task Director_can_reopen_DIRECTOR_APPROVED_shot_to_IN_DIRECTOR_REVIEW()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);
        using var directorClient = await CreateDirectorClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "REOPEN-TEST");
        var directorUser = await GetUserByUserNameAsync(factory, "director");

        var memberResponse = await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, directorUser.Id, "director"),
            JsonOptions);
        memberResponse.EnsureSuccessStatusCode();

        var approved = await AdminTransitionToDirectorApprovedAsync(adminClient, lens!);
        Assert.Equal("DIRECTOR_APPROVED", approved.InternalReviewStatusCode);

        var reopenResponse = await directorClient.PutAsJsonAsync(
            $"/api/lenses/{approved.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("IN_DIRECTOR_REVIEW", "reopen review", null),
            JsonOptions);
        reopenResponse.EnsureSuccessStatusCode();

        var reopened = await reopenResponse.Content.ReadFromJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(reopened);
        Assert.Equal("IN_DIRECTOR_REVIEW", reopened!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Director_can_mark_shot_director_approved()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);
        using var directorClient = await CreateDirectorClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "APPROVE-DIRECTOR");
        var directorUser = await GetUserByUserNameAsync(factory, "director");

        var memberResponse = await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, directorUser.Id, "director"),
            JsonOptions);
        memberResponse.EnsureSuccessStatusCode();

        var approved = await AdminTransitionToDirectorApprovedAsync(adminClient, lens!);
        Assert.Equal("DIRECTOR_APPROVED", approved.InternalReviewStatusCode);

        var response = await directorClient.PutAsJsonAsync(
            $"/api/lenses/{approved.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("DIRECTOR_APPROVED", "approve shot", null),
            JsonOptions);

        var responseText = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, responseText);
        var detail = await response.Content.ReadFromJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(detail);
        Assert.Equal("DIRECTOR_APPROVED", detail!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Director_can_mark_ready_shot_director_approved_when_task_started()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);
        using var directorClient = await CreateDirectorClientAsync(factory);
        using var producerClient = await CreateProducerClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "APPROVE-READY-STARTED");
        var directorUser = await GetUserByUserNameAsync(factory, "director");
        var producerUser = await GetUserByUserNameAsync(factory, "producer");

        (await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, directorUser.Id, "director"),
            JsonOptions)).EnsureSuccessStatusCode();
        (await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project.Code, producerUser.Id, "producer"),
            JsonOptions)).EnsureSuccessStatusCode();

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(project!.Code, null, "Started Review", directorUser.Id, null, null, [lens!.Id]),
            JsonOptions);
        draftResponse.EnsureSuccessStatusCode();
        var draftBody = await draftResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = draftBody.GetProperty("taskId").GetGuid();

        (await producerClient.PostAsync($"/api/review-tasks/{taskId}/submit", new StringContent(string.Empty))).EnsureSuccessStatusCode();
        (await directorClient.PostAsync($"/api/review-tasks/tasks/{taskId}/start", new StringContent(string.Empty))).EnsureSuccessStatusCode();

        var response = await directorClient.PutAsJsonAsync(
            $"/api/lenses/{lens.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("DIRECTOR_APPROVED", "approve started shot", null),
            JsonOptions);

        var responseText = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, responseText);
        var detail = await response.Content.ReadFromJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(detail);
        Assert.Equal("DIRECTOR_APPROVED", detail!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Director_can_mark_shot_pending_feedback_fix()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);
        using var directorClient = await CreateDirectorClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "REWORK-DIRECTOR");
        var directorUser = await GetUserByUserNameAsync(factory, "director");

        var memberResponse = await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, directorUser.Id, "director"),
            JsonOptions);
        memberResponse.EnsureSuccessStatusCode();

        var approved = await AdminTransitionToDirectorApprovedAsync(adminClient, lens!);
        Assert.Equal("DIRECTOR_APPROVED", approved.InternalReviewStatusCode);

        var response = await directorClient.PutAsJsonAsync(
            $"/api/lenses/{approved.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("PENDING_FEEDBACK_FIX", "need rework", null),
            JsonOptions);

        response.EnsureSuccessStatusCode();
        var detail = await response.Content.ReadFromJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(detail);
        Assert.Equal("PENDING_FEEDBACK_FIX", detail!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Director_can_rework_fix_updated_shot_when_task_started()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);
        using var directorClient = await CreateDirectorClientAsync(factory);
        using var producerClient = await CreateProducerClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "REWORK-FIX-STARTED");
        var directorUser = await GetUserByUserNameAsync(factory, "director");
        var producerUser = await GetUserByUserNameAsync(factory, "producer");

        (await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, directorUser.Id, "director"),
            JsonOptions)).EnsureSuccessStatusCode();
        (await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project.Code, producerUser.Id, "producer"),
            JsonOptions)).EnsureSuccessStatusCode();

        var readyResponse = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{lens!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("READY_FOR_REVIEW", null, null),
            JsonOptions);
        readyResponse.EnsureSuccessStatusCode();

        var fixUpdatedResponse = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{lens.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("IN_DIRECTOR_REVIEW", null, null),
            JsonOptions);
        fixUpdatedResponse.EnsureSuccessStatusCode();

        fixUpdatedResponse = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{lens.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("PENDING_FEEDBACK_FIX", null, null),
            JsonOptions);
        fixUpdatedResponse.EnsureSuccessStatusCode();

        fixUpdatedResponse = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{lens.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("FIX_UPDATED", null, null),
            JsonOptions);
        fixUpdatedResponse.EnsureSuccessStatusCode();

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(project!.Code, null, "Started Rework", directorUser.Id, null, null, [lens!.Id]),
            JsonOptions);
        draftResponse.EnsureSuccessStatusCode();
        var draftBody = await draftResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = draftBody.GetProperty("taskId").GetGuid();

        (await producerClient.PostAsync($"/api/review-tasks/{taskId}/submit", new StringContent(string.Empty))).EnsureSuccessStatusCode();
        (await directorClient.PostAsync($"/api/review-tasks/tasks/{taskId}/start", new StringContent(string.Empty))).EnsureSuccessStatusCode();

        var response = await directorClient.PutAsJsonAsync(
            $"/api/lenses/{lens.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("PENDING_FEEDBACK_FIX", "rework started shot", null),
            JsonOptions);

        var responseText = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, responseText);
        var detail = await response.Content.ReadFromJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(detail);
        Assert.Equal("PENDING_FEEDBACK_FIX", detail!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Director_can_rework_DIRECTOR_APPROVED_shot_to_PENDING_FEEDBACK_FIX()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);
        using var directorClient = await CreateDirectorClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "REWORK-DIRECTOR-APPROVED");
        var directorUser = await GetUserByUserNameAsync(factory, "director");

        var memberResponse = await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, directorUser.Id, "director"),
            JsonOptions);
        memberResponse.EnsureSuccessStatusCode();

        var approved = await AdminTransitionToDirectorApprovedAsync(adminClient, lens!);
        Assert.Equal("DIRECTOR_APPROVED", approved.InternalReviewStatusCode);

        var response = await directorClient.PutAsJsonAsync(
            $"/api/lenses/{approved.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("PENDING_FEEDBACK_FIX", "need rework", null),
            JsonOptions);

        response.EnsureSuccessStatusCode();
        var detail = await response.Content.ReadFromJsonAsync<LensResponse>(JsonOptions);
        Assert.NotNull(detail);
        Assert.Equal("PENDING_FEEDBACK_FIX", detail!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Director_cannot_promote_shot_to_READY_FOR_REVIEW()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);
        using var directorClient = await CreateDirectorClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "READY-DIRECTOR-DENY");
        var directorUser = await GetUserByUserNameAsync(factory, "director");

        var memberResponse = await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, directorUser.Id, "director"),
            JsonOptions);
        memberResponse.EnsureSuccessStatusCode();

        var response = await directorClient.PutAsJsonAsync(
            $"/api/lenses/{lens!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("READY_FOR_REVIEW", "try promote", null),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Producer_cannot_reopen_DIRECTOR_APPROVED_shot_to_IN_DIRECTOR_REVIEW()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);
        using var producerClient = await CreateProducerClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "REOPEN-DENY");
        var producerUser = await GetUserByUserNameAsync(factory, "producer");

        var memberResponse = await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, producerUser.Id, "producer"),
            JsonOptions);
        memberResponse.EnsureSuccessStatusCode();

        var approved = await AdminTransitionToDirectorApprovedAsync(adminClient, lens!);
        Assert.Equal("DIRECTOR_APPROVED", approved.InternalReviewStatusCode);

        var reopenResponse = await producerClient.PutAsJsonAsync(
            $"/api/lenses/{approved.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("IN_DIRECTOR_REVIEW", "reopen review", null),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Unauthorized, reopenResponse.StatusCode);
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
        var passwordHashService = scope.ServiceProvider.GetRequiredService<Movtools.Server.Application.Interfaces.IPasswordHashService>();
        await EnsureCollaboratorUserAsync(dbContext, passwordHashService, "producer", "制片用户", "Producer@123456", "producer");
        await EnsureCollaboratorUserAsync(dbContext, passwordHashService, "director", "导演用户", "Director@123456", "director");
    }

    private async Task<HttpClient> CreateAdminClientAsync(ServerApiFactory factory)
    {
        var client = factory.CreateClient();
        var login = await LoginAsync(client, "admin", DatabaseSeeder.AdminPassword);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        return client;
    }

    private async Task<HttpClient> CreateDirectorClientAsync(ServerApiFactory factory)
    {
        var client = factory.CreateClient();
        var login = await LoginAsync(client, "director", "Director@123456");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        return client;
    }

    private async Task<HttpClient> CreateProducerClientAsync(ServerApiFactory factory)
    {
        var client = factory.CreateClient();
        var login = await LoginAsync(client, "producer", "Producer@123456");
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

    private static async Task<User> GetUserByUserNameAsync(ServerApiFactory factory, string userName)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        return await dbContext.Users.FirstAsync(u => u.UserName == userName);
    }

    private static async Task EnsureCollaboratorUserAsync(
        MovtoolsDbContext dbContext,
        Movtools.Server.Application.Interfaces.IPasswordHashService passwordHashService,
        string userName,
        string displayName,
        string password,
        string roleCode)
    {
        var normalizedUserName = userName.ToUpperInvariant();
        var user = await dbContext.Users.FirstOrDefaultAsync(x => x.NormalizedUserName == normalizedUserName);
        if (user is null)
        {
            user = new User
            {
                UserName = userName,
                NormalizedUserName = normalizedUserName,
                DisplayName = displayName,
                PasswordHash = passwordHashService.Hash(password),
                IsActive = true
            };

            dbContext.Users.Add(user);
            await dbContext.SaveChangesAsync();
        }

        var role = await dbContext.Roles.FirstAsync(x => x.Code == roleCode);
        var hasRole = await dbContext.UserRoles.AnyAsync(x => x.UserId == user.Id && x.RoleId == role.Id);
        if (!hasRole)
        {
            dbContext.UserRoles.Add(new UserRole { UserId = user.Id, RoleId = role.Id });
            await dbContext.SaveChangesAsync();
        }
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
