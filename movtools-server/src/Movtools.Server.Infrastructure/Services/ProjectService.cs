using Microsoft.EntityFrameworkCore;
using Movtools.Server.Application.Exceptions;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;
using System.Text.Json;

namespace Movtools.Server.Infrastructure.Services;

/// <summary>
/// 项目服务实现
/// </summary>
public sealed class ProjectService : IProjectService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly MovtoolsDbContext _dbContext;
    private readonly IPermissionService _permissionService;
    private readonly IActivityLogService _activityLogService;
    private readonly ICurrentUserAccessor _currentUserAccessor;

    public ProjectService(
        MovtoolsDbContext dbContext, 
        IPermissionService permissionService,
        IActivityLogService activityLogService,
        ICurrentUserAccessor currentUserAccessor)
    {
        _dbContext = dbContext;
        _permissionService = permissionService;
        _activityLogService = activityLogService;
        _currentUserAccessor = currentUserAccessor;
    }

    /// <inheritdoc/>
    public async Task<ProjectCreationResult> CreateAsync(CreateProjectRequest request, CancellationToken cancellationToken = default)
    {
        var normalizedCode = request.Code.Trim().ToUpperInvariant();
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        
        // 检查项目代码是否已存在
        var existingProject = await _dbContext.Projects.FirstOrDefaultAsync(x => x.Code == normalizedCode, cancellationToken);
        if (existingProject != null)
        {
            if (!existingProject.IsArchived)
            {
                throw new BusinessException("project_code_exists", "The project code already exists.");
            }

            await RemoveProjectScopedDataAsync(existingProject, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        var project = new Project
        {
            Code = normalizedCode,
            Name = request.Name.Trim(),
            Description = request.Description?.Trim(),
            ProjectRootPath = NormalizeOptionalValue(request.ProjectRootPath),
            LensFolderRootPath = NormalizeOptionalValue(request.LensFolderRootPath),
            MaCheckPath = NormalizeOptionalValue(request.MaCheckPath),
            MovCheckPath = NormalizeOptionalValue(request.MovCheckPath),
            LayoutCheckPath = NormalizeOptionalValue(request.LayoutCheckPath),
            ProjectDefaultFps = NormalizeProjectDefaultFps(request.ProjectDefaultFps),
            VersionTag = request.VersionTag.Trim(),
            LayoutTag = request.LayoutTag.Trim(),
            InitExcelPath = NormalizeOptionalValue(request.InitExcelPath),
            LensRootsJson = SerializeRootSnapshots(request.LensRoots, request.InitExcelPath, "ma"),
            LayoutRootsJson = SerializeRootSnapshots(request.LayoutRoots, request.InitExcelPath, "layout"),
            IsArchived = false,
            RowVersion = 1
        };

        _dbContext.Projects.Add(project);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 处理项目成员
        var currentUserId = _currentUserAccessor.UserId;

        // 如果传入了显式成员列表，先处理这些成员
        var explicitMemberUserIds = new HashSet<Guid>();
        if (request.Members != null && request.Members.Count > 0)
        {
            foreach (var memberReq in request.Members)
            {
                if (!explicitMemberUserIds.Add(memberReq.UserId))
                {
                    throw new BusinessException("project_member_duplicate", $"Duplicate project member entries were provided for user {memberReq.UserId}.");
                }

                var user = await _dbContext.Users.FirstOrDefaultAsync(x => x.Id == memberReq.UserId, cancellationToken);
                if (user == null)
                {
                    throw new NotFoundAppException("user_not_found", $"User {memberReq.UserId} could not be found.");
                }

                var normalizedProjectRoleCode = memberReq.ProjectRoleCode.Trim().ToLowerInvariant();
                if (currentUserId.HasValue && memberReq.UserId == currentUserId.Value)
                {
                    normalizedProjectRoleCode = "producer";
                }

                _dbContext.ProjectMembers.Add(new ProjectMember
                {
                    ProjectCode = project.Code,
                    UserId = memberReq.UserId,
                    ProjectRoleCode = normalizedProjectRoleCode,
                    IsActive = true,
                });
            }
        }

        // 确保创建者自动入项目，默认以项目制片身份加入
        if (currentUserId.HasValue && !explicitMemberUserIds.Contains(currentUserId.Value))
        {
            _dbContext.ProjectMembers.Add(new ProjectMember
            {
                ProjectCode = project.Code,
                UserId = currentUserId.Value,
                ProjectRoleCode = "producer",
                IsActive = true,
            });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // 记录项目创建日志
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser != null)
        {
            var initInfo = new List<string> { $"Code:{project.Code}|Name:{project.Name}" };
            if (!string.IsNullOrWhiteSpace(request.InitialEpisodeCode))
            {
                initInfo.Add($"InitialEpisode:{request.InitialEpisodeCode}");
            }
            await _activityLogService.LogAsync(
                "Project", 
                project.Id, 
                "created", 
                null, 
                string.Join("|", initInfo),
                cancellationToken);
        }

        var projectResult = MapToResult(project);

        if (!HasInitialEpisodeRequest(request))
        {
            await transaction.CommitAsync(cancellationToken);
            return new ProjectCreationResult(projectResult, null, ProjectInitializationResultBuilder.NotRequested());
        }

        var initialEpisode = new Episode
        {
            Code = request.InitialEpisodeCode!.Trim().ToUpperInvariant(),
            Name = request.InitialEpisodeName!.Trim(),
            Sequence = 1,
            Description = null,
            LensFolderRootPath = NormalizeOptionalValue(request.LensFolderRootPath)
                ?? GetPrimaryEnabledRootPath(request.LensRoots)
                ?? NormalizeOptionalValue(project.LensFolderRootPath),
            LayoutCheckPath = NormalizeOptionalValue(request.LayoutCheckPath)
                ?? GetPrimaryEnabledRootPath(request.LayoutRoots)
                ?? NormalizeOptionalValue(project.LayoutCheckPath),
            ProjectId = project.Id,
            IsArchived = false,
            RowVersion = 1
        };

        _dbContext.Episodes.Add(initialEpisode);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var initialEpisodeResult = MapToResult(initialEpisode, project);

        var initResult = await TryInitializeFirstEpisodeAsync(project, initialEpisode, request, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new ProjectCreationResult(projectResult, initialEpisodeResult, initResult);
    }

    /// <inheritdoc/>
    public async Task<ProjectResult> GetByCodeAsync(string code, CancellationToken cancellationToken = default)
    {
        var normalizedCode = code.Trim().ToUpperInvariant();
        
        var project = await _dbContext.Projects.FirstOrDefaultAsync(x => x.Code == normalizedCode, cancellationToken)
            ?? throw new NotFoundAppException("project_not_found", "The project could not be found.");
        await EnsureLegacyProjectPathCompatibilityAsync(project, cancellationToken);
        await BackfillEpisodeFormalPathsAsync(project, cancellationToken);

        // 检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        var canAccess = await _permissionService.CanAccessProjectAsync(normalizedCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this project.");
        }

        return MapToResult(project);
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<ProjectResult>> GetListAsync(CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser();
        
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        // 检查是否为管理员 - 管理员可查看所有项目
        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        
        List<Project> projects;
        
        if (isAdmin)
        {
            // 管理员看到所有未归档的项目
            projects = await _dbContext.Projects
                .Where(x => !x.IsArchived)
                .OrderBy(x => x.Code)
                .ToListAsync(cancellationToken);
        }
        else
        {
            // 普通用户只看到所属的项目
            var memberProjectCodes = await _dbContext.ProjectMembers
                .Where(x => x.UserId == currentUser.Id && x.IsActive)
                .Select(x => x.ProjectCode)
                .Distinct()
                .ToListAsync(cancellationToken);

            projects = await _dbContext.Projects
                .Where(x => !x.IsArchived && memberProjectCodes.Contains(x.Code))
                .OrderBy(x => x.Code)
                .ToListAsync(cancellationToken);
        }

        foreach (var project in projects)
        {
            await EnsureLegacyProjectPathCompatibilityAsync(project, cancellationToken);
            await BackfillEpisodeFormalPathsAsync(project, cancellationToken);
        }

        return projects.Select(MapToResult).ToArray();
    }

    /// <inheritdoc/>
    public async Task<ProjectResult> UpdateAsync(string code, UpdateProjectRequest request, long rowVersion, CancellationToken cancellationToken = default)
    {
        var normalizedCode = code.Trim().ToUpperInvariant();
        
        var project = await _dbContext.Projects.FirstOrDefaultAsync(x => x.Code == normalizedCode, cancellationToken)
            ?? throw new NotFoundAppException("project_not_found", "The project could not be found.");
        await EnsureLegacyProjectPathCompatibilityAsync(project, cancellationToken);
        await BackfillEpisodeFormalPathsAsync(project, cancellationToken);

        // 检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        var canAccess = await _permissionService.CanAccessProjectAsync(normalizedCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to modify this project.");
        }

        // 并发控制检查
        if (project.RowVersion != rowVersion)
        {
            throw new BusinessException("concurrency_conflict", "The project has been modified by another user. Please refresh and try again.");
        }

        // 记录旧值用于日志
        var oldValue = $"Code:{project.Code}|Name:{project.Name}|VersionTag:{project.VersionTag}|LayoutTag:{project.LayoutTag}";

        project.Name = request.Name.Trim();
        project.Description = request.Description?.Trim();
        project.ProjectRootPath = NormalizeOptionalValue(request.ProjectRootPath);
        project.LensFolderRootPath = NormalizeOptionalValue(request.LensFolderRootPath);
        project.MaCheckPath = NormalizeOptionalValue(request.MaCheckPath);
        project.MovCheckPath = NormalizeOptionalValue(request.MovCheckPath);
        project.LayoutCheckPath = NormalizeOptionalValue(request.LayoutCheckPath);
        project.VersionTag = request.VersionTag.Trim();
        project.LayoutTag = request.LayoutTag.Trim();
        project.RowVersion = rowVersion + 1;

        await _dbContext.SaveChangesAsync(cancellationToken);

        // 记录项目更新日志
        await _activityLogService.LogAsync(
            "Project", 
            project.Id, 
            "updated", 
            oldValue, 
            $"Code:{project.Code}|Name:{project.Name}|VersionTag:{project.VersionTag}|LayoutTag:{project.LayoutTag}",
            cancellationToken);

        return MapToResult(project);
    }

    /// <inheritdoc/>
    public async Task<bool> ExistsAsync(string code, CancellationToken cancellationToken = default)
    {
        var normalizedCode = code.Trim().ToUpperInvariant();
        return await _dbContext.Projects.AnyAsync(x => x.Code == normalizedCode && !x.IsArchived, cancellationToken);
    }

    /// <inheritdoc/>
    public async Task DeleteAsync(string code, CancellationToken cancellationToken = default)
    {
        var normalizedCode = code.Trim().ToUpperInvariant();
        
        var project = await _dbContext.Projects.FirstOrDefaultAsync(x => x.Code == normalizedCode, cancellationToken)
            ?? throw new NotFoundAppException("project_not_found", "The project could not be found.");

        await RemoveProjectScopedDataAsync(project, cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 记录删除日志
        await _activityLogService.LogAsync(
            "Project", 
            project.Id, 
            "deleted", 
            $"Code:{project.Code}|Name:{project.Name}", 
            null,
            cancellationToken);
    }

    /// <summary>
    /// 映射到结果对象
    /// </summary>
    private static ProjectResult MapToResult(Project project) => new(
        project.Id,
        project.Code,
        project.Name,
        project.Description,
        project.VersionTag,
        project.LayoutTag,
        project.IsArchived,
        project.RowVersion,
        project.CreatedAtUtc,
        project.UpdatedAtUtc,
        project.InitExcelPath,
        project.ProjectRootPath,
        project.LensFolderRootPath,
        project.MaCheckPath,
        project.MovCheckPath,
        project.LayoutCheckPath,
        project.ProjectDefaultFps,
        DeserializeRootSnapshots(project.LensRootsJson, "ma"),
        DeserializeRootSnapshots(project.LayoutRootsJson, "layout"));

    private static EpisodeResult MapToResult(Episode episode, Project project) => new(
        episode.Id,
        episode.Code,
        episode.Name,
        episode.Sequence,
        episode.Description,
        episode.ProjectId,
        project.Code,
        episode.IsArchived,
        episode.RowVersion,
        episode.CreatedAtUtc,
        episode.UpdatedAtUtc,
        project.VersionTag,
        project.LayoutTag,
        project.InitExcelPath,
        project.ProjectRootPath,
        episode.LensFolderRootPath ?? project.LensFolderRootPath,
        project.MaCheckPath,
        project.MovCheckPath,
        episode.LayoutCheckPath ?? project.LayoutCheckPath,
        DeserializeRootSnapshots(project.LensRootsJson, "ma"),
        DeserializeRootSnapshots(project.LayoutRootsJson, "layout"));

    private static bool HasInitialEpisodeRequest(CreateProjectRequest request)
    {
        var hasCode = !string.IsNullOrWhiteSpace(request.InitialEpisodeCode);
        var hasName = !string.IsNullOrWhiteSpace(request.InitialEpisodeName);
        return hasCode && hasName;
    }

    private static string? NormalizeOptionalValue(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    private static int NormalizeProjectDefaultFps(int value) => value > 0 ? value : 30;

    private static string? SerializeRootSnapshots(IReadOnlyList<ProjectScanRootRequest>? roots, string? fallbackInitExcelPath, string defaultFileKind)
    {
        var snapshots = (roots ?? Array.Empty<ProjectScanRootRequest>())
            .Select(root => new ProjectRootSnapshot(
                NormalizeOptionalValue(root.RootId),
                NormalizeOptionalValue(root.Label),
                root.AbsolutePath.Trim(),
                root.Priority,
                root.IsEnabled,
                NormalizeOptionalValue(root.InitExcelPath) ?? NormalizeOptionalValue(fallbackInitExcelPath),
                NormalizeFileKind(root.FileKind, defaultFileKind, fallbackInitExcelPath, root.Label)))
            .ToArray();

        return snapshots.Length == 0 ? null : JsonSerializer.Serialize(snapshots, JsonOptions);
    }

    private static IReadOnlyList<ProjectRootResult> DeserializeRootSnapshots(string? json, string defaultFileKind)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return Array.Empty<ProjectRootResult>();
        }

        try
        {
            var snapshots = JsonSerializer.Deserialize<ProjectRootSnapshot[]>(json, JsonOptions) ?? [];
            return snapshots.Select(snapshot => new ProjectRootResult(
                snapshot.RootId,
                snapshot.Label,
                snapshot.AbsolutePath,
                snapshot.Priority,
                snapshot.IsEnabled,
                snapshot.InitExcelPath,
                NormalizeFileKind(snapshot.FileKind, defaultFileKind, snapshot.InitExcelPath, snapshot.Label))).ToArray();
        }
        catch (JsonException)
        {
            return Array.Empty<ProjectRootResult>();
        }
    }

    private async Task BackfillEpisodeFormalPathsAsync(Project project, CancellationToken cancellationToken)
    {
        var episodes = await _dbContext.Episodes
            .Where(x => x.ProjectId == project.Id && (x.LensFolderRootPath == null || x.LayoutCheckPath == null))
            .ToListAsync(cancellationToken);

        if (episodes.Count == 0)
        {
            return;
        }

        foreach (var episode in episodes)
        {
            var projectPrimaryLensRoot = NormalizeOptionalValue(project.LensFolderRootPath)
                ?? GetPrimaryEnabledRootPath(DeserializeRootSnapshots(project.LensRootsJson, "ma"));
            var projectPrimaryLayoutRoot = NormalizeOptionalValue(project.LayoutCheckPath)
                ?? GetPrimaryEnabledRootPath(DeserializeRootSnapshots(project.LayoutRootsJson, "layout"));

            if (IsSamePathLike(episode.LensFolderRootPath, project.ProjectRootPath) && !string.IsNullOrWhiteSpace(projectPrimaryLensRoot))
            {
                episode.LensFolderRootPath = projectPrimaryLensRoot;
            }
            else
            {
                episode.LensFolderRootPath ??= projectPrimaryLensRoot;
            }

            if (IsSamePathLike(episode.LayoutCheckPath, project.ProjectRootPath) && !string.IsNullOrWhiteSpace(projectPrimaryLayoutRoot))
            {
                episode.LayoutCheckPath = projectPrimaryLayoutRoot;
            }
            else
            {
                episode.LayoutCheckPath ??= projectPrimaryLayoutRoot;
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private static string NormalizeFileKind(string? value, string defaultFileKind, string? initExcelPath, string? label)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        if (!string.IsNullOrWhiteSpace(normalized))
        {
            return normalized;
        }

        var source = $"{initExcelPath} {label}".ToLowerInvariant();
        if (source.Contains("layout"))
        {
            return "layout";
        }

        if (source.Contains("mov"))
        {
            return "mov";
        }

        return defaultFileKind;
    }

    private static string? GetPrimaryEnabledRootPath(IReadOnlyList<ProjectScanRootRequest>? roots)
    {
        if (roots == null || roots.Count == 0)
        {
            return null;
        }

        return roots
            .Where(root => root.IsEnabled ?? true)
            .Select(root => NormalizeOptionalValue(root.AbsolutePath))
            .FirstOrDefault(path => !string.IsNullOrWhiteSpace(path));
    }

    private static string? GetPrimaryEnabledRootPath(IReadOnlyList<ProjectRootSnapshot>? roots)
    {
        if (roots == null || roots.Count == 0)
        {
            return null;
        }

        return roots
            .Where(root => root.IsEnabled ?? true)
            .Select(root => NormalizeOptionalValue(root.AbsolutePath))
            .FirstOrDefault(path => !string.IsNullOrWhiteSpace(path));
    }

    private static string? GetPrimaryEnabledRootPath(IReadOnlyList<ProjectRootResult>? roots)
    {
        if (roots == null || roots.Count == 0)
        {
            return null;
        }

        return roots
            .Where(root => root.IsEnabled ?? true)
            .Select(root => NormalizeOptionalValue(root.AbsolutePath))
            .FirstOrDefault(path => !string.IsNullOrWhiteSpace(path));
    }

    private async Task EnsureLegacyProjectPathCompatibilityAsync(Project project, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(project.ProjectRootPath))
        {
            return;
        }

        var legacyPath = NormalizeOptionalValue(project.Description);
        if (IsAbsolutePathLike(legacyPath))
        {
            project.ProjectRootPath = legacyPath;
            project.Description = null;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    private static bool IsAbsolutePathLike(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var trimmed = value.Trim();
        return System.Text.RegularExpressions.Regex.IsMatch(trimmed, @"^[A-Za-z]:[\\/].+") || trimmed.StartsWith("\\\\");
    }

    private static bool IsSamePathLike(string? left, string? right)
    {
        var normalizedLeft = NormalizePathLike(left);
        var normalizedRight = NormalizePathLike(right);
        return !string.IsNullOrWhiteSpace(normalizedLeft) && normalizedLeft == normalizedRight;
    }

    private static string? NormalizePathLike(string? value)
    {
        var normalized = NormalizeOptionalValue(value);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return null;
        }

        return normalized.Replace('/', '\\').TrimEnd('\\').ToUpperInvariant();
    }

    private async Task RemoveProjectScopedDataAsync(Project project, CancellationToken cancellationToken)
    {
        var members = await _dbContext.ProjectMembers
            .Where(x => x.ProjectCode == project.Code)
            .ToListAsync(cancellationToken);

        if (members.Count > 0)
        {
            _dbContext.ProjectMembers.RemoveRange(members);
        }

        _dbContext.Projects.Remove(project);
    }

    private Task<ProjectInitializationResult> TryInitializeFirstEpisodeAsync(
        Project project,
        Episode episode,
        CreateProjectRequest request,
        CancellationToken cancellationToken)
    {
        _ = project;
        _ = episode;
        _ = request;
        _ = cancellationToken;

        return Task.FromResult(ProjectInitializationResultBuilder.PartialSuccess(
            "Initial episode created. Continue initialization on the client side by syncing lenses and creating local folders.",
            ["create_lens_folders", "refresh_local_episode_workspace"]));
    }

    private sealed class ProjectInitializationResultBuilder
    {
        public static ProjectInitializationResult NotRequested() => new(
            "not_requested",
            "No initial episode was requested.",
            false,
            false,
            null,
            null,
            null,
            [],
            []);

        public static ProjectInitializationResult Skipped(string message, IReadOnlyList<string> pendingClientActions) => new(
            "skipped",
            message,
            false,
            false,
            null,
            null,
            null,
            pendingClientActions,
            []);

        public static ProjectInitializationResult PartialSuccess(string message, IReadOnlyList<string> pendingClientActions) => new(
            "partial_success",
            message,
            true,
            false,
            null,
            null,
            null,
            pendingClientActions,
            []);

        public static ProjectInitializationResult Success(int createdLensCount, int lensFoldersPlanned, IReadOnlyList<string> pendingClientActions)
        {
            var hasPendingClientActions = pendingClientActions.Count > 0;
            var status = hasPendingClientActions ? "partial_success" : "success";
            var message = hasPendingClientActions
                ? $"Initialization completed with pending client actions: {string.Join(", ", pendingClientActions)}."
                : "Initialization completed successfully.";

            return new ProjectInitializationResult(
                status,
                message,
                true,
                true,
                createdLensCount,
                lensFoldersPlanned,
                0,
                pendingClientActions,
                []);
        }

        public static ProjectInitializationResult Failed(string message, IReadOnlyList<string> errors) => new(
            "failed",
            message,
            true,
            false,
            null,
            null,
            null,
            [],
            errors);
    }

    private sealed record ProjectRootSnapshot(string? RootId, string? Label, string AbsolutePath, int? Priority, bool? IsEnabled, string? InitExcelPath, string? FileKind);
}
