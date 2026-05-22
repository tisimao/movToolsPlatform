namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 项目服务接口
/// </summary>
public interface IProjectService
{
    /// <summary>
    /// 创建项目
    /// </summary>
    Task<ProjectCreationResult> CreateAsync(CreateProjectRequest request, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 根据代码获取项目
    /// </summary>
    Task<ProjectResult> GetByCodeAsync(string code, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取项目列表
    /// </summary>
    Task<IReadOnlyList<ProjectResult>> GetListAsync(CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 更新项目
    /// </summary>
    Task<ProjectResult> UpdateAsync(string code, UpdateProjectRequest request, long rowVersion, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 检查项目是否存在
    /// </summary>
    Task<bool> ExistsAsync(string code, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 删除项目
    /// </summary>
    Task DeleteAsync(string code, CancellationToken cancellationToken = default);
}

/// <summary>
/// 创建项目请求 - 支持初始化参数
/// </summary>
public record CreateProjectRequest(
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
    IReadOnlyList<ProjectMemberRequest>? Members = null,
    string? ProjectRootPath = null,
    string? LensFolderRootPath = null,
    string? MaCheckPath = null,
    string? MovCheckPath = null,
    string? LayoutCheckPath = null);

/// <summary>
/// 创建项目初始化根目录请求
/// </summary>
public record ProjectScanRootRequest(
    string? RootId,
    string? Label,
    string AbsolutePath,
    int? Priority = null,
    bool? IsEnabled = null,
    string? InitExcelPath = null,
    string? FileKind = null);

/// <summary>
/// 项目成员创建请求
/// </summary>
public record ProjectMemberRequest(Guid UserId, string ProjectRoleCode);

/// <summary>
/// 项目根目录协同快照
/// </summary>
public record ProjectRootResult(
    string? RootId,
    string? Label,
    string AbsolutePath,
    int? Priority,
    bool? IsEnabled,
    string? InitExcelPath,
    string FileKind);

/// <summary>
/// 更新项目请求
/// </summary>
public record UpdateProjectRequest(string Name, string? Description, string VersionTag, string LayoutTag, string? ProjectRootPath = null, string? LensFolderRootPath = null, string? MaCheckPath = null, string? MovCheckPath = null, string? LayoutCheckPath = null);

/// <summary>
/// 项目结果
/// </summary>
public record ProjectResult(
    Guid Id,
    string Code,
    string Name,
    string? Description,
    string VersionTag,
    string LayoutTag,
    bool IsArchived,
    long RowVersion,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    string? InitExcelPath,
    string? ProjectRootPath,
    string? LensFolderRootPath,
    string? MaCheckPath,
    string? MovCheckPath,
    string? LayoutCheckPath,
    IReadOnlyList<ProjectRootResult> LensRoots,
    IReadOnlyList<ProjectRootResult> LayoutRoots);

/// <summary>
/// 项目初始化结果
/// </summary>
public record ProjectInitializationResult(
    string Status,
    string Message,
    bool ExcelImportAttempted,
    bool ExcelImportSuccess,
    int? CreatedLensCount,
    int? LensFoldersPlanned,
    int? LensFoldersCreated,
    IReadOnlyList<string>? PendingClientActions,
    IReadOnlyList<string>? Errors);

/// <summary>
/// 创建项目结果
/// </summary>
public record ProjectCreationResult(
    ProjectResult Project,
    EpisodeResult? InitialEpisode,
    ProjectInitializationResult InitResult);
