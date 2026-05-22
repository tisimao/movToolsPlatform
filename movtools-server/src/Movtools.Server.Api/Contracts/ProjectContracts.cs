using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Contracts;

/// <summary>
/// 项目创建请求 - 支持初始化参数
/// </summary>
public record ProjectCreateRequest(
    string Code,
    string Name,
    string? Description,
    string VersionTag,
    string LayoutTag,
    string? InitialEpisodeCode = null,
    string? InitialEpisodeName = null,
    string? InitExcelPath = null,
    IReadOnlyList<ProjectScanRootRequest>? LensRoots = null,
    IReadOnlyList<ProjectScanRootRequest>? LayoutRoots = null,
    IReadOnlyList<ProjectMemberCreateRequest>? Members = null,
    string? ProjectRootPath = null,
    string? LensFolderRootPath = null,
    string? MaCheckPath = null,
    string? MovCheckPath = null,
    string? LayoutCheckPath = null);

/// <summary>
/// 项目初始化根目录请求
/// </summary>
public record ProjectScanRootRequest(
    string? RootId,
    string? Label,
    string AbsolutePath,
    int? Priority = null,
    bool? IsEnabled = null,
    string? InitExcelPath = null,
    string? FileKind = null);

public record ProjectScanRootResponse(
    string? RootId,
    string? Label,
    string AbsolutePath,
    int? Priority,
    bool? IsEnabled,
    string? InitExcelPath,
    string FileKind);

/// <summary>
/// 项目成员创建请求
/// </summary>
public record ProjectMemberCreateRequest(Guid UserId, string ProjectRoleCode);

public record ProjectUpdateRequest(string Name, string? Description, string VersionTag, string LayoutTag, long RowVersion, string? ProjectRootPath = null, string? LensFolderRootPath = null, string? MaCheckPath = null, string? MovCheckPath = null, string? LayoutCheckPath = null);

public record ProjectResponse(
    string Code,
    string Name,
    string? Description,
    string VersionTag,
    string LayoutTag,
    string? InitExcelPath,
    string? ProjectRootPath,
    string? LensFolderRootPath,
    string? MaCheckPath,
    string? MovCheckPath,
    string? LayoutCheckPath,
    IReadOnlyList<ProjectScanRootResponse> LensRoots,
    IReadOnlyList<ProjectScanRootResponse> LayoutRoots,
    bool IsArchived,
    long RowVersion,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);

public record ProjectCreateResponse(
    ProjectResponse Project,
    EpisodeResponse? InitialEpisode,
    ProjectInitializationResult InitResult)
{
    public string Code => Project.Code;
    public string Name => Project.Name;
    public string? Description => Project.Description;
    public string VersionTag => Project.VersionTag;
    public string LayoutTag => Project.LayoutTag;
    public string? InitExcelPath => Project.InitExcelPath;
    public string? ProjectRootPath => Project.ProjectRootPath;
    public string? LensFolderRootPath => Project.LensFolderRootPath;
    public string? MaCheckPath => Project.MaCheckPath;
    public string? MovCheckPath => Project.MovCheckPath;
    public string? LayoutCheckPath => Project.LayoutCheckPath;
    public IReadOnlyList<ProjectScanRootResponse> LensRoots => Project.LensRoots;
    public IReadOnlyList<ProjectScanRootResponse> LayoutRoots => Project.LayoutRoots;
}


public record RoleResponse(Guid Id, string Name, string Description, string DisplayName, bool IsActive);

public record ProjectMemberResponse(
    Guid Id,
    string ProjectCode,
    Guid UserId,
    string UserName,
    string DisplayName,
    string ProjectRoleCode,
    bool IsActive);

public record CreateProjectMemberRequest(string ProjectCode, Guid UserId, string ProjectRoleCode);
