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
public sealed class Batch4ApiTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly PostgresFixture _fixture;

    public Batch4ApiTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    #region Review Tests

    [Fact]
    public async Task Submit_lens_for_review_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Setup: create project, episode, lens
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("REVIEW-TEST", "Review Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, "Test", "root", "/path", "v1", "l1"), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        var ready = await TransitionLensToDirectorApprovedAsync(adminClient, lens!);
        await TransitionLensToSubmittedAsync(adminClient, ready);
        
        // Submit for review
        var reviewRequest = new ReviewSubmitRequest(lens.Id, "Please review this");
        var review = await adminClient.PostAsJsonAsync("/api/review-tasks", reviewRequest, JsonOptions)
            .ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);
        
        Assert.NotNull(review);
        Assert.Equal("pending", review!.Status);
    }

    [Fact]
    public async Task Get_pending_reviews_list_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("LIST-REV", "List Review", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        // Submit lens for review
        var ready = await TransitionLensToDirectorApprovedAsync(adminClient, lens!);
        await TransitionLensToSubmittedAsync(adminClient, ready);

        var reviewReq = new ReviewSubmitRequest(lens.Id, null);
        await adminClient.PostAsJsonAsync("/api/review-tasks", reviewReq, JsonOptions);

        // Get pending reviews
        var reviews = await adminClient.GetFromJsonAsync<List<ReviewTaskResponse>>("/api/review-tasks", JsonOptions);
        
        Assert.NotNull(reviews);
        Assert.NotEmpty(reviews!);
    }

    [Fact]
    public async Task Get_review_detail_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("DETAIL-REV", "Detail Review", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        var ready = await TransitionLensToDirectorApprovedAsync(adminClient, lens!);
        await TransitionLensToSubmittedAsync(adminClient, ready);

        var reviewReq = new ReviewSubmitRequest(lens.Id, null);
        var review = await adminClient.PostAsJsonAsync("/api/review-tasks", reviewReq, JsonOptions)
            .ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        // Get by ID
        var detail = await adminClient.GetFromJsonAsync<ReviewTaskResponse>($"/api/review-tasks/{review!.Id}", JsonOptions);
        
        Assert.NotNull(detail);
        Assert.NotNull(detail!.Shots);
        Assert.Equal(lens.Id, detail.Shots.First().LensId);
    }

    [Fact]
    public async Task Add_review_comment_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("COMMENT-REV", "Comment Review", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        var ready = await TransitionLensToDirectorApprovedAsync(adminClient, lens!);
        await TransitionLensToSubmittedAsync(adminClient, ready);

        var reviewReq = new ReviewSubmitRequest(lens.Id, null);
        var review = await adminClient.PostAsJsonAsync("/api/review-tasks", reviewReq, JsonOptions)
            .ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        // Add comment
        var commentReq = new ReviewCommentCreateRequest("This shot needs adjustment", null);
        var comment = await adminClient.PostAsJsonAsync($"/api/review-tasks/{review!.Id}/comments", commentReq, JsonOptions)
            .ReadAsJsonAsync<ReviewCommentResponse>(JsonOptions);
        
        Assert.NotNull(comment);
        Assert.Equal("This shot needs adjustment", comment!.Content);
    }

    [Fact]
    public async Task Add_timestamp_annotation_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("TIMESTAMP-REV", "Timestamp Review", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        var ready = await TransitionLensToDirectorApprovedAsync(adminClient, lens!);
        await TransitionLensToSubmittedAsync(adminClient, ready);

        var reviewReq = new ReviewSubmitRequest(lens.Id, null);
        var review = await adminClient.PostAsJsonAsync("/api/review-tasks", reviewReq, JsonOptions)
            .ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        // Add timestamp comment at 30 seconds
        var commentReq = new ReviewCommentCreateRequest("Check pose here", 30.5);
        var comment = await adminClient.PostAsJsonAsync($"/api/review-tasks/{review!.Id}/comments", commentReq, JsonOptions)
            .ReadAsJsonAsync<ReviewCommentResponse>(JsonOptions);
        
        Assert.NotNull(comment);
        Assert.Equal(30.5, comment!.TimestampSeconds);
    }

    [Fact]
    public async Task Director_can_approve_review()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("APPROVE-REV", "Approve Review", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        var ready = await TransitionLensToDirectorApprovedAsync(adminClient, lens!);
        await TransitionLensToSubmittedAsync(adminClient, ready);

        var reviewReq = new ReviewSubmitRequest(lens.Id, null);
        var review = await adminClient.PostAsJsonAsync("/api/review-tasks", reviewReq, JsonOptions)
            .ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        // Approve
        var approveReq = new ReviewActionRequest("approve", "Looks good!", review!.RowVersion);
        var approved = await adminClient.PostAsJsonAsync($"/api/review-tasks/{review.Id}/approve", approveReq, JsonOptions)
            .ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);
        
        Assert.NotNull(approved);
        Assert.Equal("completed", approved!.Status);
    }

    [Fact]
    public async Task Director_can_reject_review()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("REJECT-REV", "Reject Review", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        var ready = await TransitionLensToDirectorApprovedAsync(adminClient, lens!);
        await TransitionLensToSubmittedAsync(adminClient, ready);

        var reviewReq = new ReviewSubmitRequest(lens.Id, null);
        var review = await adminClient.PostAsJsonAsync("/api/review-tasks", reviewReq, JsonOptions)
            .ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        // Reject
        var rejectReq = new ReviewActionRequest("reject", "Needs revision", review!.RowVersion);
        var rejected = await adminClient.PostAsJsonAsync($"/api/review-tasks/{review.Id}/reject", rejectReq, JsonOptions)
            .ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);
        
        Assert.NotNull(rejected);
        Assert.Equal("closed", rejected!.Status);
    }

    #endregion

    #region Path Mapping Tests

    [Fact]
    public async Task Admin_can_create_storage_root()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Use a unique code that is NOT in the default seeded data
        var storageRoot = await adminClient.PostAsJsonAsync("/api/path-mappings/storage-roots", new StorageRootCreateRequest("TEST-STORAGE-ROOT", "Test Storage Root", "Test storage for unit tests"), JsonOptions)
            .ReadAsJsonAsync<StorageRootResponse>(JsonOptions);
        
        Assert.NotNull(storageRoot);
        Assert.Equal("TEST-STORAGE-ROOT", storageRoot!.Code);
    }

    [Fact]
    public async Task Client_node_registration_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Admin creates storage root with unique code
        await adminClient.PostAsJsonAsync("/api/path-mappings/storage-roots", new StorageRootCreateRequest("TEST-CLIENT-ROOT", "Test Client Root", null), JsonOptions);
        
        // Register client node
        var clientNode = await adminClient.PostAsJsonAsync("/api/path-mappings/client-nodes", new ClientNodeRegisterRequest("CLIENT-001", "Workstation 1", "DESKTOP-A"), JsonOptions)
            .ReadAsJsonAsync<ClientNodeResponse>(JsonOptions);
        
        Assert.NotNull(clientNode);
        Assert.Equal("CLIENT-001", clientNode!.ClientId);
    }

    [Fact]
    public async Task Set_path_mapping_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Admin creates storage root with unique code
        await adminClient.PostAsJsonAsync("/api/path-mappings/storage-roots", new StorageRootCreateRequest("TEST-MAP-ROOT", "Test Map Root", null), JsonOptions);
        
        // Register client node
        var clientNode = await adminClient.PostAsJsonAsync("/api/path-mappings/client-nodes", new ClientNodeRegisterRequest("CLIENT-002", "Workstation 2", null), JsonOptions)
            .ReadAsJsonAsync<ClientNodeResponse>(JsonOptions);
        
        // Set path mapping
        var mapping = await adminClient.PostAsJsonAsync($"/api/path-mappings/client-nodes/{clientNode!.Id}/mappings", new PathMappingCreateRequest("TEST-MAP-ROOT", "D:\\Projects\\Shots"), JsonOptions)
            .ReadAsJsonAsync<PathMappingResponse>(JsonOptions);
        
        Assert.NotNull(mapping);
        Assert.Equal("TEST-MAP-ROOT", mapping!.RootCode);
    }

    [Fact]
    public async Task Get_path_mappings_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        await adminClient.PostAsJsonAsync("/api/path-mappings/storage-roots", new StorageRootCreateRequest("TEST-LIST-ROOT", "Test List Root", null), JsonOptions);
        
        var clientNode = await adminClient.PostAsJsonAsync("/api/path-mappings/client-nodes", new ClientNodeRegisterRequest("CLIENT-003", "Workstation 3", null), JsonOptions)
            .ReadAsJsonAsync<ClientNodeResponse>(JsonOptions);
        
        await adminClient.PostAsJsonAsync($"/api/path-mappings/client-nodes/{clientNode!.Id}/mappings", new PathMappingCreateRequest("TEST-LIST-ROOT", "E:\\Data"), JsonOptions);
        
        var mappings = await adminClient.GetFromJsonAsync<List<PathMappingResponse>>($"/api/path-mappings/client-nodes/{clientNode.Id}/mappings", JsonOptions);
        
        Assert.NotNull(mappings);
        Assert.Single(mappings!);
    }

    #endregion

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

    private static async Task<LensResponse> TransitionLensToSubmittedAsync(HttpClient client, LensResponse lens)
    {
        var response = await client.PutAsJsonAsync($"/api/lenses/{lens.Id}/status", new LensStatusChangeRequest("SUBMITTED", "Ready for review", lens.RowVersion), JsonOptions);
        return (await response.Content.ReadFromJsonAsync<LensResponse>(JsonOptions))!;
    }

    private static async Task<LensResponse> TransitionLensToDirectorApprovedAsync(HttpClient client, LensResponse lens)
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

    private static async Task<LoginResponse> LoginAsync(HttpClient client, string userName, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(userName, password), JsonOptions);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<LoginResponse>(JsonOptions))!;
    }
}
