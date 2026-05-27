using System.IO;
using Microsoft.EntityFrameworkCore;
using Movtools.Server.Application.Exceptions;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;
using Movtools.Server.Infrastructure.Security;

namespace Movtools.Server.Infrastructure.Services;

/// <summary>
/// 镜头服务实现
/// </summary>
public sealed class LensService : ILensService
{
    private readonly MovtoolsDbContext _dbContext;
    private readonly IPermissionService _permissionService;
    private readonly IActivityLogService _activityLogService;
    private readonly ICurrentUserAccessor _currentUserAccessor;

    public LensService(
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
    public async Task<LensResult> CreateAsync(Guid episodeId, CreateLensRequest request, CancellationToken cancellationToken = default)
    {
        var normalizedCode = request.Code.Trim().ToUpperInvariant();
        
        var episode = await _dbContext.Episodes
            .Include(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == episodeId, cancellationToken)
            ?? throw new NotFoundAppException("episode_not_found", "The episode could not be found.");

        // 通过项目检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        if (!await _permissionService.CanWriteLensAsync(episode.Project.Code, currentUser.Id, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to modify this project.");
        }

        // 检查镜头代码是否已存在
        var exists = await _dbContext.Lenses.AnyAsync(x => x.EpisodeId == episodeId && x.Code == normalizedCode, cancellationToken);
        if (exists)
        {
            throw new BusinessException("lens_code_exists", "The lens code already exists in this episode.");
        }

        var lens = new Lens
        {
            Code = normalizedCode,
            Name = request.Name.Trim(),
            Sequence = request.Sequence,
            SingleFrame = request.SingleFrame,
            Description = request.Description?.Trim(),
            RootCode = request.RootCode?.Trim(),
            LogicalPath = request.LogicalPath?.Trim(),
            VersionTag = request.VersionTag?.Trim(),
            VersionNum = NormalizeVersionNum(request.VersionNum),
            LayoutTag = request.LayoutTag?.Trim(),
            EpisodeId = episodeId,
            Status = LensStatuses.Wip,
            IsArchived = false,
            RowVersion = 1
        };

        var makerState = await ResolveMakerStateAsync(
            episode.Project.Code,
            request.MakerUserId,
            request.MakerNameRaw,
            request.MakerMatchStatus,
            request.Maker,
            lens,
            cancellationToken);

        lens.MakerUserId = makerState.MakerUserId;
        lens.MakerNameRaw = makerState.MakerNameRaw;
        lens.MakerMatchStatus = makerState.MakerMatchStatus;
        lens.Maker = makerState.LegacyMaker;

        _dbContext.Lenses.Add(lens);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 记录镜头创建日志
        await _activityLogService.LogAsync(
            "Lens",
            lens.Id,
            "created",
            null,
            $"Code:{lens.Code}|Name:{lens.Name}|Episode:{episode.Code}",
            cancellationToken);

        return await MapToResultAsync(lens, cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<LensResult> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
            .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        // 通过项目检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        if (!await _permissionService.CanReadLensAsync(lens.Episode.Project.Code, currentUser.Id, lens.MakerUserId, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this lens.");
        }

        return await MapToResultAsync(lens, cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<LensResult>> GetListByEpisodeAsync(Guid episodeId, CancellationToken cancellationToken = default)
    {
        // 首先检查剧集是否存在并获取项目代码
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

        var roleCode = await _permissionService.GetProjectRoleCodeAsync(episode.Project.Code, currentUser.Id, cancellationToken);
        if (roleCode is null)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this project.");
        }

        if (roleCode is not ("admin" or "producer" or "director" or "maker"))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this project.");
        }

        IQueryable<Lens> query = _dbContext.Lenses
            .Where(x => x.EpisodeId == episodeId && !x.IsArchived);

        if (roleCode == "maker")
        {
            query = query.Where(x => x.MakerUserId == currentUser.Id);
        }

        var lenses = await query
            .OrderBy(x => x.Sequence)
            .ThenBy(x => x.Code)
            .ToListAsync(cancellationToken);

        var results = new List<LensResult>(lenses.Count);
        foreach (var lens in lenses)
        {
            results.Add(await MapToResultAsync(lens, cancellationToken));
        }

        return results;
    }

