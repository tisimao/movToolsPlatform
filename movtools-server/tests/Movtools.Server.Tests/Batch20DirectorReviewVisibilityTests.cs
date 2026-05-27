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
public sealed class Batch20DirectorReviewVisibilityTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly PostgresFixture _fixture;

    public Batch20DirectorReviewVisibilityTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task Director_cannot_see_draft_task_until_submit()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        using var directorClient = await CreateDirectorClientAsync(factory);

        var (project, episode, lens) = await CreateProjectEpisodeLensAsync(adminClient, "DIR-VIS-001");
        var directorUser = await GetUserByUserNameAsync(factory, "director");

        await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, directorUser.Id, "director"),
            JsonOptions);

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project.Code,
                episode!.Id,
                "Director Visibility Task",
                directorUser.Id,
                null,
                null,
                [lens!.Id]),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Created, draftResponse.StatusCode);
        var draftBody = await draftResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = draftBody.GetProperty("taskId").GetGuid();

        var listBefore = await directorClient.GetFromJsonAsync<JsonElement[]>("/api/review-tasks", JsonOptions);
        Assert.NotNull(listBefore);
        Assert.DoesNotContain(listBefore!, item => item.GetProperty("id").GetGuid() == taskId);

        var detailBefore = await directorClient.GetAsync($"/api/review-tasks/{taskId}");
        Assert.Equal(HttpStatusCode.NotFound, detailBefore.StatusCode);

        var submitResponse = await adminClient.PostAsync($"/api/review-tasks/tasks/{taskId}/submit", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.OK, submitResponse.StatusCode);
        var submittedDetail = await submitResponse.Content.ReadFromJsonAsync<ReviewTaskResponse>(JsonOptions);
        Assert.NotNull(submittedDetail);

        var startResponse = await adminClient.PostAsync($"/api/review-tasks/tasks/{taskId}/start", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.OK, startResponse.StatusCode);

        var listAfterCreate = await directorClient.GetFromJsonAsync<JsonElement[]>("/api/review-tasks", JsonOptions);
        Assert.NotNull(listAfterCreate);
        Assert.Contains(listAfterCreate!, item => item.GetProperty("id").GetGuid() == taskId);

        var detailAfterCreate = await directorClient.GetFromJsonAsync<ReviewTaskResponse>($"/api/review-tasks/{taskId}", JsonOptions);
        Assert.NotNull(detailAfterCreate);
        Assert.Equal("in-review", detailAfterCreate!.Status);

        var completeAsDirector = await directorClient.PostAsync($"/api/review-tasks/tasks/{taskId}/complete", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.Conflict, completeAsDirector.StatusCode);

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId,
                lens.Id,
                lens.VersionNum,
                null,
                null,
                "Looks good",
                null,
                "APPROVE",
                null,
                null,
                null,
                null,
                submittedDetail!.Shots[0].Id),
            JsonOptions);

        var completeResponse = await directorClient.PostAsync(
            $"/api/review-tasks/tasks/{taskId}/complete",
            new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.OK, completeResponse.StatusCode);

        var closeResponse = await adminClient.PostAsJsonAsync($"/api/review-tasks/tasks/{taskId}/close", new { }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, closeResponse.StatusCode);

        var listAfterClose = await directorClient.GetFromJsonAsync<JsonElement[]>("/api/review-tasks", JsonOptions);
        Assert.NotNull(listAfterClose);
        Assert.DoesNotContain(listAfterClose!, item => item.GetProperty("id").GetGuid() == taskId);

        var detailAfterClose = await directorClient.GetAsync($"/api/review-tasks/{taskId}");
        Assert.Equal(HttpStatusCode.NotFound, detailAfterClose.StatusCode);
    }

    [Fact]
    public async Task Producer_can_open_ready_task_detail_and_submit_it()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        using var producerClient = await CreateProducerClientAsync(factory);

        var (project, episode, lens) = await CreateProjectEpisodeLensAsync(adminClient, "PROD-SUBMIT-001");
        var producerUser = await GetUserByUserNameAsync(factory, "producer");

        await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, producerUser.Id, "producer"),
            JsonOptions);

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project.Code,
                episode!.Id,
                "Producer Submit Task",
                null,
                null,
                null,
                [lens!.Id]),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Created, draftResponse.StatusCode);
        var draftBody = await draftResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = draftBody!.GetProperty("taskId").GetGuid();

        var detailResponse = await producerClient.GetAsync($"/api/review-tasks/{taskId}/detail");
        Assert.Equal(HttpStatusCode.OK, detailResponse.StatusCode);

        var detail = await detailResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        Assert.NotNull(detail);
        Assert.Equal("ready", detail!.GetProperty("status").GetString());
        Assert.Equal("pending-submit", detail.GetProperty("producerStatus").GetString());

        var submitResponse = await producerClient.PostAsync($"/api/review-tasks/{taskId}/submit", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.OK, submitResponse.StatusCode);

        var submittedDetail = await producerClient.GetFromJsonAsync<JsonElement>($"/api/review-tasks/{taskId}/detail", JsonOptions);
        Assert.NotNull(submittedDetail);
        Assert.Equal("pending", submittedDetail!.GetProperty("status").GetString());
        Assert.Equal("pending", submittedDetail.GetProperty("producerStatus").GetString());
    }

    [Fact]
    public async Task Director_cannot_open_ready_task_detail_or_submit_it()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        using var directorClient = await CreateDirectorClientAsync(factory);

        var (project, episode, lens) = await CreateProjectEpisodeLensAsync(adminClient, "DIR-SUBMIT-001");
        var directorUser = await GetUserByUserNameAsync(factory, "director");

        await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, directorUser.Id, "director"),
            JsonOptions);

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project.Code,
                episode!.Id,
                "Director Locked Task",
                null,
                null,
                null,
                [lens!.Id]),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Created, draftResponse.StatusCode);
        var draftBody = await draftResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = draftBody!.GetProperty("taskId").GetGuid();

        var detailResponse = await directorClient.GetAsync($"/api/review-tasks/{taskId}");
        Assert.Equal(HttpStatusCode.NotFound, detailResponse.StatusCode);

        var submitResponse = await directorClient.PostAsync($"/api/review-tasks/{taskId}/submit", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.Unauthorized, submitResponse.StatusCode);
    }

    [Fact]
    public async Task Producer_can_only_close_completed_task_and_close_hides_from_director()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        using var directorClient = await CreateDirectorClientAsync(factory);
        using var producerClient = await CreateProducerClientAsync(factory);

        var (project, episode, lens) = await CreateProjectEpisodeLensAsync(adminClient, "DIR-CLOSE-001");
        var directorUser = await GetUserByUserNameAsync(factory, "director");
        var producerUser = await GetUserByUserNameAsync(factory, "producer");

        await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, directorUser.Id, "director"),
            JsonOptions);
        await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project.Code, producerUser.Id, "producer"),
            JsonOptions);

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project.Code,
                episode!.Id,
                "Director Close Task",
                directorUser.Id,
                null,
                null,
                [lens!.Id]),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Created, draftResponse.StatusCode);
        var draftBody = await draftResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = draftBody.GetProperty("taskId").GetGuid();

        var completeBeforeSubmit = await directorClient.PostAsync($"/api/review-tasks/tasks/{taskId}/complete", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.Conflict, completeBeforeSubmit.StatusCode);

        var closeBeforeSubmit = await producerClient.PostAsync($"/api/review-tasks/tasks/{taskId}/close", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.Conflict, closeBeforeSubmit.StatusCode);

        var closeBeforeComplete = await producerClient.PostAsync($"/api/review-tasks/tasks/{taskId}/close", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.Conflict, closeBeforeComplete.StatusCode);

        var submitResponse = await adminClient.PostAsync($"/api/review-tasks/tasks/{taskId}/submit", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.OK, submitResponse.StatusCode);
        var submittedDetail = await submitResponse.Content.ReadFromJsonAsync<ReviewTaskResponse>(JsonOptions);
        Assert.NotNull(submittedDetail);

        var startResponse = await adminClient.PostAsync($"/api/review-tasks/tasks/{taskId}/start", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.OK, startResponse.StatusCode);

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId,
                lens!.Id,
                lens.VersionNum,
                null,
                null,
                "Ready to finish",
                null,
                "APPROVE",
                null,
                null,
                null,
                null,
                submittedDetail!.Shots[0].Id),
            JsonOptions);

        var completeResponse = await directorClient.PostAsync($"/api/review-tasks/tasks/{taskId}/complete", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.OK, completeResponse.StatusCode);

        var producerCompleteResponse = await producerClient.PostAsync($"/api/review-tasks/tasks/{taskId}/complete", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.Unauthorized, producerCompleteResponse.StatusCode);

        var directorCompletedList = await directorClient.GetFromJsonAsync<JsonElement[]>("/api/review-tasks?status=completed", JsonOptions);
        Assert.NotNull(directorCompletedList);
        Assert.Contains(directorCompletedList!, item => item.GetProperty("id").GetGuid() == taskId);

        var closeResponse = await producerClient.PostAsJsonAsync($"/api/review-tasks/tasks/{taskId}/close", new { }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, closeResponse.StatusCode);

        var directorListAfter = await directorClient.GetFromJsonAsync<JsonElement[]>("/api/review-tasks", JsonOptions);
        Assert.NotNull(directorListAfter);
        Assert.DoesNotContain(directorListAfter!, item => item.GetProperty("id").GetGuid() == taskId);

        var directorDetailAfter = await directorClient.GetAsync($"/api/review-tasks/{taskId}");
        Assert.Equal(HttpStatusCode.NotFound, directorDetailAfter.StatusCode);

        var adminDetailAfter = await adminClient.GetFromJsonAsync<ReviewTaskResponse>($"/api/review-tasks/{taskId}", JsonOptions);
        Assert.NotNull(adminDetailAfter);
        Assert.Equal("closed", adminDetailAfter!.Status);

        var producerClosedList = await producerClient.GetFromJsonAsync<JsonElement[]>("/api/review-tasks/producer?status=closed", JsonOptions);
        Assert.NotNull(producerClosedList);
        Assert.Contains(producerClosedList!, item => item.GetProperty("taskId").GetGuid() == taskId);
    }

    [Fact]
    public async Task Maker_can_read_owned_feedback_and_only_fix_owned_pending_feedback_lens()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        using var makerClient = await CreateMakerClientAsync(factory);

        var (project, episode, ownLens) = await CreateProjectEpisodeLensAsync(adminClient, "MAKER-FEEDBACK-001");
        var otherLens = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{episode!.Id}/lenses",
            new LensCreateRequest("L002", "Lens 2", 2, null, null, null, null, null)
            {
                MakerNameRaw = "Other Maker",
                MakerMatchStatus = "unmatched"
            },
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var makerUser = await GetUserByUserNameAsync(factory, "maker-feedback");
        await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, makerUser.Id, "maker"),
            JsonOptions);

        await adminClient.PutAsJsonAsync(
            $"/api/lenses/{ownLens!.Id}",
            new LensUpdateRequest("Own Lens", null, null, null, null, null, null, ownLens.RowVersion)
            {
                MakerUserId = makerUser.Id,
                MakerNameRaw = makerUser.DisplayName,
                MakerMatchStatus = "matched"
            },
            JsonOptions);

        await adminClient.PutAsJsonAsync(
            $"/api/lenses/{ownLens.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("READY_FOR_REVIEW", null, null),
            JsonOptions);
        await adminClient.PutAsJsonAsync(
            $"/api/lenses/{ownLens.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("IN_DIRECTOR_REVIEW", null, null),
            JsonOptions);
        await adminClient.PutAsJsonAsync(
            $"/api/lenses/{ownLens.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("PENDING_FEEDBACK_FIX", null, null),
            JsonOptions);

        var draftTaskResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project!.Code,
                episode!.Id,
                "Maker Feedback Task",
                null,
                null,
                null,
                [ownLens.Id]),
            JsonOptions);
        var draftTaskBody = await draftTaskResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var reviewTaskId = draftTaskBody!.GetProperty("taskId").GetGuid();
        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                reviewTaskId, ownLens.Id, "V01", null, null,
                "Fix own lens", null, "CHANGE_REQUEST", null, null, null, null),
            JsonOptions);

        var ownFeedbacks = await makerClient.GetFromJsonAsync<ReviewFeedbackLensResponse>($"/api/review-feedbacks/lens/{ownLens.Id}", JsonOptions);
        Assert.NotNull(ownFeedbacks);
        Assert.NotEmpty(ownFeedbacks!.Feedbacks);

        var foreignFeedbackResponse = await makerClient.GetAsync($"/api/review-feedbacks/lens/{otherLens!.Id}");
        Assert.Equal(HttpStatusCode.Unauthorized, foreignFeedbackResponse.StatusCode);

        var fixUpdatedResponse = await makerClient.PutAsJsonAsync(
            $"/api/lenses/{ownLens.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("FIX_UPDATED", null, null),
            JsonOptions);
        Assert.Equal(HttpStatusCode.OK, fixUpdatedResponse.StatusCode);

        var invalidTransitionResponse = await makerClient.PutAsJsonAsync(
            $"/api/lenses/{ownLens.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("READY_FOR_REVIEW", null, null),
            JsonOptions);
        Assert.Equal(HttpStatusCode.Unauthorized, invalidTransitionResponse.StatusCode);

        var foreignFixResponse = await makerClient.PutAsJsonAsync(
            $"/api/lenses/{otherLens!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("FIX_UPDATED", null, null),
            JsonOptions);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, foreignFixResponse.StatusCode);
    }

    [Fact]
    public async Task Maker_can_read_task_feedback_only_for_owned_lens()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        using var makerClient = await CreateMakerClientAsync(factory);

        var (project, episode, ownLens) = await CreateProjectEpisodeLensAsync(adminClient, "MAKER-FEEDBACK-002");
        var otherLens = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{episode!.Id}/lenses",
            new LensCreateRequest("L003", "Lens 3", 3, null, null, null, null, null)
            {
                MakerNameRaw = "Other Maker",
                MakerMatchStatus = "unmatched"
            },
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var makerUser = await GetUserByUserNameAsync(factory, "maker-feedback");
        await adminClient.PostAsJsonAsync(
            "/api/project-members",
            new CreateProjectMemberRequest(project!.Code, makerUser.Id, "maker"),
            JsonOptions);

        await adminClient.PutAsJsonAsync(
            $"/api/lenses/{ownLens!.Id}",
            new LensUpdateRequest("Own Lens 2", null, null, null, null, null, null, ownLens.RowVersion)
            {
                MakerUserId = makerUser.Id,
                MakerNameRaw = makerUser.DisplayName,
                MakerMatchStatus = "matched"
            },
            JsonOptions);

        var draftTaskResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project!.Code,
                episode!.Id,
                "Maker Feedback Task 2",
                null,
                null,
                null,
                [ownLens.Id]),
            JsonOptions);
        var draftTaskBody = await draftTaskResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var reviewTaskId = draftTaskBody!.GetProperty("taskId").GetGuid();
        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                reviewTaskId, ownLens.Id, "V01", null, null,
                "Own lens feedback", null, "CHANGE_REQUEST", null, null, null, null),
            JsonOptions);

        var ownFeedback = await makerClient.GetFromJsonAsync<ReviewFeedbackLensResponse>($"/api/review-feedbacks/lens/{ownLens.Id}", JsonOptions);
        Assert.NotNull(ownFeedback);

        var foreignFeedback = await makerClient.GetAsync($"/api/review-feedbacks/lens/{otherLens!.Id}");
        Assert.Equal(HttpStatusCode.Unauthorized, foreignFeedback.StatusCode);
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
        await EnsureCollaboratorUserAsync(dbContext, passwordHashService, "maker-feedback", "制作人员", "MakerFeedback@123456", "maker");
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

    private async Task<HttpClient> CreateDirectorClientAsync(ServerApiFactory factory)
    {
        var client = factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest("director", "Director@123456"), JsonOptions);
        login.EnsureSuccessStatusCode();
        var loginBody = await login.Content.ReadFromJsonAsync<LoginResponse>(JsonOptions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", loginBody!.AccessToken);
        return client;
    }

    private async Task<HttpClient> CreateProducerClientAsync(ServerApiFactory factory)
    {
        var client = factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest("producer", "Producer@123456"), JsonOptions);
        login.EnsureSuccessStatusCode();
        var loginBody = await login.Content.ReadFromJsonAsync<LoginResponse>(JsonOptions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", loginBody!.AccessToken);
        return client;
    }

    private async Task<HttpClient> CreateMakerClientAsync(ServerApiFactory factory)
    {
        var client = factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest("maker-feedback", "MakerFeedback@123456"), JsonOptions);
        login.EnsureSuccessStatusCode();
        var loginBody = await login.Content.ReadFromJsonAsync<LoginResponse>(JsonOptions);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", loginBody!.AccessToken);
        return client;
    }

    private static async Task<(ProjectCreateResponse Project, EpisodeResponse Episode, LensResponse Lens)> CreateProjectEpisodeLensAsync(HttpClient client, string projectCode)
    {
        var projectResponse = await client.PostAsJsonAsync(
            "/api/projects",
            new ProjectCreateRequest(projectCode, $"{projectCode} Project", null, "v1", "l1"),
            JsonOptions);
        var project = await projectResponse.Content.ReadFromJsonAsync<ProjectCreateResponse>(JsonOptions);

        var episodeResponse = await client.PostAsJsonAsync(
            $"/api/projects/{project!.Code}/episodes",
            new EpisodeCreateRequest("E01", "Episode 1", 1, null),
            JsonOptions);
        var episode = await episodeResponse.Content.ReadFromJsonAsync<EpisodeResponse>(JsonOptions);

        var lensResponse = await client.PostAsJsonAsync(
            $"/api/episodes/{episode!.Id}/lenses",
            new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null),
            JsonOptions);
        var lens = await lensResponse.Content.ReadFromJsonAsync<LensResponse>(JsonOptions);

        return (project!, episode!, lens!);
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

    private static async Task<User> GetUserByUserNameAsync(ServerApiFactory factory, string userName)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        return await dbContext.Users.FirstAsync(u => u.UserName == userName);
    }
}
