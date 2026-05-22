using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 镜头服务接口
/// </summary>
public interface ILensService
{
    /// <summary>
    /// 创建镜头
    /// </summary>
    Task<LensResult> CreateAsync(Guid episodeId, CreateLensRequest request, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 根据ID获取镜头
    /// </summary>
    Task<LensResult> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 根据剧集获取镜头列表
    /// </summary>
    Task<IReadOnlyList<LensResult>> GetListByEpisodeAsync(Guid episodeId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 更新镜头
    /// </summary>
    Task<LensResult> UpdateAsync(Guid id, UpdateLensRequest request, long rowVersion, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 更改镜头状态
    /// </summary>
    Task<LensResult> ChangeStatusAsync(Guid id, string newStatus, string? comment, long rowVersion, CancellationToken cancellationToken = default);

    /// <summary>
    /// 更新镜头二级状态
    /// </summary>
    Task<LensResult> UpdateInternalReviewStatusAsync(Guid id, UpdateLensInternalReviewStatusRequest request, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取镜头状态历史
    /// </summary>
    Task<IReadOnlyList<LensStatusHistoryResult>> GetStatusHistoryAsync(Guid lensId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 更新镜头状态历史备注
    /// </summary>
    Task<LensStatusHistoryResult> UpdateStatusHistoryAsync(Guid lensId, Guid historyId, UpdateLensStatusHistoryRequest request, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 获取镜头详情（包含版本、绑定、Layout 等信息）
    /// </summary>
    Task<LensDetailResult> GetLensDetailAsync(Guid lensId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 同步镜头文件绑定
    /// </summary>
    Task<LensFileBindingResult> SyncLensFileBindingAsync(Guid lensId, SyncLensFileBindingRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// 删除镜头文件绑定
    /// </summary>
    Task DeleteLensFileBindingAsync(Guid lensId, string bindingType, string? versionNum, CancellationToken cancellationToken = default);

    /// <summary>
    /// 批量创建镜头
    /// </summary>
    Task<IReadOnlyList<LensResult>> CreateBatchAsync(Guid episodeId, IReadOnlyList<CreateLensRequest> lenses, CancellationToken cancellationToken = default);
}

public record CreateLensRequest
{
    public string Code { get; init; }
    public string Name { get; init; }
    public int Sequence { get; init; }
    public string? Description { get; init; }
    public string? RootCode { get; init; }
    public string? LogicalPath { get; init; }
    public string? VersionTag { get; init; }
    public string VersionNum { get; init; } = "V01";
    public string? LayoutTag { get; init; }
    public int SingleFrame { get; init; } = 0;
    public string? Maker { get; init; }
    public Guid? MakerUserId { get; init; }
    public string? MakerNameRaw { get; init; }
    public string? MakerMatchStatus { get; init; }

    public CreateLensRequest(string Code, string Name, int Sequence, string? Description, string? RootCode, string? LogicalPath, string? VersionTag, string? LayoutTag, int SingleFrame = 0, string? Maker = null)
    {
        this.Code = Code;
        this.Name = Name;
        this.Sequence = Sequence;
        this.Description = Description;
        this.RootCode = RootCode;
        this.LogicalPath = LogicalPath;
        this.VersionTag = VersionTag;
        this.LayoutTag = LayoutTag;
        this.SingleFrame = SingleFrame;
        this.Maker = Maker;
    }
}

/// <summary>
/// 更新镜头请求
/// </summary>
public record UpdateLensRequest
{
    public string Name { get; init; }
    public string? Description { get; init; }
    public string? RootCode { get; init; }
    public string? LogicalPath { get; init; }
    public string? VersionTag { get; init; }
    public string? VersionNum { get; init; }
    public string? LayoutTag { get; init; }
    public string? Comment { get; init; }
    public int SingleFrame { get; init; } = 0;
    public string? Maker { get; init; }
    public Guid? MakerUserId { get; init; }
    public string? MakerNameRaw { get; init; }
    public string? MakerMatchStatus { get; init; }
    public long RowVersion { get; init; }

    public UpdateLensRequest(string Name, string? Description, string? RootCode, string? LogicalPath, string? VersionTag, string? LayoutTag, string? Comment, int SingleFrame = 0, string? Maker = null)
    {
        this.Name = Name;
        this.Description = Description;
        this.RootCode = RootCode;
        this.LogicalPath = LogicalPath;
        this.VersionTag = VersionTag;
        this.LayoutTag = LayoutTag;
        this.Comment = Comment;
        this.SingleFrame = SingleFrame;
        this.Maker = Maker;
    }
}

public record UpdateLensInternalReviewStatusRequest(
    string TargetStatusCode,
    string? Reason,
    Guid? ReviewTaskId);

public record LensResult
{
    public Guid Id { get; init; }
    public string Code { get; init; }
    public string Name { get; init; }
    public Guid EpisodeId { get; init; }
    public string Status { get; init; }
    public int Sequence { get; init; }
    public string? Description { get; init; }
    public string? RootCode { get; init; }
    public string? LogicalPath { get; init; }
    public string? VersionTag { get; init; }
    public string VersionNum { get; init; }
    public string? LayoutTag { get; init; }
    public string? Comment { get; init; }
    public bool IsArchived { get; init; }
    public long RowVersion { get; init; }
    public DateTimeOffset CreatedAtUtc { get; init; }
    public DateTimeOffset UpdatedAtUtc { get; init; }
    public int SingleFrame { get; init; } = 0;
    public string? Maker { get; init; }
    public Guid? MakerUserId { get; init; }
    public string? MakerNameRaw { get; init; }
    public string? MakerDisplayName { get; init; }
    public string? MakerMatchStatus { get; init; }
    public string InternalReviewStatusCode { get; init; } = LensInternalReviewStatuses.NotInReview;
    public string InternalReviewStatusName { get; init; } = "未进入审片";
    public DateTimeOffset? InternalReviewUpdatedAtUtc { get; init; }
    public Guid? LatestReviewTaskId { get; init; }
    public DateTimeOffset? LatestDirectorFeedbackAtUtc { get; init; }
    public int PendingDirectorFeedbackCount { get; init; }
    public bool SubmissionAllowed { get; init; }
    public int FileBindingCount { get; init; }
    public DateTimeOffset? LatestFileBindingUpdatedAtUtc { get; init; }

    public LensResult(
        Guid Id, string Code, string Name, Guid EpisodeId, string Status, int Sequence,
        string? Description, string? RootCode, string? LogicalPath, string? VersionTag, string VersionNum, string? LayoutTag,
        string? Comment, bool IsArchived, long RowVersion, DateTimeOffset CreatedAtUtc, DateTimeOffset UpdatedAtUtc, int SingleFrame = 0, string? Maker = null)
    {
        this.Id = Id;
        this.Code = Code;
        this.Name = Name;
        this.EpisodeId = EpisodeId;
        this.Status = Status;
        this.Sequence = Sequence;
        this.Description = Description;
        this.RootCode = RootCode;
        this.LogicalPath = LogicalPath;
        this.VersionTag = VersionTag;
        this.VersionNum = VersionNum;
        this.LayoutTag = LayoutTag;
        this.Comment = Comment;
        this.IsArchived = IsArchived;
        this.RowVersion = RowVersion;
        this.CreatedAtUtc = CreatedAtUtc;
        this.UpdatedAtUtc = UpdatedAtUtc;
        this.SingleFrame = SingleFrame;
        this.Maker = Maker;
    }
}

/// <summary>
/// 镜头状态历史结果
/// </summary>
public record LensStatusHistoryResult(Guid Id, Guid LensId, string FromStatus, string ToStatus, Guid ChangedByUserId, string ChangedByUserName, string? Comment, DateTimeOffset CreatedAtUtc);

public record UpdateLensStatusHistoryRequest(string? Comment);

/// <summary>
/// 镜头详情增强结果 - 包含版本、绑定、Layout 等完整信息
/// </summary>
public record LensDetailResult(
    LensResult Lens,
    IReadOnlyList<LensVersionResult> Versions,
    IReadOnlyList<LensFileBindingResult> FileBindings,
    IReadOnlyList<LayoutCandidateResult> LayoutCandidates,
    LayoutInfoResult? CurrentLayout,
    LayoutReferenceCheckResult? LayoutReferenceCheck);

/// <summary>
/// 版本快照信息
/// </summary>
public record LensVersionResult(
    string VersionNum,
    string? FileName,
    string? LogicalPath,
    IReadOnlyList<VersionIssueResult> Issues,
    IReadOnlyList<VersionBindingResult> Bindings);

/// <summary>
/// 版本问题
/// </summary>
public record VersionIssueResult(string IssueType, string Description, string? FilePath);

/// <summary>
/// 版本绑定记录
/// </summary>
public record VersionBindingResult(string BindingType, string FileName, string? FilePath, bool IsMatched);

/// <summary>
/// 文件绑定结果
/// </summary>
public record LensFileBindingResult(
    Guid BindingId,
    Guid LensId,
    string LensCode,
    string BindingType,
    string RelativePath,
    string? SourceRoot,
    string? VersionNum,
    string? FileName,
    DateTimeOffset BindTime);

/// <summary>
/// 文件绑定同步请求
/// </summary>
public record SyncLensFileBindingRequest(
    string BindingType,
    string RelativePath,
    string? SourceRoot,
    string? VersionNum,
    string? FileName);

/// <summary>
/// Layout 候选
/// </summary>
public record LayoutCandidateResult(
    string FileName,
    string RelativePath,
    string? MatchedLensCode,
    double MatchScore,
    DateTimeOffset ScannedAt);

/// <summary>
/// 当前 Layout 信息
/// </summary>
public record LayoutInfoResult(
    string FileName,
    string RelativePath,
    string? VideoFileName,
    string? VideoRelativePath,
    bool VideoReady,
    DateTimeOffset SelectedAt);

/// <summary>
/// Layout 引用检查结果
/// </summary>
public record LayoutReferenceCheckResult(
    int TotalReferences,
    int ValidReferences,
    int MissingReferences,
    IReadOnlyList<string> MissingReferencePaths);
