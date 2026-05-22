namespace Movtools.Server.Api.Contracts;

public record RepairAttachmentUploadRequest(
    Guid? LensStatusHistoryId,
    int SortOrder,
    IFormFile File);

public record RepairAttachmentSortOrderRequest(int SortOrder);

public record RepairAttachmentResponse(
    Guid Id,
    Guid LensId,
    Guid? LensStatusHistoryId,
    string FileName,
    string OriginalName,
    long FileSize,
    int SortOrder,
    string PreviewUrl,
    DateTimeOffset CreatedAtUtc);

public static class RepairAttachmentContractsExtensions
{
    public static RepairAttachmentResponse ToResponse(this Application.Interfaces.RepairAttachmentResult result) => new(
        result.Id,
        result.LensId,
        result.LensStatusHistoryId,
        result.FileName,
        result.OriginalName,
        result.FileSize,
        result.SortOrder,
        result.PreviewUrl,
        result.CreatedAtUtc);
}
