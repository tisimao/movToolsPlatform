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
public sealed class ProjectEpisodeLensApiTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly PostgresFixture _fixture;

    public ProjectEpisodeLensApiTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    #region Project Tests

    [Fact]
    public async Task Admin_can_create_project()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest(
            "TEST-PROJ",
            "Test Project",
            "Description",
            "v1.0",
            "layout-v1",
            "EP01",
            "Episode 1",
            "D:/seed/ep01.xlsx",
            [new ProjectScanRootRequest("lens-root-main", "主镜头目录", "D:/proj/shot", 1, true, null)],
            [new ProjectScanRootRequest("layout-root-main", "Layout目录", "D:/proj/layout", 1, true, "D:/seed/ep01.xlsx")]), JsonOptions)
            .ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        Assert.NotNull(project);
        Assert.Equal("TEST-PROJ", project!.Code);
        Assert.Equal("D:/project/root", project.ProjectRootPath);
        Assert.Equal("D:/project/lens", project.LensFolderRootPath);
        Assert.Equal("D:/project/ma", project.MaCheckPath);
        Assert.Equal("D:/project/mov", project.MovCheckPath);
        Assert.Equal("D:/project/layout", project.LayoutCheckPath);
        Assert.Equal("D:/seed/ep01.xlsx", project.InitExcelPath);
        Assert.Single(project.LensRoots);
        Assert.Equal("lens-root-main", project.LensRoots[0].RootId);
        Assert.Equal("主镜头目录", project.LensRoots[0].Label);
        Assert.Equal("D:/proj/shot", project.LensRoots[0].AbsolutePath);
        Assert.Equal("D:/seed/ep01.xlsx", project.LensRoots[0].InitExcelPath);
        Assert.Equal("ma", project.LensRoots[0].FileKind);
        Assert.Equal("layout-root-main", project.LayoutRoots[0].RootId);
        Assert.Equal("Layout目录", project.LayoutRoots[0].Label);
        Assert.Equal("D:/proj/layout", project.LayoutRoots[0].AbsolutePath);
        Assert.Equal("D:/seed/ep01.xlsx", project.LayoutRoots[0].InitExcelPath);
        Assert.Equal("layout", project.LayoutRoots[0].FileKind);
    }

    [Fact]
    public async Task Duplicate_project_code_is_rejected()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("TEST-PROJ", "Test Project", null, "v1", "l1"), JsonOptions);
        
        var response = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("TEST-PROJ", "Another Project", null, "v2", "l2"), JsonOptions);
        
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Admin_can_view_all_projects()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Create two projects
        await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("PROJ-A", "Project A", null, "v1", "l1", null, null, null, [new ProjectScanRootRequest("root-a", "A", "D:/projects/proj-a/shot", 1, true, null, "ma")], null), JsonOptions);
        await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("PROJ-B", "Project B", null, "v1", "l1", null, null, null, [new ProjectScanRootRequest("root-b", "B", "D:/projects/proj-b/shot", 1, true, null, "ma")], null), JsonOptions);
        
        var projects = await adminClient.GetFromJsonAsync<List<ProjectResponse>>("/api/projects", JsonOptions);
        
        Assert.NotNull(projects);
        Assert.True(projects!.Count >= 2);
        Assert.Contains(projects, project => project.Code == "PROJ-A" && project.LensRoots[0].AbsolutePath == "D:/projects/proj-a/shot");
        Assert.Contains(projects, project => project.Code == "PROJ-A" && project.ProjectRootPath == null);
        Assert.All(projects, project => Assert.All(project.LensRoots.Concat(project.LayoutRoots), root => Assert.False(string.IsNullOrWhiteSpace(root.FileKind))));
    }

    #endregion

    #region Episode Tests

    [Fact]
    public async Task Admin_can_create_episode()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("EP-TEST", "Test", null, "v1", "l1", null, null, null, null, null, null, "D:/project/root", "D:/project/lens", "D:/project/ma", "D:/project/mov", "D:/project/layout"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        
        Assert.NotNull(episode);
        Assert.Equal("E01", episode!.Code);
        Assert.Equal("D:/project/root", episode.ProjectRootPath);
        Assert.Equal("D:/project/lens", episode.LensFolderRootPath);
        Assert.Equal("D:/project/layout", episode.LayoutCheckPath);
        Assert.Equal("ma", episode.LensRoots[0].FileKind);
        Assert.Equal("layout", episode.LayoutRoots[0].FileKind);
    }

    [Fact]
    public async Task Episode_create_list_and_detail_return_root_absolute_path()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync(
            "/api/projects",
            new ProjectCreateRequest(
                "EP-ROOTS",
                "Episode Roots",
                null,
                "v1",
                "l1",
                null,
                null,
                null,
                [new ProjectScanRootRequest("lens-root", "Lens", "D:/proj/ep-roots/shot", 1, true, null, "ma")],
                [new ProjectScanRootRequest("layout-root", "Layout", "D:/proj/ep-roots/layout", 1, true, null, "layout")]),
            JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        var created = await adminClient.PostAsJsonAsync(
            $"/api/projects/{project!.Code}/episodes",
            new EpisodeCreateRequest("E01", "Episode 1", 1, null),
            JsonOptions).ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        Assert.NotNull(created);
        Assert.Equal("D:/proj/ep-roots/shot", created!.LensRoots[0].AbsolutePath);
        Assert.Equal("ma", created.LensRoots[0].FileKind);
        Assert.Equal("D:/proj/ep-roots/layout", created.LayoutRoots[0].AbsolutePath);
        Assert.Equal("layout", created.LayoutRoots[0].FileKind);

        var list = await adminClient.GetFromJsonAsync<List<EpisodeResponse>>($"/api/projects/{project.Code}/episodes", JsonOptions);
        Assert.NotNull(list);
        Assert.Single(list!);
        Assert.Equal("D:/proj/ep-roots/shot", list[0].LensRoots[0].AbsolutePath);
        Assert.Equal("ma", list[0].LensRoots[0].FileKind);
        Assert.Equal("D:/proj/ep-roots/layout", list[0].LayoutRoots[0].AbsolutePath);
        Assert.Equal("layout", list[0].LayoutRoots[0].FileKind);

        var detail = await adminClient.GetFromJsonAsync<EpisodeResponse>($"/api/episodes/{created.Id}", JsonOptions);
        Assert.NotNull(detail);
        Assert.Equal("D:/proj/ep-roots/shot", detail!.LensRoots[0].AbsolutePath);
        Assert.Equal("ma", detail.LensRoots[0].FileKind);
        Assert.Equal("D:/proj/ep-roots/layout", detail.LayoutRoots[0].AbsolutePath);
        Assert.Equal("layout", detail.LayoutRoots[0].FileKind);
    }

    [Fact]
    public async Task Duplicate_episode_code_is_rejected()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("EP-TEST2", "Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions);
        
        var response = await adminClient.PostAsJsonAsync($"/api/projects/{project.Code}/episodes", new EpisodeCreateRequest("E01", "Episode Duplicate", 2, null), JsonOptions);
        
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Legacy_description_path_is_backfilled_to_project_root_path()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        var project = new Movtools.Server.Domain.Entities.Project
        {
            Code = "LEGACY-PATH",
            Name = "Legacy Path",
            Description = "D:/legacy/project-root",
            VersionTag = "v1",
            LayoutTag = "l1",
            IsArchived = false,
            RowVersion = 1
        };

        dbContext.Projects.Add(project);
        await dbContext.SaveChangesAsync();

        using var adminClient = await CreateAdminClientAsync(factory);
        var detail = await adminClient.GetFromJsonAsync<ProjectResponse>("/api/projects/LEGACY-PATH", JsonOptions);

        Assert.NotNull(detail);
        Assert.Equal("D:/legacy/project-root", detail!.ProjectRootPath);
    }

    [Fact]
    public async Task Project_detail_and_episode_detail_keep_roots_shape_and_formal_paths()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync(
            "/api/projects",
            new ProjectCreateRequest(
                "SHAPE-TEST",
                "Shape Test",
                null,
                "v1",
                "l1",
                null,
                null,
                null,
                [new ProjectScanRootRequest("lens-root", "Lens Root", "D:/shape/shot", 1, true, "D:/shape/init.xlsx", null)],
                [new ProjectScanRootRequest("layout-root", "Layout Root", "D:/shape/layout", 1, true, null, null)],
                null,
                "D:/shape/project",
                "D:/shape/lens",
                "D:/shape/ma",
                "D:/shape/mov",
                "D:/shape/layout"),
            JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        var projectDetail = await adminClient.GetFromJsonAsync<ProjectResponse>($"/api/projects/{project!.Code}", JsonOptions);
        Assert.NotNull(projectDetail);
        Assert.Equal("D:/shape/project", projectDetail!.ProjectRootPath);
        Assert.Equal("D:/shape/lens", projectDetail.LensFolderRootPath);
        Assert.Equal("D:/shape/ma", projectDetail.MaCheckPath);
        Assert.Equal("D:/shape/mov", projectDetail.MovCheckPath);
        Assert.Equal("D:/shape/layout", projectDetail.LayoutCheckPath);
        Assert.Equal("ma", projectDetail.LensRoots[0].FileKind);
        Assert.Equal("layout", projectDetail.LayoutRoots[0].FileKind);

        var episode = await adminClient.PostAsJsonAsync(
            $"/api/projects/{project!.Code}/episodes",
            new EpisodeCreateRequest("E01", "Episode 1", 1, null),
            JsonOptions).ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var episodeDetail = await adminClient.GetFromJsonAsync<EpisodeResponse>($"/api/episodes/{episode!.Id}", JsonOptions);
        Assert.NotNull(episodeDetail);
        Assert.Equal(projectDetail.ProjectRootPath, episodeDetail!.ProjectRootPath);
        Assert.Equal(projectDetail.LensFolderRootPath, episodeDetail.LensFolderRootPath);
        Assert.Equal(projectDetail.MaCheckPath, episodeDetail.MaCheckPath);
        Assert.Equal(projectDetail.MovCheckPath, episodeDetail.MovCheckPath);
        Assert.Equal(projectDetail.LayoutCheckPath, episodeDetail.LayoutCheckPath);
        Assert.Equal(projectDetail.LensRoots[0].AbsolutePath, episodeDetail.LensRoots[0].AbsolutePath);
        Assert.Equal(projectDetail.LensRoots[0].FileKind, episodeDetail.LensRoots[0].FileKind);
        Assert.Equal(projectDetail.LayoutRoots[0].AbsolutePath, episodeDetail.LayoutRoots[0].AbsolutePath);
        Assert.Equal(projectDetail.LayoutRoots[0].FileKind, episodeDetail.LayoutRoots[0].FileKind);
    }

    [Fact]
    public async Task Historical_project_root_in_description_is_read_back_without_blocking_access()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        dbContext.Projects.Add(new Movtools.Server.Domain.Entities.Project
        {
            Code = "LEGACY-ACCESS",
            Name = "Legacy Access",
            Description = "D:/legacy/access-root",
            VersionTag = "v1",
            LayoutTag = "l1",
            IsArchived = false,
            RowVersion = 1
        });
        await dbContext.SaveChangesAsync();

        using var adminClient = await CreateAdminClientAsync(factory);
        var detail = await adminClient.GetFromJsonAsync<ProjectResponse>("/api/projects/LEGACY-ACCESS", JsonOptions);
        Assert.NotNull(detail);
        Assert.Equal("D:/legacy/access-root", detail!.ProjectRootPath);

        var detailAgain = await adminClient.GetFromJsonAsync<ProjectResponse>("/api/projects/LEGACY-ACCESS", JsonOptions);
        Assert.NotNull(detailAgain);
        Assert.Equal("D:/legacy/access-root", detailAgain!.ProjectRootPath);
    }

    #endregion

    #region Lens Tests

    [Fact]
    public async Task Admin_can_create_lens()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("LENS-TEST", "Lens Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, "Test lens", "root", "/path/to/file", "v1", "l1"), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        Assert.NotNull(lens);
        Assert.Equal("L001", lens!.Code);
    }

    [Fact]
    public async Task Admin_can_edit_lens()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("EDIT-TEST", "Edit Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, "Original", "root", "/path", "v1", "l1"), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        var updateRequest = new LensUpdateRequest("Lens 1 Updated", "Updated desc", "root2", "/newpath", "v2", "l2", "Comment", lens!.RowVersion);
        
        var updated = await adminClient.PutAsJsonAsync($"/api/lenses/{lens.Id}", updateRequest, JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        Assert.Equal("Lens 1 Updated", updated!.Name);
    }

    [Fact]
    public async Task Lens_list_loads_successfully()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("LIST-TEST", "List Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        
        await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions);
        await adminClient.PostAsJsonAsync($"/api/episodes/{episode.Id}/lenses", new LensCreateRequest("L002", "Lens 2", 2, null, null, null, null, null), JsonOptions);
        
        var lenses = await adminClient.GetFromJsonAsync<List<LensResponse>>($"/api/episodes/{episode.Id}/lenses", JsonOptions);
        
        Assert.NotNull(lenses);
        Assert.Equal(2, lenses!.Count);
    }

    [Fact]
    public async Task Admin_can_sync_lens_file_binding_and_read_back_detail()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("BIND-TEST", "Bind Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        var syncResponse = await adminClient.PostAsJsonAsync(
            $"/api/lenses/{lens!.Id}/bindings",
            new LensFileBindingSyncRequest("mov", "EP01/SC001/ANI/SC001_V01.mov", "lens-root-main", "V01", "SC001_V01.mov"),
            JsonOptions)
            .ReadAsJsonAsync<LensFileBindingResponse>(JsonOptions);

        Assert.NotNull(syncResponse);
        Assert.Equal(lens.Id, syncResponse!.LensId);
        Assert.Equal("L001", syncResponse.LensCode);
        Assert.Equal("mov", syncResponse.BindingType);
        Assert.Equal("EP01/SC001/ANI/SC001_V01.mov", syncResponse.RelativePath);

        var detail = await adminClient.GetFromJsonAsync<LensDetailResponse>($"/api/lenses/{lens.Id}/detail", JsonOptions);
        Assert.NotNull(detail);
        Assert.Single(detail!.FileBindings);
        Assert.Empty(detail.LayoutCandidates);
        Assert.Null(detail.CurrentLayout);
        Assert.Null(detail.LayoutReferenceCheck);

        var binding = detail.FileBindings[0];
        Assert.Equal(syncResponse.BindingId, binding.BindingId);
        Assert.Equal(lens.Id, binding.LensId);
        Assert.Equal("L001", binding.LensCode);
        Assert.Equal("EP01/SC001/ANI/SC001_V01.mov", binding.RelativePath);
        Assert.Equal("lens-root-main", binding.SourceRoot);
        Assert.Equal("V01", binding.VersionNum);
        Assert.Equal("SC001_V01.mov", binding.FileName);

        var list = await adminClient.GetFromJsonAsync<List<LensResponse>>($"/api/episodes/{episode.Id}/lenses", JsonOptions);
        var listed = list!.Single(x => x.Id == lens.Id);
        Assert.Equal(1, listed.FileBindingCount);
        Assert.InRange((listed.LatestFileBindingUpdatedAtUtc!.Value - syncResponse.BindTime).Duration(), TimeSpan.Zero, TimeSpan.FromMilliseconds(1));
    }

    [Fact]
    public async Task Lens_create_returns_matched_and_unmatched_maker_state()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("MAKER-STATE", "Maker State", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var makerUser = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("maker-state", "Maker State User", "MakerState@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        await adminClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest(project.Code, makerUser!.UserId, "maker"), JsonOptions);

        var matchedRequest = new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null)
        {
            MakerUserId = makerUser.UserId,
            MakerNameRaw = "张三",
            MakerMatchStatus = "matched"
        };

        var matched = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", matchedRequest, JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        Assert.NotNull(matched);
        Assert.Equal(makerUser.UserId, matched!.MakerUserId);
        Assert.Equal("张三", matched.MakerNameRaw);
        Assert.Equal("matched", matched.MakerMatchStatus);
        Assert.Equal("Maker State User", matched.MakerDisplayName);

        var unmatchedRequest = new LensCreateRequest("L002", "Lens 2", 2, null, null, null, null, null)
        {
            MakerNameRaw = "李四",
            MakerMatchStatus = "unmatched"
        };

        var unmatched = await adminClient.PostAsJsonAsync($"/api/episodes/{episode.Id}/lenses", unmatchedRequest, JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        Assert.NotNull(unmatched);
        Assert.Null(unmatched!.MakerUserId);
        Assert.Equal("李四", unmatched.MakerNameRaw);
        Assert.Equal("unmatched", unmatched.MakerMatchStatus);
        Assert.Null(unmatched.MakerDisplayName);
    }

    [Fact]
    public async Task Lens_update_can_promote_unmatched_to_matched_and_list_detail_return_truth()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("MAKER-EDIT", "Maker Edit", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var makerUser = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("maker-edit", "Maker Edit User", "MakerEdit@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        await adminClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest(project.Code, makerUser!.UserId, "maker"), JsonOptions);

        var created = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L010", "Lens 10", 10, null, null, null, null, null)
        {
            MakerNameRaw = "未匹配姓名",
            MakerMatchStatus = "unmatched"
        }, JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var updateRequest = new LensUpdateRequest("Lens 10", null, null, null, null, null, null, created!.RowVersion)
        {
            MakerUserId = makerUser.UserId,
            MakerNameRaw = "未匹配姓名",
            MakerMatchStatus = "matched"
        };

        var updated = await adminClient.PutAsJsonAsync($"/api/lenses/{created.Id}", updateRequest, JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        Assert.Equal(makerUser.UserId, updated!.MakerUserId);
        Assert.Equal("matched", updated.MakerMatchStatus);
        Assert.Equal("Maker Edit User", updated.MakerDisplayName);

        var list = await adminClient.GetFromJsonAsync<List<LensResponse>>($"/api/episodes/{episode.Id}/lenses", JsonOptions);
        Assert.NotNull(list);
        Assert.Equal("matched", list!.Single(x => x.Code == "L010").MakerMatchStatus);

        var detail = await adminClient.GetFromJsonAsync<LensDetailResponse>($"/api/lenses/{created.Id}/detail", JsonOptions);
        Assert.NotNull(detail);
        Assert.Equal("matched", detail!.Lens.MakerMatchStatus);
        Assert.Equal("Maker Edit User", detail.Lens.MakerDisplayName);
    }

    [Fact]
    public async Task Non_project_member_maker_user_is_rejected()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("MAKER-DENY", "Maker Deny", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var outsider = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("maker-outsider", "Maker Outsider", "MakerOutsider@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);

        var response = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L900", "Lens 900", 1, null, null, null, null, null)
        {
            MakerUserId = outsider!.UserId,
            MakerNameRaw = "外部姓名",
            MakerMatchStatus = "matched"
        }, JsonOptions);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Project_creation_without_members_still_assigns_creator_as_producer()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("EMPTY-MEMBERS", "Empty Members", null, "v1", "l1", null, null, null, Array.Empty<ProjectScanRootRequest>(), Array.Empty<ProjectScanRootRequest>(), Array.Empty<ProjectMemberCreateRequest>()), JsonOptions)
            .ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        var members = await adminClient.GetFromJsonAsync<List<ProjectMemberResponse>>($"/api/project-members?projectCode={project!.Code}", JsonOptions);
        Assert.NotNull(members);
        Assert.Contains(members!, m => m.ProjectRoleCode == "producer");
    }

    [Fact]
    public async Task Repeated_same_binding_request_is_idempotent()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("IDEMP-TEST", "Idempotent Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        var request = new LensFileBindingSyncRequest("layout", "EP01/SC001/layout.mov", "layout-root", null, "layout.mov");

        var first = await adminClient.PostAsJsonAsync($"/api/lenses/{lens!.Id}/bindings", request, JsonOptions)
            .ReadAsJsonAsync<LensFileBindingResponse>(JsonOptions);
        var second = await adminClient.PostAsJsonAsync($"/api/lenses/{lens.Id}/bindings", request, JsonOptions)
            .ReadAsJsonAsync<LensFileBindingResponse>(JsonOptions);

        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.Equal(first!.BindingId, second!.BindingId);

        using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        var count = await dbContext.LensFileBindings.CountAsync(x => x.LensId == lens.Id && x.BindingType == "layout");

        Assert.Equal(1, count);
    }

    [Fact]
    public async Task Delete_binding_removes_record_and_detail_list_reflect_it()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("DEL-TEST", "Delete Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        var created = await adminClient.PostAsJsonAsync(
            $"/api/lenses/{lens!.Id}/bindings",
            new LensFileBindingSyncRequest("mov", "EP01/SC001/ANI/SC001_V01.mov", "lens-root-main", "V01", "SC001_V01.mov"),
            JsonOptions)
            .ReadAsJsonAsync<LensFileBindingResponse>(JsonOptions);

        var deleteResponse = await adminClient.DeleteAsync($"/api/lenses/{lens.Id}/bindings?bindingType=mov&versionNum=V01");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var detail = await adminClient.GetFromJsonAsync<LensDetailResponse>($"/api/lenses/{lens.Id}/detail", JsonOptions);
        Assert.NotNull(detail);
        Assert.Empty(detail!.FileBindings);

        var list = await adminClient.GetFromJsonAsync<List<LensResponse>>($"/api/episodes/{episode.Id}/lenses", JsonOptions);
        Assert.Equal(0, list!.Single(x => x.Id == lens.Id).FileBindingCount);

        using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        Assert.False(await dbContext.LensFileBindings.AnyAsync(x => x.Id == created!.BindingId));
    }

    [Fact]
    public async Task Non_member_cannot_delete_lens_binding()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("DEL-DENY", "Delete Deny", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        await adminClient.PostAsJsonAsync(
            $"/api/lenses/{lens!.Id}/bindings",
            new LensFileBindingSyncRequest("layout", "EP01/SC001/layout.mov", "layout-root", null, "layout.mov"),
            JsonOptions);

        await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("outsider3", "Outsider3", "Outsider@123456"), JsonOptions);

        using var outsiderClient = factory.CreateClient();
        var login = await LoginAsync(outsiderClient, "outsider3", "Outsider@123456");
        outsiderClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);

        var response = await outsiderClient.DeleteAsync($"/api/lenses/{lens.Id}/bindings?bindingType=layout");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Delete_missing_binding_is_idempotent()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("DEL-IDEMP", "Delete Idempotent", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        var response = await adminClient.DeleteAsync($"/api/lenses/{lens!.Id}/bindings?bindingType=layout&versionNum=V99");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        Assert.Empty(await dbContext.LensFileBindings.Where(x => x.LensId == lens.Id).ToListAsync());
    }

    [Fact]
    public async Task Binding_overwrite_updates_existing_record()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("OVER-TEST", "Overwrite Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        var first = await adminClient.PostAsJsonAsync(
            $"/api/lenses/{lens!.Id}/bindings",
            new LensFileBindingSyncRequest("mov", "EP01/SC001/ANI/SC001_V01.mov", "lens-root-main", "V01", "SC001_V01.mov"),
            JsonOptions)
            .ReadAsJsonAsync<LensFileBindingResponse>(JsonOptions);

        var second = await adminClient.PostAsJsonAsync(
            $"/api/lenses/{lens.Id}/bindings",
            new LensFileBindingSyncRequest("mov", "EP01/SC001/ANI/SC001_V02.mov", "lens-root-main", "V01", "SC001_V02.mov"),
            JsonOptions)
            .ReadAsJsonAsync<LensFileBindingResponse>(JsonOptions);

        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.Equal(first!.BindingId, second!.BindingId);
        Assert.Equal("EP01/SC001/ANI/SC001_V02.mov", second.RelativePath);

        var list = await adminClient.GetFromJsonAsync<List<LensResponse>>($"/api/episodes/{episode.Id}/lenses", JsonOptions);
        var listed = list!.Single(x => x.Id == lens.Id);
        Assert.Equal(1, listed.FileBindingCount);
        Assert.InRange((listed.LatestFileBindingUpdatedAtUtc!.Value - second.BindTime).Duration(), TimeSpan.Zero, TimeSpan.FromMilliseconds(1));

        using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        var binding = await dbContext.LensFileBindings.SingleAsync(x => x.Id == second.BindingId);

        Assert.Equal("EP01/SC001/ANI/SC001_V02.mov", binding.RelativePath);
        Assert.Equal("SC001_V02.mov", binding.FileName);
    }

    [Fact]
    public async Task Non_member_cannot_sync_lens_binding()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("NO-BIND", "No Bind", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("outsider2", "Outsider2", "Outsider@123456"), JsonOptions);

        using var outsiderClient = factory.CreateClient();
        var login = await LoginAsync(outsiderClient, "outsider2", "Outsider@123456");
        outsiderClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);

        var response = await outsiderClient.PostAsJsonAsync(
            $"/api/lenses/{lens!.Id}/bindings",
            new LensFileBindingSyncRequest("layout", "EP01/SC001/layout.mov", "layout-root", null, "layout.mov"),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Absolute_relative_path_is_rejected()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("PATH-TEST", "Path Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        var response = await adminClient.PostAsJsonAsync(
            $"/api/lenses/{lens!.Id}/bindings",
            new LensFileBindingSyncRequest("layout", "C:/absolute/layout.mov", "layout-root", null, "layout.mov"),
            JsonOptions);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Missing_lens_returns_not_found()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var response = await adminClient.PostAsJsonAsync(
            $"/api/lenses/{Guid.NewGuid()}/bindings",
            new LensFileBindingSyncRequest("layout", "EP01/SC001/layout.mov", "layout-root", null, "layout.mov"),
            JsonOptions);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    #endregion

    #region Status Transition Tests

    [Fact]
    public async Task Valid_status_transition_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("STATUS-TEST", "Status Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        // Initial status should be WIP
        Assert.Equal("WIP", lens!.Status);
        
        // Transition to SUBMITTED
        var statusRequest = new LensStatusChangeRequest("SUBMITTED", "Ready for review", lens!.RowVersion);
        var submitted = await adminClient.PutAsJsonAsync($"/api/lenses/{lens.Id}/status", statusRequest, JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        Assert.Equal("SUBMITTED", submitted!.Status);
    }

    [Fact]
    public async Task Rework_status_transition_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("REWORK-TEST", "Rework Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        var statusReq = new LensStatusChangeRequest("SUBMITTED", "Ready for review", lens!.RowVersion);
        var submitted = await adminClient.PutAsJsonAsync($"/api/lenses/{lens.Id}/status", statusReq, JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        var reworkReq = new LensStatusChangeRequest("REWORK", "Needs revision", submitted!.RowVersion);
        var reworked = await adminClient.PutAsJsonAsync($"/api/lenses/{lens.Id}/status", reworkReq, JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);

        Assert.NotNull(reworked);
        Assert.Equal("REWORK", reworked!.Status);
    }

    [Fact]
    public async Task Invalid_status_transition_is_rejected()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("INVALID-TEST", "Invalid Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        // Try invalid transition: WIP -> APPROVED (not allowed)
        var statusRequest = new LensStatusChangeRequest("APPROVED", null, lens!.RowVersion);
        var response = await adminClient.PutAsJsonAsync($"/api/lenses/{lens.Id}/status", statusRequest, JsonOptions);
        
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task Closed_lens_cannot_be_submitted_again()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("CLOSED-TEST", "Closed Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        // Close the lens first
        var closeRequest = new LensStatusChangeRequest("CLOSED", "Closing", lens!.RowVersion);
        var closed = await adminClient.PutAsJsonAsync($"/api/lenses/{lens.Id}/status", closeRequest, JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        // Try to submit after close (should fail)
        var submitRequest = new LensStatusChangeRequest("SUBMITTED", null, closed!.RowVersion);
        var response = await adminClient.PutAsJsonAsync($"/api/lenses/{lens.Id}/status", submitRequest, JsonOptions);
        
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    #endregion

    #region Concurrency Tests

    [Fact]
    public async Task Concurrent_update_conflict_is_detected()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("CONC-TEST", "Concurrency Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 1", 1, "Original", null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        // First update succeeds
        var update1 = new LensUpdateRequest("Updated by user 1", null, null, null, null, null, null, lens!.RowVersion);
        var result1 = await adminClient.PutAsJsonAsync($"/api/lenses/{lens.Id}", update1, JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        Assert.Equal("Updated by user 1", result1!.Name);
        
        // Second update with stale rowVersion should fail
        var update2 = new LensUpdateRequest("Updated by user 2", null, null, null, null, null, null, lens!.RowVersion);
        var response = await adminClient.PutAsJsonAsync($"/api/lenses/{lens.Id}", update2, JsonOptions);
        
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    #endregion

    #region Permission Tests

    [Fact]
    public async Task Non_project_member_cannot_access_project_detail()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Admin creates project
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("PERM-TEST", "Perm Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        // Create a regular user
        var user = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("regular", "Regular User", "Regular@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        
        // Login as regular user
        using var regularClient = factory.CreateClient();
        var login = await LoginAsync(regularClient, "regular", "Regular@123456");
        regularClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        
        // Try to access project detail - should fail
        var response = await regularClient.GetAsync($"/api/projects/{project!.Code}");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Project_member_can_access_project()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Admin creates project
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("MEMBER-TEST", "Member Test", null, "v1", "l1", null, null, null, [new ProjectScanRootRequest("member-root", "Member Root", "D:/projects/member-test/shot", 1, true, null)], null), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        // Create a regular user
        var user = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("maker1", "Maker User", "Maker@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        
        // Assign user to project
        await adminClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest(project!.Code, user!.UserId, "maker"), JsonOptions);
        
        // Login as member user
        using var memberClient = factory.CreateClient();
        var login = await LoginAsync(memberClient, "maker1", "Maker@123456");
        memberClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        
        // Access should succeed now
        var projectDetail = await memberClient.GetFromJsonAsync<ProjectResponse>($"/api/projects/{project.Code}", JsonOptions);
        Assert.NotNull(projectDetail);
        Assert.Equal("D:/projects/member-test/shot", projectDetail!.LensRoots[0].AbsolutePath);
        Assert.Null(projectDetail.ProjectRootPath);
        Assert.Equal("D:/projects/member-test/lens", projectDetail.LensFolderRootPath);
        Assert.Equal("ma", projectDetail.LensRoots[0].FileKind);
    }

    [Fact]
    public async Task Non_member_cannot_access_episodes_or_lenses()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("NOPE-TEST", "No Access Test", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        
        // Create a regular user without project membership
        var user = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("outsider", "Outsider", "Outsider@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);
        
        using var outsiderClient = factory.CreateClient();
        var login = await LoginAsync(outsiderClient, "outsider", "Outsider@123456");
        outsiderClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        
        // Try episode list - should fail
        var episodeResponse = await outsiderClient.GetAsync($"/api/projects/{project.Code}/episodes");
        Assert.Equal(HttpStatusCode.Unauthorized, episodeResponse.StatusCode);
        
        // Try lens list - should fail
        var lensResponse = await outsiderClient.GetAsync($"/api/episodes/{episode!.Id}/lenses");
        Assert.Equal(HttpStatusCode.Unauthorized, lensResponse.StatusCode);
    }

    [Fact]
    public async Task Maker_can_only_see_owned_lenses_and_cannot_read_others()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("MAKER-SCOPE", "Maker Scope", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions).ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var maker = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("maker-scope", "Maker Scope", "MakerScope@123456"), JsonOptions).ReadAsJsonAsync<UserResponse>(JsonOptions);
        var other = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("other-scope", "Other Scope", "OtherScope@123456"), JsonOptions).ReadAsJsonAsync<UserResponse>(JsonOptions);
        await adminClient.PostAsJsonAsync($"/api/project-members", new CreateProjectMemberRequest(project!.Code, maker!.UserId, "maker"), JsonOptions);
        await adminClient.PostAsJsonAsync($"/api/project-members", new CreateProjectMemberRequest(project.Code, other!.UserId, "maker"), JsonOptions);

        var mine = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Mine", 1, null, null, null, null, null)
        {
            MakerUserId = maker.UserId,
            MakerNameRaw = "甲",
            MakerMatchStatus = "matched"
        }, JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var theirs = await adminClient.PostAsJsonAsync($"/api/episodes/{episode.Id}/lenses", new LensCreateRequest("L002", "Theirs", 2, null, null, null, null, null)
        {
            MakerUserId = other.UserId,
            MakerNameRaw = "乙",
            MakerMatchStatus = "matched"
        }, JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        using var makerClient = factory.CreateClient();
        var login = await LoginAsync(makerClient, "maker-scope", "MakerScope@123456");
        makerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);

        var list = await makerClient.GetFromJsonAsync<List<LensResponse>>($"/api/episodes/{episode.Id}/lenses", JsonOptions);
        Assert.Single(list!);
        Assert.Equal(mine!.Id, list[0].Id);

        var ownDetail = await makerClient.GetFromJsonAsync<LensDetailResponse>($"/api/lenses/{mine.Id}/detail", JsonOptions);
        Assert.NotNull(ownDetail);

        var foreignDetail = await makerClient.GetAsync($"/api/lenses/{theirs!.Id}/detail");
        Assert.Equal(HttpStatusCode.Unauthorized, foreignDetail.StatusCode);

        var foreignLens = await makerClient.GetAsync($"/api/lenses/{theirs.Id}");
        Assert.Equal(HttpStatusCode.Unauthorized, foreignLens.StatusCode);

        var updateResponse = await makerClient.PutAsJsonAsync($"/api/lenses/{mine.Id}", new LensUpdateRequest("Mine Edit", null, null, null, null, null, null, mine.RowVersion), JsonOptions);
        Assert.Equal(HttpStatusCode.Unauthorized, updateResponse.StatusCode);

        var statusResponse = await makerClient.PutAsJsonAsync($"/api/lenses/{mine.Id}/status", new LensStatusChangeRequest("SUBMITTED", null, mine.RowVersion), JsonOptions);
        Assert.Equal(HttpStatusCode.Unauthorized, statusResponse.StatusCode);

        var bindingResponse = await makerClient.PostAsJsonAsync($"/api/lenses/{mine.Id}/bindings", new LensFileBindingSyncRequest("layout", "EP01/SC001/layout.mov", "layout-root", null, "layout.mov"), JsonOptions);
        Assert.Equal(HttpStatusCode.Unauthorized, bindingResponse.StatusCode);

        var deleteBindingResponse = await makerClient.DeleteAsync($"/api/lenses/{mine.Id}/bindings?bindingType=layout");
        Assert.Equal(HttpStatusCode.Unauthorized, deleteBindingResponse.StatusCode);
    }

    [Fact]
    public async Task Maker_project_list_is_scoped_to_membership()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var visibleProject = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("VISIBLE-PROJ", "Visible", null, "v1", "l1", null, null, null, [new ProjectScanRootRequest("visible-root", "Visible Root", "D:/projects/visible/shot", 1, true, null)], null), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var hiddenProject = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("HIDDEN-PROJ", "Hidden", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        var maker = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("maker-project", "Maker Project", "MakerProject@123456"), JsonOptions).ReadAsJsonAsync<UserResponse>(JsonOptions);
        await adminClient.PostAsJsonAsync($"/api/users/{maker!.UserId}/roles", new AssignRolesRequest(["maker"]), JsonOptions);
        await adminClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest(visibleProject!.Code, maker.UserId, "maker"), JsonOptions);

        using var makerClient = factory.CreateClient();
        var login = await LoginAsync(makerClient, "maker-project", "MakerProject@123456");
        makerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);

        var projects = await makerClient.GetFromJsonAsync<List<ProjectResponse>>("/api/projects", JsonOptions);
        Assert.Contains(projects!, project => project.Code == visibleProject.Code);
        Assert.DoesNotContain(projects!, project => project.Code == hiddenProject.Code);
        Assert.Equal("D:/projects/visible/shot", projects!.Single(project => project.Code == visibleProject.Code).LensRoots[0].AbsolutePath);
        Assert.Equal("ma", projects.Single(project => project.Code == visibleProject.Code).LensRoots[0].FileKind);
        Assert.False(string.IsNullOrWhiteSpace(projects.Single(project => project.Code == visibleProject.Code).ProjectRootPath));
    }

    [Fact]
    public async Task Non_maker_updates_preserve_matched_maker_assignment()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("SYNC-GUARD", "Sync Guard", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions).ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var maker = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("maxiaoliang", "maxiaoliang", "Maker@123456"), JsonOptions).ReadAsJsonAsync<UserResponse>(JsonOptions);
        var producer = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("producer-sync", "Producer Sync", "Producer@123456"), JsonOptions).ReadAsJsonAsync<UserResponse>(JsonOptions);
        await adminClient.PostAsJsonAsync($"/api/users/{maker!.UserId}/roles", new AssignRolesRequest(["maker"]), JsonOptions);
        await adminClient.PostAsJsonAsync($"/api/users/{producer!.UserId}/roles", new AssignRolesRequest(["producer"]), JsonOptions);
        await adminClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest(project!.Code, maker.UserId, "maker"), JsonOptions);
        await adminClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest(project.Code, producer.UserId, "producer"), JsonOptions);

        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L100", "Lens 100", 100, null, null, null, null, null)
        {
            MakerUserId = maker.UserId,
            MakerNameRaw = "Lee",
            MakerMatchStatus = "matched"
        }, JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        using var makerClient = factory.CreateClient();
        var makerLogin = await LoginAsync(makerClient, "maxiaoliang", "Maker@123456");
        makerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", makerLogin.AccessToken);

        var beforeUpdate = await makerClient.GetFromJsonAsync<List<LensResponse>>($"/api/episodes/{episode.Id}/lenses", JsonOptions);
        Assert.Single(beforeUpdate!);
        Assert.Equal(lens!.Id, beforeUpdate[0].Id);
        Assert.Equal(maker.UserId, beforeUpdate[0].MakerUserId);
        Assert.Equal("matched", beforeUpdate[0].MakerMatchStatus);

        using var producerClient = factory.CreateClient();
        var producerLogin = await LoginAsync(producerClient, "producer-sync", "Producer@123456");
        producerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", producerLogin.AccessToken);

        var updateResponse = await producerClient.PutAsJsonAsync(
            $"/api/lenses/{lens!.Id}",
            new LensUpdateRequest("Lens 100 Updated", null, null, null, null, null, null, lens.RowVersion),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        Assert.NotNull(updateResponse);
        Assert.Equal(maker.UserId, updateResponse!.MakerUserId);
        Assert.Equal("matched", updateResponse.MakerMatchStatus);
        Assert.Equal("Lee", updateResponse.MakerNameRaw);

        var afterUpdate = await makerClient.GetFromJsonAsync<List<LensResponse>>($"/api/episodes/{episode.Id}/lenses", JsonOptions);
        Assert.Single(afterUpdate!);
        Assert.Equal(lens.Id, afterUpdate[0].Id);
        Assert.Equal(maker.UserId, afterUpdate[0].MakerUserId);
        Assert.Equal("matched", afterUpdate[0].MakerMatchStatus);
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

    private static async Task<LoginResponse> LoginAsync(HttpClient client, string userName, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(userName, password), JsonOptions);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<LoginResponse>(JsonOptions))!;
    }
}
