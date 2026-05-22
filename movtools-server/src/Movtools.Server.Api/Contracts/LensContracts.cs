namespace Movtools.Server.Api.Contracts;

public record LensStatusHistoryResponse(
    Guid Id, Guid LensId, string FromStatus, string ToStatus, 
    string ChangedByUserName, string? Comment, DateTimeOffset CreatedAtUtc);

public record LensCreateRequest
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

    public LensCreateRequest(string Code, string Name, int Sequence, string? Description, string? RootCode, string? LogicalPath, string? VersionTag, string? LayoutTag, int SingleFrame = 0, string? Maker = null)
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

public record LensUpdateRequest
{
    public string Name { get; init; }
    public string? Description { get; init; }
    public string? RootCode { get; init; }
    public string? LogicalPath { get; init; }
    public string? VersionTag { get; init; }
    public string VersionNum { get; init; } = "V01";
    public string? LayoutTag { get; init; }
    public string? Comment { get; init; }
    public long RowVersion { get; init; }
    public int SingleFrame { get; init; } = 0;
    public string? Maker { get; init; }
    public Guid? MakerUserId { get; init; }
    public string? MakerNameRaw { get; init; }
    public string? MakerMatchStatus { get; init; }

    public LensUpdateRequest(string Name, string? Description, string? RootCode, string? LogicalPath, string? VersionTag, string? LayoutTag, string? Comment, long RowVersion, int SingleFrame = 0, string? Maker = null)
    {
        this.Name = Name;
        this.Description = Description;
        this.RootCode = RootCode;
        this.LogicalPath = LogicalPath;
        this.VersionTag = VersionTag;
        this.LayoutTag = LayoutTag;
        this.Comment = Comment;
        this.RowVersion = RowVersion;
        this.SingleFrame = SingleFrame;
        this.Maker = Maker;
    }
}

public record LensStatusChangeRequest(string NewStatus, string? Comment, long RowVersion);

public record LensStatusHistoryUpdateRequest(string? Comment);

public record LensResponse
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
    public string InternalReviewStatusCode { get; init; } = string.Empty;
    public string InternalReviewStatusName { get; init; } = string.Empty;
    public DateTimeOffset? InternalReviewUpdatedAtUtc { get; init; }
    public Guid? LatestReviewTaskId { get; init; }
    public DateTimeOffset? LatestDirectorFeedbackAtUtc { get; init; }
    public int PendingDirectorFeedbackCount { get; init; }
    public bool SubmissionAllowed { get; init; }
    public int FileBindingCount { get; init; }
    public DateTimeOffset? LatestFileBindingUpdatedAtUtc { get; init; }

    public LensResponse(
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

public record LensInternalReviewStatusUpdateRequest(string TargetStatusCode, string? Reason, Guid? ReviewTaskId);

public record LensDetailResponse(
    LensResponse Lens,
    IReadOnlyList<LensVersionResponse> Versions,
    IReadOnlyList<LensFileBindingResponse> FileBindings,
    IReadOnlyList<LayoutCandidateResponse> LayoutCandidates,
    LayoutInfoResponse? CurrentLayout,
    LayoutReferenceCheckResponse? LayoutReferenceCheck);

public record LensVersionResponse(
    string VersionNum,
    string? FileName,
    string? LogicalPath,
    IReadOnlyList<VersionIssueResponse> Issues,
    IReadOnlyList<VersionBindingResponse> Bindings);

public record VersionIssueResponse(string IssueType, string Description, string? FilePath);

public record VersionBindingResponse(string BindingType, string FileName, string? FilePath, bool IsMatched);

public record LensFileBindingResponse(
    Guid BindingId,
    Guid LensId,
    string LensCode,
    string BindingType,
    string RelativePath,
    string? SourceRoot,
    string? VersionNum,
    string? FileName,
    DateTimeOffset BindTime);

public record LensFileBindingSyncRequest(
    string BindingType,
    string RelativePath,
    string? SourceRoot,
    string? VersionNum,
    string? FileName);

public record LayoutCandidateResponse(
    string FileName,
    string RelativePath,
    string? MatchedLensCode,
    double MatchScore,
    DateTimeOffset ScannedAt);

public record LayoutInfoResponse(
    string FileName,
    string RelativePath,
    string? VideoFileName,
    string? VideoRelativePath,
    bool VideoReady,
    DateTimeOffset SelectedAt);

public record LayoutReferenceCheckResponse(
    int TotalReferences,
    int ValidReferences,
    int MissingReferences,
    IReadOnlyList<string> MissingReferencePaths);

/// <summary>
/// 批量创建镜头请求
/// </summary>
public record LensBatchCreateRequest(IReadOnlyList<LensCreateRequest> Lenses);