    /// <inheritdoc/>
    public async Task<LensResult> UpdateAsync(Guid id, UpdateLensRequest request, long rowVersion, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
            .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        // 通过项目检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        if (!await _permissionService.CanWriteLensAsync(lens.Episode.Project.Code, currentUser.Id, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to modify this lens.");
        }

        // 并发控制检查
        if (lens.RowVersion != rowVersion)
        {
            throw new BusinessException("concurrency_conflict", "The lens has been modified by another user. Please refresh and try again.");
        }

        // 记录旧值用于日志
        var oldValue = $"Code:{lens.Code}|Name:{lens.Name}|VersionTag:{lens.VersionTag}|Status:{lens.Status}";

        lens.Name = request.Name.Trim();
        lens.Description = request.Description?.Trim();
        lens.SingleFrame = request.SingleFrame > 0 ? request.SingleFrame : lens.SingleFrame;
        lens.RootCode = request.RootCode?.Trim();
        lens.LogicalPath = request.LogicalPath?.Trim();
        lens.VersionTag = request.VersionTag?.Trim();
        var normalizedRequestVersionNum = NormalizeVersionNum(request.VersionNum);
        if (!string.Equals(NormalizeVersionNum(lens.VersionNum), normalizedRequestVersionNum, StringComparison.OrdinalIgnoreCase))
        {
            lens.VersionNum = normalizedRequestVersionNum;
        }
        else
        {
            lens.VersionNum = normalizedRequestVersionNum;
        }
        lens.LayoutTag = request.LayoutTag?.Trim();
        lens.Comment = request.Comment?.Trim();
        lens.RowVersion = rowVersion + 1;

