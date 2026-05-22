namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// 剧集服务接口
/// </summary>
public interface IEpisodeService
{
    /// <summary>
    /// 创建剧集
    /// </summary>
    Task<EpisodeResult> CreateAsync(string projectCode, CreateEpisodeRequest request, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 根据ID获取剧集
    /// </summary>
    Task<EpisodeResult> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 根据项目获取剧集列表
    /// </summary>
    Task<IReadOnlyList<EpisodeResult>> GetListByProjectAsync(string projectCode, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 更新剧集
    /// </summary>
    Task<EpisodeResult> UpdateAsync(Guid id, UpdateEpisodeRequest request, long rowVersion, CancellationToken cancellationToken = default);

    /// <summary>
    /// 批量创建镜头 - 用于首集初始化
    /// </summary>
    Task<IReadOnlyList<LensResult>> CreateLensesBatchAsync(string projectCode, Guid episodeId, IReadOnlyList<CreateLensRequest> lenses, CancellationToken cancellationToken = default);
}

/// <summary>
/// 创建剧集请求
/// </summary>
public record CreateEpisodeRequest(string Code, string Name, int Sequence, string? Description);

/// <summary>
/// 更新剧集请求
/// </summary>
public record UpdateEpisodeRequest(string Name, int Sequence, string? Description);

/// <summary>
/// 剧集结果
/// </summary>
public record EpisodeResult(
    Guid Id,
    string Code,
    string Name,
    int Sequence,
    string? Description,
    Guid ProjectId,
    string ProjectCode,
    bool IsArchived,
    long RowVersion,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    string? VersionTag,
    string? LayoutTag,
    string? InitExcelPath,
    string? ProjectRootPath,
    string? LensFolderRootPath,
    string? MaCheckPath,
    string? MovCheckPath,
    string? LayoutCheckPath,
    IReadOnlyList<ProjectRootResult> LensRoots,
    IReadOnlyList<ProjectRootResult> LayoutRoots);
