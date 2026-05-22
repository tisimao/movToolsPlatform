namespace Movtools.Server.Domain.Entities;

public sealed class LensRepairAttachment : EntityBase
{
    public Guid LensId { get; set; }
    public Lens Lens { get; set; } = null!;

    public Guid? LensStatusHistoryId { get; set; }
    public LensStatusHistory? LensStatusHistory { get; set; }

    public string FileName { get; set; } = string.Empty;
    public string OriginalName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long FileSize { get; set; }
    public int SortOrder { get; set; }
    public string StorageRelativePath { get; set; } = string.Empty;
}