        if (HasMakerInput(request.MakerUserId, request.MakerNameRaw, request.MakerMatchStatus, request.Maker))
        {
            var makerState = await ResolveMakerStateAsync(
                lens.Episode.Project.Code,
                request.MakerUserId,
                request.MakerNameRaw,
                request.MakerMatchStatus,
                request.Maker,
                lens,
                cancellationToken);

            lens.MakerUserId = makerState.MakerUserId;
            lens.MakerNameRaw = makerState.MakerNameRaw;
            lens.MakerMatchStatus = makerState.MakerMatchStatus;
            lens.Maker = makerState.LegacyMaker;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // 记录镜头更新日志
        await _activityLogService.LogAsync(
            "Lens",
            lens.Id,
            "updated",
            oldValue,
            $"Code:{lens.Code}|Name:{lens.Name}|VersionTag:{lens.VersionTag}|Status:{lens.Status}",
            cancellationToken);

        return await MapToResultAsync(lens, cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<LensResult> ChangeStatusAsync(Guid id, string newStatus, string? comment, long rowVersion, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
            .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        // 检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        if (!await _permissionService.CanWriteLensAsync(lens.Episode.Project.Code, currentUser.Id, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to change status of this lens.");
        }

        // 并发控制检查
        if (lens.RowVersion != rowVersion)
        {
            throw new BusinessException("concurrency_conflict", "The lens has been modified by another user. Please refresh and try again.");
        }

        var normalizedNewStatus = newStatus.Trim().ToUpperInvariant();
        if (!LensStatuses.IsValid(normalizedNewStatus))
        {
            throw new BusinessException("invalid_status", $"The status '{newStatus}' is not valid. Valid statuses: {string.Join(", ", LensStatuses.All)}");
        }

        // 检查状态转换是否允许
        if (!LensStatuses.CanTransition(lens.Status, normalizedNewStatus))
        {
            throw new UnprocessableEntityAppException("invalid_transition", $"Cannot transition from '{lens.Status}' to '{normalizedNewStatus}'. Allowed transitions: {string.Join(", ", LensStatuses.AllowedTransitions[lens.Status])}");
        }

        if (normalizedNewStatus == LensStatuses.Submitted && LensInternalReviewStatuses.Normalize(lens.InternalReviewStatusCode) != LensInternalReviewStatuses.DirectorApproved)
        {
            throw new BusinessException("internal_review_not_approved", "The lens cannot be submitted before director approval.");
        }

        var fromStatus = lens.Status;
        var fromVersionNum = NormalizeVersionNum(lens.VersionNum);

        if (normalizedNewStatus == LensStatuses.Rework)
        {
            lens.VersionNum = IncrementVersionNum(lens.VersionNum);
            lens.InternalReviewStatusCode = LensInternalReviewStatuses.FixUpdated;
            lens.InternalReviewUpdatedAtUtc = DateTimeOffset.UtcNow;
        }
        
        lens.Status = normalizedNewStatus;
        lens.RowVersion = rowVersion + 1;

        // 创建状态历史记录
        var statusHistory = new LensStatusHistory
        {
            LensId = lens.Id,
            FromStatus = fromStatus,
            ToStatus = normalizedNewStatus,
            ChangedByUserId = currentUser.Id,
            Comment = BuildStatusHistoryComment(comment, fromVersionNum, NormalizeVersionNum(lens.VersionNum))
        };

        _dbContext.LensStatusHistories.Add(statusHistory);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 同时记录到活动日志
        await _activityLogService.LogAsync(
            "Lens",
            lens.Id,
            "status_changed",
            fromStatus,
            normalizedNewStatus,
            cancellationToken);

        return await MapToResultAsync(lens, cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<LensResult> UpdateInternalReviewStatusAsync(Guid id, UpdateLensInternalReviewStatusRequest request, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
            .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var currentStatus = LensInternalReviewStatuses.Normalize(lens.InternalReviewStatusCode);
        var targetStatus = LensInternalReviewStatuses.Normalize(request.TargetStatusCode);

        var canWriteLens = await _permissionService.CanWriteLensAsync(lens.Episode.Project.Code, currentUser.Id, cancellationToken);
        var canReadLens = await _permissionService.CanReadLensAsync(lens.Episode.Project.Code, currentUser.Id, lens.MakerUserId, cancellationToken);
        var roleCode = await _permissionService.GetProjectRoleCodeAsync(lens.Episode.Project.Code, currentUser.Id, cancellationToken);
        var isAdmin = await _permissionService.IsAdminAsync(currentUser.Id, cancellationToken);
        var isDirector = await _permissionService.IsInRoleAsync(currentUser.Id, "director", cancellationToken);
        var isProducer = roleCode == "producer";
        var isMaker = roleCode == "maker";

        currentStatus = await NormalizeDirectorActionSourceStatusAsync(lens, currentStatus, targetStatus, isAdmin, isDirector, cancellationToken);

        if (currentStatus == targetStatus)
        {
            if (request.ReviewTaskId.HasValue && lens.LatestReviewTaskId != request.ReviewTaskId.Value)
            {
                lens.LatestReviewTaskId = request.ReviewTaskId;
            }

            lens.InternalReviewUpdatedAtUtc = DateTimeOffset.UtcNow;
            await _dbContext.SaveChangesAsync(cancellationToken);
            return await MapToResultAsync(lens, cancellationToken);
        }

        if (!LensInternalReviewStatuses.CanTransition(currentStatus, targetStatus))
        {
            throw new UnprocessableEntityAppException("invalid_internal_review_transition", $"Cannot transition from '{currentStatus}' to '{targetStatus}'.");
        }

        if (!canReadLens)
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this lens.");
        }

        var canModify = targetStatus switch
        {
            LensInternalReviewStatuses.ReadyForReview => isAdmin || isProducer,
            LensInternalReviewStatuses.InDirectorReview => currentStatus == LensInternalReviewStatuses.DirectorApproved
                ? isAdmin || isDirector
                : isAdmin || isProducer,
            LensInternalReviewStatuses.PendingFeedbackFix => isAdmin || isDirector,
            LensInternalReviewStatuses.DirectorApproved => isAdmin || isDirector,
            LensInternalReviewStatuses.FixUpdated => isAdmin || (isMaker && canReadLens),
            _ => false
        };

        if (!canModify)
        {
            throw new UnauthorizedAppException("internal_review_action_denied", "You do not have permission to perform this internal review action.");
        }

        lens.InternalReviewStatusCode = targetStatus;
        lens.InternalReviewUpdatedAtUtc = DateTimeOffset.UtcNow;
        if (request.ReviewTaskId.HasValue)
        {
            lens.LatestReviewTaskId = request.ReviewTaskId;
        }

        if (targetStatus is LensInternalReviewStatuses.PendingFeedbackFix)
        {
            lens.LatestDirectorFeedbackAtUtc = DateTimeOffset.UtcNow;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return await MapToResultAsync(lens, cancellationToken);
    }

    private async Task<string> NormalizeDirectorActionSourceStatusAsync(
        Lens lens,
        string currentStatus,
        string targetStatus,
        bool isAdmin,
        bool isDirector,
        CancellationToken cancellationToken)
    {
        if (!isAdmin && !isDirector)
        {
            return currentStatus;
        }

        if (currentStatus is not (LensInternalReviewStatuses.NotInReview or LensInternalReviewStatuses.ReadyForReview or LensInternalReviewStatuses.FixUpdated))
        {
            return currentStatus;
        }

        if (targetStatus is not (LensInternalReviewStatuses.DirectorApproved or LensInternalReviewStatuses.PendingFeedbackFix))
        {
            return currentStatus;
        }

        var hasActiveReviewTask = await _dbContext.ReviewTaskShots
            .AnyAsync(
                x => x.LensId == lens.Id
                    && x.ParticipationMode.ToLower() == ReviewTaskShotParticipationModes.Review
                    && x.ReviewTask.Status == ReviewStatuses.InReview,
                cancellationToken);

        return hasActiveReviewTask ? LensInternalReviewStatuses.InDirectorReview : currentStatus;
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<LensStatusHistoryResult>> GetStatusHistoryAsync(Guid lensId, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
            .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        // 检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        if (!await _permissionService.CanReadLensAsync(lens.Episode.Project.Code, currentUser.Id, lens.MakerUserId, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this lens.");
        }

        var histories = await _dbContext.LensStatusHistories
            .Include(x => x.ChangedByUser)
            .Where(x => x.LensId == lensId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        return histories.Select(h => new LensStatusHistoryResult(
            h.Id,
            h.LensId,
            h.FromStatus,
            h.ToStatus,
            h.ChangedByUserId,
            h.ChangedByUser?.UserName ?? "unknown",
            h.Comment,
            h.CreatedAtUtc)).ToArray();
    }

    public async Task<LensStatusHistoryResult> UpdateStatusHistoryAsync(Guid lensId, Guid historyId, UpdateLensStatusHistoryRequest request, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
            .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        if (!await _permissionService.CanReadLensAsync(lens.Episode.Project.Code, currentUser.Id, lens.MakerUserId, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this lens.");
        }

        var history = await _dbContext.LensStatusHistories
            .Include(x => x.ChangedByUser)
            .FirstOrDefaultAsync(x => x.Id == historyId && x.LensId == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_history_not_found", "The lens status history could not be found.");

        history.Comment = request.Comment;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new LensStatusHistoryResult(
            history.Id,
            history.LensId,
            history.FromStatus,
            history.ToStatus,
            history.ChangedByUserId,
            history.ChangedByUser?.UserName ?? "unknown",
            history.Comment,
            history.CreatedAtUtc);
    }

    /// <summary>
    /// 映射到结果对象
    /// </summary>
    private async Task<LensResult> MapToResultAsync(Lens lens, CancellationToken cancellationToken)
    {
        var makerDisplayName = await LoadMakerDisplayNameAsync(lens.MakerUserId, cancellationToken);
        var fileBindingSummary = await LoadFileBindingSummaryAsync(lens.Id, cancellationToken);

        return CreateLensResult(
            lens,
            makerDisplayName,
            fileBindingSummary.FileBindingCount,
            fileBindingSummary.LatestFileBindingUpdatedAtUtc);
    }

    private static string NormalizeVersionNum(string? versionNum)
    {
        var normalized = versionNum?.Trim().ToUpperInvariant() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return "V01";
        }

        return normalized.StartsWith('V') ? normalized : $"V{normalized}";
    }

    private static string IncrementVersionNum(string? versionNum)
    {
        var normalized = NormalizeVersionNum(versionNum);
        var numeric = normalized[1..];
        if (!int.TryParse(numeric, out var value))
        {
            return "V01";
        }

        return $"V{(value + 1):D2}";
    }

    private static string? BuildStatusHistoryComment(string? comment, string fromVersionNum, string toVersionNum)
    {
        var trimmed = comment?.Trim();
        var versionNote = fromVersionNum == toVersionNum ? null : $"版本号：{fromVersionNum} → {toVersionNum}";
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return versionNote;
        }

        return versionNote == null ? trimmed : $"{trimmed} | {versionNote}";
    }

    private static LensResult CreateLensResult(
        Lens lens,
        string? makerDisplayName,
        int fileBindingCount,
        DateTimeOffset? latestFileBindingUpdatedAtUtc) => new(
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
            NormalizeVersionNum(lens.VersionNum),
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
        MakerDisplayName = makerDisplayName,
        MakerMatchStatus = NormalizeMakerMatchStatus(lens.MakerMatchStatus, lens.MakerUserId, lens.MakerNameRaw, lens.Maker),
        FileBindingCount = fileBindingCount,
        LatestFileBindingUpdatedAtUtc = latestFileBindingUpdatedAtUtc,
        InternalReviewStatusCode = LensInternalReviewStatuses.Normalize(lens.InternalReviewStatusCode),
        InternalReviewStatusName = ToInternalReviewStatusName(lens.InternalReviewStatusCode),
        InternalReviewUpdatedAtUtc = lens.InternalReviewUpdatedAtUtc,
        LatestReviewTaskId = lens.LatestReviewTaskId,
        LatestDirectorFeedbackAtUtc = lens.LatestDirectorFeedbackAtUtc,
        PendingDirectorFeedbackCount = lens.PendingDirectorFeedbackCount,
        SubmissionAllowed = LensInternalReviewStatuses.Normalize(lens.InternalReviewStatusCode) == LensInternalReviewStatuses.DirectorApproved
    };

    private static string ToInternalReviewStatusName(string? code)
        => LensInternalReviewStatuses.Normalize(code) switch
        {
            LensInternalReviewStatuses.NotInReview => "未进入审片",
            LensInternalReviewStatuses.ReadyForReview => "待提审",
            LensInternalReviewStatuses.InDirectorReview => "审片中",
            LensInternalReviewStatuses.PendingFeedbackFix => "待处理反馈",
            LensInternalReviewStatuses.FixUpdated => "已按反馈修改",
            LensInternalReviewStatuses.DirectorApproved => "内部通过",
            _ => "未进入审片"
        };

    private static LensFileBindingResult MapToResult(LensFileBinding binding) => new(
        binding.Id,
        binding.LensId,
        binding.LensCode,
        binding.BindingType,
        binding.RelativePath,
        binding.SourceRoot,
        binding.VersionNum,
        binding.FileName,
        binding.UpdatedAtUtc);

    private async Task<LensFileBindingSummaryResult> LoadFileBindingSummaryAsync(Guid lensId, CancellationToken cancellationToken)
    {
        return await _dbContext.LensFileBindings
            .Where(x => x.LensId == lensId)
            .GroupBy(_ => 1)
            .Select(g => new LensFileBindingSummaryResult(g.Count(), g.Max(x => (DateTimeOffset?)x.UpdatedAtUtc)))
            .FirstOrDefaultAsync(cancellationToken)
            ?? new LensFileBindingSummaryResult(0, null);
    }

    private static string NormalizeBindingType(string? bindingType)
    {
        var normalized = bindingType?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ValidationAppException("binding_type_required", "Binding type is required.");
        }

        return normalized switch
        {
            "ma" or "mov" or "layout" or "layoutVideo" => normalized,
            _ => throw new ValidationAppException("binding_type_invalid", $"The binding type '{bindingType}' is not valid.")
        };
    }

    private static bool IsVersionedBindingType(string bindingType) => bindingType is "ma" or "mov";

    private static string NormalizeRequiredPath(string? value)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ValidationAppException("relative_path_required", "Relative path is required.");
        }

        return normalized;
    }

    private static string? NormalizeOptionalValue(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

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

        var rawName = NormalizeOptionalValue(makerNameRaw)
            ?? NormalizeOptionalValue(makerLegacy)
            ?? NormalizeOptionalValue(existingLens?.MakerNameRaw)
            ?? NormalizeOptionalValue(existingLens?.Maker);

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

    private sealed record LensFileBindingSummaryResult(int FileBindingCount, DateTimeOffset? LatestFileBindingUpdatedAtUtc);

    /// <inheritdoc/>
    public async Task<LensDetailResult> GetLensDetailAsync(Guid lensId, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
            .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        // 检查权限
        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        if (!await _permissionService.CanReadLensAsync(lens.Episode.Project.Code, currentUser.Id, lens.MakerUserId, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this lens.");
        }

        var fileBindings = await _dbContext.LensFileBindings
            .Where(x => x.LensId == lensId)
            .OrderBy(x => x.BindingType)
            .ThenBy(x => x.VersionNum)
            .ToListAsync(cancellationToken);

        var latestFileBindingUpdatedAtUtc = fileBindings.Count == 0 ? (DateTimeOffset?)null : fileBindings.Max(x => x.UpdatedAtUtc);
        var lensResult = CreateLensResult(
            lens,
            await LoadMakerDisplayNameAsync(lens.MakerUserId, cancellationToken),
            fileBindings.Count,
            latestFileBindingUpdatedAtUtc);

        // 从镜头主数据构建版本信息（简化版）
        var versionNum = lens.VersionTag ?? "1";
        var versions = new List<LensVersionResult>
        {
            new LensVersionResult(
                versionNum,
                lens.LogicalPath?.Split('/').LastOrDefault() ?? lens.Code,
                lens.LogicalPath,
                Array.Empty<VersionIssueResult>(),
                Array.Empty<VersionBindingResult>())
        };

        return new LensDetailResult(
            lensResult,
            versions,
            fileBindings.Select(MapToResult).ToArray(),
            Array.Empty<LayoutCandidateResult>(),
            null,
            null);
    }

    /// <inheritdoc/>
    public async Task<LensFileBindingResult> SyncLensFileBindingAsync(Guid lensId, SyncLensFileBindingRequest request, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
            .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        if (!await _permissionService.CanWriteLensAsync(lens.Episode.Project.Code, currentUser.Id, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to modify this lens.");
        }

        var bindingType = NormalizeBindingType(request.BindingType);
        var relativePath = NormalizeRequiredPath(request.RelativePath);
        if (Path.IsPathFullyQualified(relativePath) || Path.IsPathRooted(relativePath))
        {
            throw new ValidationAppException("relative_path_invalid", "Relative path must not be absolute.");
        }

        var sourceRoot = NormalizeOptionalValue(request.SourceRoot);
        var fileName = NormalizeOptionalValue(request.FileName);
        fileName ??= Path.GetFileName(relativePath);
        var versionNum = IsVersionedBindingType(bindingType) ? NormalizeOptionalValue(request.VersionNum) : null;

        LensFileBinding? existingBinding;
        if (versionNum != null || IsVersionedBindingType(bindingType))
        {
            existingBinding = await _dbContext.LensFileBindings
                .FirstOrDefaultAsync(x => x.LensId == lensId && x.BindingType == bindingType && x.VersionNum == versionNum, cancellationToken);
        }
        else
        {
            existingBinding = await _dbContext.LensFileBindings
                .FirstOrDefaultAsync(x => x.LensId == lensId && x.BindingType == bindingType && x.VersionNum == null, cancellationToken);
        }

        LensFileBinding binding;
        if (existingBinding != null)
        {
            var changed = existingBinding.LensCode != lens.Code
                || existingBinding.RelativePath != relativePath
                || existingBinding.SourceRoot != sourceRoot
                || existingBinding.VersionNum != versionNum
                || existingBinding.FileName != fileName;

            if (!changed)
            {
                return MapToResult(existingBinding);
            }

            binding = existingBinding;
            binding.LensCode = lens.Code;
            binding.RelativePath = relativePath;
            binding.SourceRoot = sourceRoot;
            binding.VersionNum = versionNum;
            binding.FileName = fileName;
        }
        else
        {
            binding = new LensFileBinding
            {
                LensId = lens.Id,
                LensCode = lens.Code,
                BindingType = bindingType,
                RelativePath = relativePath,
                SourceRoot = sourceRoot,
                VersionNum = versionNum,
                FileName = fileName
            };

            _dbContext.LensFileBindings.Add(binding);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return MapToResult(binding);
    }

    /// <inheritdoc/>
    public async Task DeleteLensFileBindingAsync(Guid lensId, string bindingType, string? versionNum, CancellationToken cancellationToken = default)
    {
        var lens = await _dbContext.Lenses
            .Include(x => x.Episode)
            .ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        var currentUser = _currentUserAccessor.GetCurrentUser();
        if (currentUser == null)
        {
            throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");
        }

        if (!await _permissionService.CanWriteLensAsync(lens.Episode.Project.Code, currentUser.Id, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to modify this lens.");
        }

        var normalizedBindingType = NormalizeBindingType(bindingType);
        var normalizedVersionNum = NormalizeOptionalValue(versionNum);

        LensFileBinding? existingBinding;
        if (normalizedVersionNum != null || IsVersionedBindingType(normalizedBindingType))
        {
            existingBinding = await _dbContext.LensFileBindings
                .FirstOrDefaultAsync(x => x.LensId == lensId && x.BindingType == normalizedBindingType && x.VersionNum == normalizedVersionNum, cancellationToken);
        }
        else
        {
            existingBinding = await _dbContext.LensFileBindings
                .FirstOrDefaultAsync(x => x.LensId == lensId && x.BindingType == normalizedBindingType && x.VersionNum == null, cancellationToken);
        }

        if (existingBinding == null)
        {
            return;
        }

        _dbContext.LensFileBindings.Remove(existingBinding);
        await _dbContext.SaveChangesAsync(cancellationToken);

        await _activityLogService.LogAsync(
            "Lens",
            lens.Id,
            "binding_deleted",
            $"BindingType:{normalizedBindingType}|VersionNum:{normalizedVersionNum ?? string.Empty}",
            null,
            cancellationToken);
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<LensResult>> CreateBatchAsync(Guid episodeId, IReadOnlyList<CreateLensRequest> lenses, CancellationToken cancellationToken = default)
    {
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
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to create lenses in this project.");
        }

        var results = new List<LensResult>();
        var sequence = 1;

        foreach (var req in lenses)
        {
            var normalizedCode = req.Code.Trim().ToUpperInvariant();
            
            // 检查镜头代码是否已存在
            var exists = await _dbContext.Lenses.AnyAsync(
                x => x.EpisodeId == episodeId && x.Code == normalizedCode, 
                cancellationToken);
            
            if (exists)
            {
                // 跳过已存在的镜头
                continue;
            }

            var lens = new Lens
            {
                Code = normalizedCode,
                Name = req.Name.Trim(),
                Sequence = req.Sequence > 0 ? req.Sequence : sequence++,
                SingleFrame = req.SingleFrame,
                Description = req.Description?.Trim(),
                RootCode = req.RootCode?.Trim(),
                LogicalPath = req.LogicalPath?.Trim(),
                VersionTag = req.VersionTag?.Trim(),
                VersionNum = NormalizeVersionNum(req.VersionNum),
                LayoutTag = req.LayoutTag?.Trim(),
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
            results.Add(await MapToResultAsync(lens, cancellationToken));
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
                $"Count:{results.Count}",
                cancellationToken);
        }

        return results;
    }
}
