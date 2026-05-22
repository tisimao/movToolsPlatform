using Microsoft.EntityFrameworkCore;
using Movtools.Server.Application.Exceptions;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;
using System.Text.Json;

namespace Movtools.Server.Infrastructure.Services;

/// <summary>
/// 剧集服务实现
/// </summary>
public sealed class EpisodeService : IEpisodeService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly MovtoolsDbContext _dbContext;
    private readonly IPermissionService _permissionService;
    private readonly IActivityLogService _activityLogService;
    private readonly ICurrentUserAccessor _currentUserAccessor;

    public EpisodeService(
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
    public async Task<IReadOnlyList<LensResult>> CreateLensesBatchAsync(string projectCode, Guid episodeId, IReadOnlyList<CreateLensRequest> lenses, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(projectCode))
        {
            throw new ValidationAppException("project_code_required", "Project code is required.");
        }

        if (lenses == null || lenses.Count == 0)
        {
            throw new ValidationAppException("lenses_required", "Lenses list is required.");
        }

        var normalizedProjectCode = projectCode.Trim().ToUpperInvariant();

        var episode = await _dbContext.Episodes
            .Include(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == episodeId, cancellationToken)
            ?? throw new NotFoundAppException("episode_not_found", "The episode could not be found.");

        // 检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        if (!await _permissionService.CanWriteLensAsync(episode.Project.Code, currentUser.Id, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this project.");
        }

        if (!string.Equals(episode.Project.Code, normalizedProjectCode, StringComparison.OrdinalIgnoreCase))
        {
            throw new NotFoundAppException("episode_not_found", "The episode could not be found.");
        }

        var normalizedRequests = NormalizeLensBatchRequests(lenses);
        var existingLenses = await _dbContext.Lenses
            .Where(x => x.EpisodeId == episodeId && !x.IsArchived)
            .Select(x => new { x.Code, x.LogicalPath })
            .ToListAsync(cancellationToken);

        var existingCodes = new HashSet<string>(existingLenses.Select(x => x.Code), StringComparer.OrdinalIgnoreCase);
        var existingLogicalPaths = new HashSet<string>(
            existingLenses
                .Where(x => !string.IsNullOrWhiteSpace(x.LogicalPath))
                .Select(x => NormalizeBatchLogicalPath(x.LogicalPath!))
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(path => path!),
            StringComparer.OrdinalIgnoreCase);

        var seenCodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var seenLogicalPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var req in normalizedRequests)
        {
            if (!seenCodes.Add(req.Code))
            {
                throw new BusinessException("duplicate_lens_code", $"Duplicate lens code found in batch: {req.Code}.");
            }

            if (existingCodes.Contains(req.Code))
            {
                throw new BusinessException("duplicate_lens_code", $"Lens code already exists in this episode: {req.Code}.");
            }

            var logicalPath = NormalizeBatchLogicalPath(req.LogicalPath);
            if (!string.IsNullOrWhiteSpace(logicalPath))
            {
                if (!seenLogicalPaths.Add(logicalPath))
                {
                    throw new BusinessException("duplicate_lens_logical_path", $"Duplicate lens logical path found in batch: {req.LogicalPath}.");
                }

                if (existingLogicalPaths.Contains(logicalPath))
                {
                    throw new BusinessException("duplicate_lens_logical_path", $"Lens logical path already exists in this episode: {req.LogicalPath}.");
                }
            }
        }

        var results = new List<LensResult>();

        foreach (var req in normalizedRequests)
        {
            var lens = new Lens
            {
                Code = req.Code,
                Name = req.Name,
                Sequence = req.Sequence,
                SingleFrame = req.SingleFrame,
                Description = req.Description,
                RootCode = req.RootCode,
                LogicalPath = req.LogicalPath,
                VersionTag = req.VersionTag,
                LayoutTag = req.LayoutTag,
                EpisodeId = episodeId,
                Status = LensStatuses.Wip,
                IsArchived = false,
                RowVersion = 1
            };

            var makerState = await ResolveMakerStateAsync(
                episode.Project.Code,
                req.MakerUserId,
                req.MakerNameRaw,
                req.MakerMatchStatus,
                req.Maker,
                lens,
                cancellationToken);

            lens.MakerUserId = makerState.MakerUserId;
            lens.MakerNameRaw = makerState.MakerNameRaw;
            lens.MakerMatchStatus = makerState.MakerMatchStatus;
            lens.Maker = makerState.LegacyMaker;

            _dbContext.Lenses.Add(lens);
            results.Add(await MapToLensResultAsync(lens, cancellationToken));
        }

        if (results.Count > 0)
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            
            // 记录批量创建日志
            await _activityLogService.LogAsync(
                "Episode",
                episode.Id,
                "lenses_batch_created",
                null,
                $"Count:{results.Count}|Episode:{episode.Code}",
                cancellationToken);
        }

        return results;
    }

    private static List<CreateLensRequest> NormalizeLensBatchRequests(IReadOnlyList<CreateLensRequest> lenses)
    {
        var normalized = new List<CreateLensRequest>(lenses.Count);

        for (var index = 0; index < lenses.Count; index++)
        {
            var req = lenses[index] ?? throw new ValidationAppException("lens_required", $"Lens item at index {index + 1} is required.");

            if (string.IsNullOrWhiteSpace(req.Code))
            {
                throw new ValidationAppException("lens_code_required", $"Lens code is required at index {index + 1}.");
            }

            if (string.IsNullOrWhiteSpace(req.Name))
            {
                throw new ValidationAppException("lens_name_required", $"Lens name is required at index {index + 1}.");
            }

            if (req.Sequence <= 0)
            {
                throw new ValidationAppException("lens_sequence_invalid", $"Lens sequence must be a positive integer at index {index + 1}.");
            }

            normalized.Add(new CreateLensRequest(
                req.Code.Trim().ToUpperInvariant(),
                req.Name.Trim(),
                req.Sequence,
                TrimOrNull(req.Description),
                TrimOrNull(req.RootCode),
                TrimOrNull(req.LogicalPath),
                TrimOrNull(req.VersionTag),
                TrimOrNull(req.LayoutTag),
                req.SingleFrame,
                TrimOrNull(req.Maker))
            {
                MakerUserId = req.MakerUserId,
                MakerNameRaw = req.MakerNameRaw,
                MakerMatchStatus = req.MakerMatchStatus
            });
        }

        return normalized;
    }

    private static string? NormalizeBatchLogicalPath(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToUpperInvariant();

    private static string? TrimOrNull(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static bool HasMakerInput(Guid? makerUserId, string? makerNameRaw, string? makerMatchStatus, string? maker)
        => makerUserId.HasValue
           || !string.IsNullOrWhiteSpace(makerNameRaw)
           || !string.IsNullOrWhiteSpace(makerMatchStatus)
           || !string.IsNullOrWhiteSpace(maker);

    private async Task<MakerResolution> ResolveMakerStateAsync(
        string projectCode,
        Guid? makerUserId,
        string? makerNameRaw,
        string? makerMatchStatus,
        string? makerLegacy,
        Lens? existingLens,
        CancellationToken cancellationToken)
    {
        var normalizedStatus = string.IsNullOrWhiteSpace(makerMatchStatus)
            ? (makerUserId.HasValue
                ? LensMakerMatchStatuses.Matched
                : !string.IsNullOrWhiteSpace(makerNameRaw) || !string.IsNullOrWhiteSpace(makerLegacy)
                    ? LensMakerMatchStatuses.Unmatched
                    : LensMakerMatchStatuses.Unassigned)
            : LensMakerMatchStatuses.Normalize(makerMatchStatus);

        if (!LensMakerMatchStatuses.IsValid(normalizedStatus))
        {
            throw new ValidationAppException("maker_match_status_invalid", $"The maker match status '{makerMatchStatus}' is not valid.");
        }

        var rawName = TrimOrNull(makerNameRaw)
            ?? TrimOrNull(makerLegacy)
            ?? TrimOrNull(existingLens?.MakerNameRaw)
            ?? TrimOrNull(existingLens?.Maker);

        if (normalizedStatus == LensMakerMatchStatuses.Matched)
        {
            if (!makerUserId.HasValue)
            {
                throw new ValidationAppException("maker_user_required", "makerUserId is required when makerMatchStatus is matched.");
            }

            if (string.IsNullOrWhiteSpace(rawName))
            {
                throw new ValidationAppException("maker_name_required", "makerNameRaw is required when makerMatchStatus is matched.");
            }
        }
        else if (normalizedStatus == LensMakerMatchStatuses.Unmatched)
        {
            if (makerUserId.HasValue)
            {
                throw new ValidationAppException("maker_user_forbidden", "makerUserId must be empty when makerMatchStatus is unmatched.");
            }

            if (string.IsNullOrWhiteSpace(rawName))
            {
                throw new ValidationAppException("maker_name_required", "makerNameRaw is required when makerMatchStatus is unmatched.");
            }
        }
        else if (makerUserId.HasValue)
        {
            throw new ValidationAppException("maker_user_forbidden", "makerUserId must be empty when makerMatchStatus is unassigned.");
        }

        if (makerUserId.HasValue && !await _permissionService.IsProjectMemberAsync(projectCode, makerUserId.Value, cancellationToken))
        {
            throw new ValidationAppException("maker_user_not_project_member", "makerUserId must belong to the current project members.");
        }

        var makerDisplayName = makerUserId.HasValue
            ? await _dbContext.Users.Where(x => x.Id == makerUserId.Value).Select(x => x.DisplayName).FirstOrDefaultAsync(cancellationToken)
            : null;

        return new MakerResolution(
            makerUserId,
            rawName,
            normalizedStatus,
            makerDisplayName,
            makerDisplayName ?? rawName);
    }

    private async Task<string?> LoadMakerDisplayNameAsync(Guid? makerUserId, CancellationToken cancellationToken)
    {
        if (!makerUserId.HasValue)
        {
            return null;
        }

        return await _dbContext.Users
            .Where(x => x.Id == makerUserId.Value)
            .Select(x => x.DisplayName)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private static string NormalizeMakerMatchStatus(string? makerMatchStatus, Guid? makerUserId, string? makerNameRaw, string? makerLegacy)
    {
        if (!string.IsNullOrWhiteSpace(makerMatchStatus))
        {
            return LensMakerMatchStatuses.Normalize(makerMatchStatus);
        }

        if (makerUserId.HasValue)
        {
            return LensMakerMatchStatuses.Matched;
        }

        if (!string.IsNullOrWhiteSpace(makerNameRaw) || !string.IsNullOrWhiteSpace(makerLegacy))
        {
            return LensMakerMatchStatuses.Unmatched;
        }

        return LensMakerMatchStatuses.Unassigned;
    }

    private sealed record MakerResolution(Guid? MakerUserId, string? MakerNameRaw, string MakerMatchStatus, string? MakerDisplayName, string? LegacyMaker);

    private async Task<LensResult> MapToLensResultAsync(Lens lens, CancellationToken cancellationToken) => new(
        lens.Id,
        lens.Code,
        lens.Name,
        lens.EpisodeId,
        lens.Status,
        lens.Sequence,
        lens.Description,
        lens.RootCode,
        lens.LogicalPath,
        lens.VersionTag,
        lens.VersionNum ?? "V01",
        lens.LayoutTag,
        lens.Comment,
        lens.IsArchived,
        lens.RowVersion,
        lens.CreatedAtUtc,
        lens.UpdatedAtUtc,
        lens.SingleFrame,
        lens.Maker)
    {
        MakerUserId = lens.MakerUserId,
        MakerNameRaw = lens.MakerNameRaw,
        MakerDisplayName = await LoadMakerDisplayNameAsync(lens.MakerUserId, cancellationToken),
        MakerMatchStatus = NormalizeMakerMatchStatus(lens.MakerMatchStatus, lens.MakerUserId, lens.MakerNameRaw, lens.Maker)
    };

    /// <inheritdoc/>
    public async Task<EpisodeResult> CreateAsync(string projectCode, CreateEpisodeRequest request, CancellationToken cancellationToken = default)
    {
        var normalizedProjectCode = projectCode.Trim().ToUpperInvariant();
        var normalizedCode = request.Code.Trim().ToUpperInvariant();

        // 检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        var canAccess = await _permissionService.CanAccessProjectAsync(normalizedProjectCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this project.");
        }
        
        var project = await _dbContext.Projects.FirstOrDefaultAsync(x => x.Code == normalizedProjectCode, cancellationToken)
            ?? throw new NotFoundAppException("project_not_found", "The project could not be found.");

        // 检查剧集代码是否已存在
        var exists = await _dbContext.Episodes.AnyAsync(x => x.ProjectId == project.Id && x.Code == normalizedCode, cancellationToken);
        if (exists)
        {
            throw new BusinessException("episode_code_exists", "The episode code already exists in this project.");
        }

        var episode = new Episode
        {
            Code = normalizedCode,
            Name = request.Name.Trim(),
            Sequence = request.Sequence,
            Description = request.Description?.Trim(),
            LensFolderRootPath = project.LensFolderRootPath,
            LayoutCheckPath = project.LayoutCheckPath,
            ProjectId = project.Id,
            IsArchived = false,
            RowVersion = 1
        };

        _dbContext.Episodes.Add(episode);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 记录剧集创建日志
        await _activityLogService.LogAsync(
            "Episode",
            episode.Id,
            "created",
            null,
            $"Code:{episode.Code}|Name:{episode.Name}|Project:{normalizedProjectCode}",
            cancellationToken);

        return MapToResult(episode, project);
    }

    /// <inheritdoc/>
    public async Task<EpisodeResult> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var episode = await _dbContext.Episodes
            .Include(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("episode_not_found", "The episode could not be found.");

        // 通过项目检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        var canAccess = await _permissionService.CanAccessProjectAsync(episode.Project.Code, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this project.");
        }

        return MapToResult(episode, episode.Project);
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<EpisodeResult>> GetListByProjectAsync(string projectCode, CancellationToken cancellationToken = default)
    {
        var normalizedProjectCode = projectCode.Trim().ToUpperInvariant();

        // 检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        var canAccess = await _permissionService.CanAccessProjectAsync(normalizedProjectCode, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this project.");
        }
        
        var episodes = await _dbContext.Episodes
            .Include(x => x.Project)
            .Where(x => x.Project.Code == normalizedProjectCode && !x.IsArchived)
            .OrderBy(x => x.Sequence)
            .ThenBy(x => x.Code)
            .ToListAsync(cancellationToken);

        return episodes.Select(episode => MapToResult(episode, episode.Project)).ToArray();
    }

    /// <inheritdoc/>
    public async Task<EpisodeResult> UpdateAsync(Guid id, UpdateEpisodeRequest request, long rowVersion, CancellationToken cancellationToken = default)
    {
        var episode = await _dbContext.Episodes
            .Include(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("episode_not_found", "The episode could not be found.");

        // 通过项目检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        var canAccess = await _permissionService.CanAccessProjectAsync(episode.Project.Code, currentUser.Id, cancellationToken);
        if (!canAccess)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to modify this project.");
        }

        // 并发控制检查
        if (episode.RowVersion != rowVersion)
        {
            throw new BusinessException("concurrency_conflict", "The episode has been modified by another user. Please refresh and try again.");
        }

        // 记录旧值用于日志
        var oldValue = $"Code:{episode.Code}|Name:{episode.Name}|Sequence:{episode.Sequence}";

        episode.Name = request.Name.Trim();
        episode.Sequence = request.Sequence;
        episode.Description = request.Description?.Trim();
        episode.RowVersion = rowVersion + 1;

        await _dbContext.SaveChangesAsync(cancellationToken);

        // 记录剧集更新日志
        await _activityLogService.LogAsync(
            "Episode",
            episode.Id,
            "updated",
            oldValue,
            $"Code:{episode.Code}|Name:{episode.Name}|Sequence:{episode.Sequence}",
            cancellationToken);

        return MapToResult(episode, episode.Project);
    }

    /// <summary>
    /// 映射到结果对象
    /// </summary>
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

    private static IReadOnlyList<ProjectRootResult> DeserializeRootSnapshots(string? json, string defaultFileKind)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            var snapshots = JsonSerializer.Deserialize<ProjectRootResult[]>(json, JsonOptions) ?? [];
            return snapshots.Select(snapshot => snapshot with { FileKind = NormalizeFileKind(snapshot.FileKind, defaultFileKind, snapshot.Label) }).ToArray();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string NormalizeFileKind(string? value, string defaultFileKind, string? label)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        if (!string.IsNullOrWhiteSpace(normalized))
        {
            return normalized;
        }

        var source = label?.ToLowerInvariant() ?? string.Empty;
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
}
