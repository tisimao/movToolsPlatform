using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;
using Movtools.Server.Infrastructure.Services;

namespace Movtools.Server.Tests;

[Collection("postgres integration")]
public sealed class Batch5ProducerApiTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly PostgresFixture _fixture;

    public Batch5ProducerApiTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    #region Project Creation with Initialization Tests

    [Fact]
    public async Task Producer_create_project_with_init_params_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest(
            "INIT-TEST",
            "Init Test Project",
            "Test project with init params",
            "v1",
            "l1",
            "EP01",
            "Episode 01",
            @"D:\missing\legacy-init.xlsx",
            [new ProjectScanRootRequest("shot-root", "Shots", "D:\\Shots", 1, true, @"D:\missing\legacy-init.xlsx")],
            [new ProjectScanRootRequest("layout-root", "Layouts", "D:\\Layouts", 1, true, null)]
        ), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        Assert.NotNull(project);
        Assert.Equal("INIT-TEST", project!.Project.Code);
        Assert.NotNull(project.InitialEpisode);
        Assert.Equal("partial_success", project.InitResult.Status);
        Assert.True(project.InitResult.ExcelImportAttempted);
        Assert.False(project.InitResult.ExcelImportSuccess);
        Assert.Contains(project.InitResult.PendingClientActions ?? [], action => action == "create_lens_folders");

        var episode = await adminClient.GetFromJsonAsync<EpisodeResponse>($"/api/projects/{project.Project.Code}/episodes/{project.InitialEpisode!.Id}", JsonOptions);
        Assert.NotNull(episode);
    }

    [Fact]
    public async Task Producer_create_project_with_members_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Get the producer user
        var producerUser = await GetUserByUserNameAsync(factory, "producer");
        
        // Create project with explicit members
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest(
            "MEMBER-TEST", 
            "Member Test Project", 
            null,
            "v1", 
            "l1",
            null, null, null, null, null,
            new[] { new ProjectMemberCreateRequest(producerUser.Id, "producer") }
        ), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        Assert.NotNull(project);
        
        // Verify member was added
        var members = await adminClient.GetFromJsonAsync<List<ProjectMemberResponse>>($"/api/project-members?projectCode={project!.Code}", JsonOptions);
        Assert.NotNull(members);
        Assert.NotEmpty(members!);
    }

    [Fact]
    public async Task Producer_creator_auto_added_if_not_in_members_list()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Create project without explicit members (admin is creator)
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest(
            "AUTO-MEMBER", 
            "Auto Member Project", 
            null,
            "v1", 
            "l1"
        ), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        Assert.NotNull(project);
        
        // Verify creator (admin) was automatically added
        var members = await adminClient.GetFromJsonAsync<List<ProjectMemberResponse>>($"/api/project-members?projectCode={project!.Code}", JsonOptions);
        Assert.NotNull(members);
        Assert.Single(members!); // Only admin (creator)
        Assert.Equal("producer", members![0].ProjectRoleCode);
    }

    [Fact]
    public async Task Producer_creator_is_forced_to_project_producer_even_if_explicitly_listed()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        var adminUser = await GetUserByUserNameAsync(factory, "admin");

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest(
            "AUTO-PRODUCER",
            "Auto Producer Project",
            null,
            "v1",
            "l1",
            null,
            null,
            null,
            null,
            null,
            new[] { new ProjectMemberCreateRequest(adminUser.Id, "maker") }
        ), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        Assert.NotNull(project);

        var members = await adminClient.GetFromJsonAsync<List<ProjectMemberResponse>>($"/api/project-members?projectCode={project!.Code}", JsonOptions);
        Assert.NotNull(members);
        Assert.Single(members!);
        Assert.Equal(adminUser.Id, members![0].UserId);
        Assert.Equal("producer", members[0].ProjectRoleCode);
    }

    [Fact]
    public async Task Producer_create_project_rejects_duplicate_member_entries()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        var producerUser = await GetUserByUserNameAsync(factory, "producer");

        var response = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest(
            "DUP-MEMBER",
            "Duplicate Member Project",
            null,
            "v1",
            "l1",
            null,
            null,
            null,
            null,
            null,
            new[]
            {
                new ProjectMemberCreateRequest(producerUser.Id, "producer"),
                new ProjectMemberCreateRequest(producerUser.Id, "maker")
            }
        ), JsonOptions);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Project_creation_returns_partial_success_when_initial_episode_requested_without_excel()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest(
            "NOEXCEL-INIT",
            "No Excel Init",
            null,
            "v1",
            "l1",
            "EP01",
            "Episode 01",
            null,
            null,
            null
        ), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        Assert.NotNull(project);
        Assert.Equal("partial_success", project!.InitResult.Status);
        Assert.NotNull(project.InitialEpisode);
    }

    [Fact]
    public async Task Project_creation_ignores_invalid_excel_and_returns_context()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest(
            "INVALID-EXCEL",
            "Invalid Excel",
            null,
            "v1",
            "l1",
            "EP01",
            "Episode 01",
            @"D:\missing\invalid.xlsx",
            [new ProjectScanRootRequest("shot-root", "Shots", "D:\\Shots", 1, true, @"D:\missing\invalid.xlsx")],
            null
        ), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        Assert.NotNull(project);
        Assert.Equal("partial_success", project!.InitResult.Status);
        Assert.NotNull(project.InitialEpisode);
    }

    [Fact]
    public async Task Batch_create_rejects_duplicate_lens_codes()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("DUP-LENS", "Duplicate Lens", null, "v1", "l1"), JsonOptions)
            .ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var response = await adminClient.PostAsJsonAsync($"/api/projects/{project.Code}/episodes/{episode!.Id}/lenses/batch", new LensBatchCreateRequest([
            new LensCreateRequest("L001", "Lens 001", 1, null, "root1", "/EP01/L001", null, null),
            new LensCreateRequest("L001", "Lens 001 Dup", 2, null, "root1", "/EP01/L001-DUP", null, null)
        ]), JsonOptions);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(JsonOptions);
        Assert.NotNull(payload);
        Assert.Equal("duplicate_lens_code", payload!.Code);
    }

    [Fact]
    public async Task Batch_create_rejects_duplicate_logical_paths()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("DUP-PATH", "Duplicate Path", null, "v1", "l1"), JsonOptions)
            .ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var response = await adminClient.PostAsJsonAsync($"/api/projects/{project.Code}/episodes/{episode!.Id}/lenses/batch", new LensBatchCreateRequest([
            new LensCreateRequest("L001", "Lens 001", 1, null, "root1", "/EP01/SHARED", null, null),
            new LensCreateRequest("L002", "Lens 002", 2, null, "root1", "/EP01/SHARED", null, null)
        ]), JsonOptions);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(JsonOptions);
        Assert.NotNull(payload);
        Assert.Equal("duplicate_lens_logical_path", payload!.Code);
    }

    [Fact]
    public async Task Batch_create_rejects_invalid_fields()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("BAD-FIELD", "Bad Field", null, "v1", "l1"), JsonOptions)
            .ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var response = await adminClient.PostAsJsonAsync($"/api/projects/{project.Code}/episodes/{episode!.Id}/lenses/batch", new LensBatchCreateRequest([
            new LensCreateRequest(" ", "Broken Lens", 0, null, null, null, null, null)
        ]), JsonOptions);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(JsonOptions);
        Assert.NotNull(payload);
        Assert.Equal("lens_code_required", payload!.Code);
    }

    [Fact]
    public async Task Non_member_cannot_batch_create_lenses()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("NO-BATCH-ACCESS", "No Batch Access", null, "v1", "l1"), JsonOptions)
            .ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var outsider = await adminClient.PostAsJsonAsync("/api/users", new CreateUserRequest("batch-outsider", "Batch Outsider", "BatchOutsider@123456"), JsonOptions)
            .ReadAsJsonAsync<UserResponse>(JsonOptions);

        using var outsiderClient = factory.CreateClient();
        var login = await LoginAsync(outsiderClient, "batch-outsider", "BatchOutsider@123456");
        outsiderClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);

        var response = await outsiderClient.PostAsJsonAsync($"/api/projects/{project.Code}/episodes/{episode!.Id}/lenses/batch", new LensBatchCreateRequest([
            new LensCreateRequest("L001", "Lens 001", 1, null, null, null, null, null)
        ]), JsonOptions);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    #endregion

    #region First Episode Lens Batch Creation Tests

    [Fact]
    public async Task Batch_create_lenses_for_first_episode_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Setup: create project, episode
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("BATCH-LENS", "Batch Lens", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        
        // Batch create lenses
        var lensBatchRequest = new LensBatchCreateRequest(new[]
        {
            new LensCreateRequest("L001", "Lens 001", 1, "First shot", "root1", "/EP01/L001", "v1", null),
            new LensCreateRequest("L002", "Lens 002", 2, "Second shot", "root1", "/EP01/L002", "v1", null),
            new LensCreateRequest("L003", "Lens 003", 3, "Third shot", "root1", "/EP01/L003", "v1", null),
        });
        
        var lenses = await adminClient.PostAsJsonAsync($"/api/projects/{project.Code}/episodes/{episode!.Id}/lenses/batch", lensBatchRequest, JsonOptions)
            .ReadAsJsonAsync<List<LensResponse>>(JsonOptions);
        
        Assert.NotNull(lenses);
        Assert.Equal(3, lenses!.Count);
    }

    [Fact]
    public async Task Batch_create_lenses_preserves_single_frame_and_maker()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);

        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("BATCH-MAKER", "Batch Maker", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var makerUser = await GetUserByUserNameAsync(factory, "maker");
        await adminClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest(project!.Code, makerUser.Id, "maker"), JsonOptions);

        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var lensBatchRequest = new LensBatchCreateRequest(new[]
        {
            new LensCreateRequest("L001", "Lens 001", 1, "First shot", "root1", "/EP01/L001", "v1", null, 12, "德刚"),
        });

        var lenses = await adminClient.PostAsJsonAsync($"/api/projects/{project.Code}/episodes/{episode!.Id}/lenses/batch", lensBatchRequest, JsonOptions)
            .ReadAsJsonAsync<List<LensResponse>>(JsonOptions);

        Assert.NotNull(lenses);
        Assert.Single(lenses!);
        Assert.Equal(12, lenses[0].SingleFrame);
        Assert.Equal("德刚", lenses[0].Maker);

        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        var saved = await dbContext.Lenses.SingleAsync(x => x.Code == "L001" && x.EpisodeId == episode!.Id);
        Assert.Equal(12, saved.SingleFrame);
        Assert.Equal("德刚", saved.Maker);
    }

    [Fact]
    public async Task Batch_create_rejects_existing_lens_codes()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Setup: create project, episode
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("SKIP-LENS", "Skip Lens", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        
        // Create one lens first
        await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 001", 1, null, null, null, null, null), JsonOptions);
        
        // Batch create with duplicate should fail atomically
        var lensBatchRequest = new LensBatchCreateRequest(new[]
        {
            new LensCreateRequest("L001", "Lens 001", 1, null, null, null, null, null),
            new LensCreateRequest("L002", "Lens 002", 2, null, null, null, null, null),
        });

        var response = await adminClient.PostAsJsonAsync($"/api/projects/{project.Code}/episodes/{episode.Id}/lenses/batch", lensBatchRequest, JsonOptions);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(JsonOptions);
        Assert.NotNull(payload);
        Assert.Equal("duplicate_lens_code", payload!.Code);
    }

    #endregion

    #region Project Member Management Tests

    [Fact]
    public async Task Producer_can_query_own_project_members()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Create project
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("QMEMBERS", "Query Members", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        // Query members - should work for project member
        var members = await adminClient.GetFromJsonAsync<List<ProjectMemberResponse>>($"/api/project-members?projectCode={project!.Code}", JsonOptions);
        
        Assert.NotNull(members);
        Assert.NotEmpty(members!);
    }

    [Fact]
    public async Task Producer_can_add_project_member()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Create project first
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("ADDMEMBER", "Add Member", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        // Get a non-member user
        var makerUser = await GetUserByUserNameAsync(factory, "maker");
        
        // Add member
        var member = await adminClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest(project!.Code, makerUser.Id, "maker"), JsonOptions)
            .ReadAsJsonAsync<ProjectMemberResponse>(JsonOptions);
        
        Assert.NotNull(member);
        Assert.Equal(makerUser.Id, member!.UserId);
    }

    [Fact]
    public async Task Producer_can_remove_project_member()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Create project first
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("REMOVEMEMBER", "Remove Member", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        // Get a non-member user
        var makerUser = await GetUserByUserNameAsync(factory, "maker");
        
        // Add member
        await adminClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest(project!.Code, makerUser.Id, "maker"), JsonOptions);
        
        // Remove member
        var response = await adminClient.DeleteAsync($"/api/project-members/{project.Code}/members/{makerUser.Id}");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Non_producer_cannot_add_project_member()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        using var makerClient = await CreateMakerClientAsync(factory);
        
        // Create project
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("NOPERM", "No Permission", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        // Get another user
        var directorUser = await GetUserByUserNameAsync(factory, "director");
        
        // Maker tries to add member - should fail
        var response = await makerClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest(project!.Code, directorUser.Id, "director"), JsonOptions);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    #endregion

    #region Lens Editing Permission Tests

    [Fact]
    public async Task Project_member_cannot_edit_lens_when_role_is_maker()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Create project and add a maker member
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("MEMEDIT", "Member Edit", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        var makerUser = await GetUserByUserNameAsync(factory, "maker");
        await adminClient.PostAsJsonAsync("/api/project-members", new CreateProjectMemberRequest(project!.Code, makerUser.Id, "maker"), JsonOptions);
        
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 001", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        // Login as maker and verify write is denied
        using var makerClient = await CreateMakerClientAsync(factory);
        var updateReq = new LensUpdateRequest("Updated Lens", null, null, null, null, null, null, lens!.RowVersion);
        var response = await makerClient.PutAsJsonAsync($"/api/lenses/{lens.Id}", updateReq, JsonOptions);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Non_project_member_cannot_edit_lens()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Create project (without maker as member)
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("NOEDIT", "No Edit", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        var episode = await adminClient.PostAsJsonAsync($"/api/projects/{project!.Code}/episodes", new EpisodeCreateRequest("E01", "Episode 1", 1, null), JsonOptions)
            .ReadAsJsonAsync<EpisodeResponse>(JsonOptions);
        var lens = await adminClient.PostAsJsonAsync($"/api/episodes/{episode!.Id}/lenses", new LensCreateRequest("L001", "Lens 001", 1, null, null, null, null, null), JsonOptions)
            .ReadAsJsonAsync<LensResponse>(JsonOptions);
        
        // Login as maker (not a project member)
        using var makerClient = await CreateMakerClientAsync(factory);
        var updateReq = new LensUpdateRequest("Try Edit", null, null, null, null, null, null, lens!.RowVersion);
        var response = await makerClient.PutAsJsonAsync($"/api/lenses/{lens.Id}", updateReq, JsonOptions);
        
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    #endregion

    #region Excel Initialization Warning Tests

    [Fact]
    public async Task Project_creation_response_when_no_excel_configured()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);

        using var adminClient = await CreateAdminClientAsync(factory);
        
        // Create project without init params
        var project = await adminClient.PostAsJsonAsync("/api/projects", new ProjectCreateRequest("NOEXCEL", "No Excel", null, "v1", "l1"), JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);
        
        Assert.NotNull(project);
        // Response should not have initialization completed - client should check separately
        // This test documents the behavior - no special warning is returned on creation
    }

    #endregion

    private static string CreateLensExcelFile(IReadOnlyList<(string Code, string Name, int Sequence, string? Description, string? RootCode, string? LogicalPath, string? VersionTag, string? LayoutTag, string? FolderName)> rows)
    {
        var path = Path.Combine(Path.GetTempPath(), $"lens-init-{Guid.NewGuid():N}.xlsx");

        using var document = SpreadsheetDocument.Create(path, SpreadsheetDocumentType.Workbook);
        var workbookPart = document.AddWorkbookPart();
        workbookPart.Workbook = new Workbook();

        var worksheetPart = workbookPart.AddNewPart<WorksheetPart>();
        var sheetData = new SheetData();
        worksheetPart.Worksheet = new Worksheet(sheetData);

        var sheets = workbookPart.Workbook.AppendChild(new Sheets());
        sheets.Append(new Sheet { Id = workbookPart.GetIdOfPart(worksheetPart), SheetId = 1, Name = "Sheet1" });

        sheetData.Append(CreateExcelRow(1, "Code", "Name", "Sequence", "Description", "RootCode", "LogicalPath", "VersionTag", "LayoutTag", "FolderName"));

        var rowIndex = 2;
        foreach (var row in rows)
        {
            sheetData.Append(CreateExcelRow(rowIndex++, row.Code, row.Name, row.Sequence.ToString(), row.Description, row.RootCode, row.LogicalPath, row.VersionTag, row.LayoutTag, row.FolderName));
        }

        workbookPart.Workbook.Save();
        worksheetPart.Worksheet.Save();
        return path;
    }

    private static Row CreateExcelRow(int rowIndex, params string?[] values)
    {
        var row = new Row { RowIndex = (uint)rowIndex };
        for (var i = 0; i < values.Length; i++)
        {
            row.Append(CreateExcelCell(rowIndex, i, values[i]));
        }

        return row;
    }

    private static Cell CreateExcelCell(int rowIndex, int columnIndex, string? value)
    {
        return new Cell
        {
            CellReference = $"{IndexToColumnName(columnIndex)}{rowIndex}",
            DataType = CellValues.String,
            CellValue = new CellValue(value ?? string.Empty)
        };
    }

    private static string IndexToColumnName(int index)
    {
        var value = index + 1;
        var letters = string.Empty;
        while (value > 0)
        {
            var remainder = (value - 1) % 26;
            letters = (char)('A' + remainder) + letters;
            value = (value - 1) / 26;
        }

        return letters;
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
        await EnsureCollaboratorUserAsync(dbContext, passwordHashService, "maker", "制作人员", "Maker@123456", "maker");
        await EnsureCollaboratorUserAsync(dbContext, passwordHashService, "director", "导演用户", "Director@123456", "director");
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

    private async Task<HttpClient> CreateAdminClientAsync(ServerApiFactory factory)
    {
        var client = factory.CreateClient();
        var login = await LoginAsync(client, "admin", DatabaseSeeder.AdminPassword);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        return client;
    }

    private async Task<HttpClient> CreateMakerClientAsync(ServerApiFactory factory)
    {
        var client = factory.CreateClient();
        var login = await LoginAsync(client, "maker", "Maker@123456");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        return client;
    }

    private static async Task<LoginResponse> LoginAsync(HttpClient client, string userName, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(userName, password), JsonOptions);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<LoginResponse>(JsonOptions))!;
    }

    private static async Task<User> GetUserByUserNameAsync(ServerApiFactory factory, string userName)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        return await dbContext.Users.FirstAsync(u => u.UserName == userName);
    }
}
