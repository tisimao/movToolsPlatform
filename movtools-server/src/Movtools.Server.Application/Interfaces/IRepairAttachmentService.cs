using Microsoft.AspNetCore.Http;

namespace Movtools.Server.Application.Interfaces;

public interface IRepairAttachmentService
{
    Task<RepairAttachmentResult> UploadAsync(Guid lensId, Guid? lensStatusHistoryId, IFormFile file, int sortOrder, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<RepairAttachmentResult>> GetByLensIdAsync(Guid lensId, CancellationToken cancellationToken = default);

    Task DeleteAsync(Guid attachmentId, CancellationToken cancellationToken = default);

    Task<RepairAttachmentResult> UpdateSortOrderAsync(Guid attachmentId, int sortOrder, CancellationToken cancellationToken = default);
}

public record RepairAttachmentResult(
    Guid Id,
    Guid LensId,
    Guid? LensStatusHistoryId,
    string FileName,
    string OriginalName,
    long FileSize,
    int SortOrder,
    string PreviewUrl,
    DateTimeOffset CreatedAtUtc);
