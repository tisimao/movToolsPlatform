using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Contracts;

public record EpisodeCreateRequest(string Code, string Name, int Sequence, string? Description);

public record EpisodeUpdateRequest(string Name, int Sequence, string? Description, long RowVersion);

public record EpisodeResponse(
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
    IReadOnlyList<ProjectScanRootResponse> LensRoots,
    IReadOnlyList<ProjectScanRootResponse> LayoutRoots);
