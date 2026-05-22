using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Movtools.Server.Application.Exceptions;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Domain.Entities;
using Movtools.Server.Infrastructure.Persistence;
using Movtools.Server.Infrastructure.Security;

namespace Movtools.Server.Infrastructure.Services;

public sealed class RepairAttachmentService : IRepairAttachmentService
{
    private readonly MovtoolsDbContext _dbContext;
    private readonly ICurrentUserAccessor _currentUserAccessor;
    private readonly IPermissionService _permissionService;
    private readonly string _storageRoot;

    public RepairAttachmentService(
        MovtoolsDbContext dbContext,
        ICurrentUserAccessor currentUserAccessor,
        IPermissionService permissionService)
    {
        _dbContext = dbContext;
        _currentUserAccessor = currentUserAccessor;
        _permissionService = permissionService;

        var envRoot = Environment.GetEnvironmentVariable("REPAIR_ATTACHMENT_ROOT");
        _storageRoot = !string.IsNullOrWhiteSpace(envRoot)
            ? envRoot
            : Path.Combine(Directory.GetCurrentDirectory(), "uploads", "repairs");
        Directory.CreateDirectory(_storageRoot);
    }

    public async Task<RepairAttachmentResult> UploadAsync(Guid lensId, Guid? lensStatusHistoryId, IFormFile file, int sortOrder, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var lens = await _dbContext.Lenses
            .Include(x => x.Episode).ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        if (!await _permissionService.CanAccessProjectAsync(lens.Episode.Project.Code, currentUser.Id, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to upload attachments for this lens.");
        }

        var fileExtension = Path.GetExtension(file.FileName);
        var attachmentId = Guid.NewGuid();
        var relativeDir = Path.Combine(lensId.ToString("N"));
        var fileName = $"{attachmentId:N}{fileExtension}";
        var relativePath = Path.Combine("uploads", "repairs", relativeDir, fileName);
        var fullDir = Path.Combine(_storageRoot, relativeDir);
        Directory.CreateDirectory(fullDir);
        var fullPath = Path.Combine(fullDir, fileName);

        await using (var stream = new FileStream(fullPath, FileMode.Create, FileAccess.Write))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var attachment = new LensRepairAttachment
        {
            Id = attachmentId,
            LensId = lensId,
            LensStatusHistoryId = lensStatusHistoryId,
            FileName = fileName,
            OriginalName = file.FileName,
            ContentType = file.ContentType ?? "application/octet-stream",
            FileSize = file.Length,
            SortOrder = sortOrder,
            StorageRelativePath = relativePath.Replace('\\', '/')
        };

        _dbContext.LensRepairAttachments.Add(attachment);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return MapToResult(attachment);
    }

    public async Task<IReadOnlyList<RepairAttachmentResult>> GetByLensIdAsync(Guid lensId, CancellationToken cancellationToken = default)
    {
        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        var lens = await _dbContext.Lenses
            .Include(x => x.Episode).ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == lensId, cancellationToken)
            ?? throw new NotFoundAppException("lens_not_found", "The lens could not be found.");

        if (!await _permissionService.CanReadLensAsync(lens.Episode.Project.Code, currentUser.Id, lens.MakerUserId, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to access this lens.");
        }

        var attachments = await _dbContext.LensRepairAttachments
            .Where(x => x.LensId == lensId)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        return attachments.Select(MapToResult).ToArray();
    }

    public async Task DeleteAsync(Guid attachmentId, CancellationToken cancellationToken = default)
    {
        var attachment = await _dbContext.LensRepairAttachments
            .Include(x => x.Lens).ThenInclude(x => x.Episode).ThenInclude(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == attachmentId, cancellationToken)
            ?? throw new NotFoundAppException("attachment_not_found", "The attachment could not be found.");

        var currentUser = _currentUserAccessor.GetCurrentUser()
            ?? throw new UnauthorizedAppException("unauthorized", "User is not authenticated.");

        if (!await _permissionService.CanAccessProjectAsync(attachment.Lens.Episode.Project.Code, currentUser.Id, cancellationToken))
        {
            throw new UnauthorizedAppException("project_access_denied", "You do not have permission to delete this attachment.");
        }

        var fullPath = Path.Combine(Directory.GetCurrentDirectory(), attachment.StorageRelativePath.Replace('/', Path.DirectorySeparatorChar));
        if (File.Exists(fullPath))
        {
            File.Delete(fullPath);
        }

        _dbContext.LensRepairAttachments.Remove(attachment);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<RepairAttachmentResult> UpdateSortOrderAsync(Guid attachmentId, int sortOrder, CancellationToken cancellationToken = default)
    {
        var attachment = await _dbContext.LensRepairAttachments
            .FirstOrDefaultAsync(x => x.Id == attachmentId, cancellationToken)
            ?? throw new NotFoundAppException("attachment_not_found", "The attachment could not be found.");

        attachment.SortOrder = sortOrder;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return MapToResult(attachment);
    }

    private static RepairAttachmentResult MapToResult(LensRepairAttachment attachment)
        => new(
            attachment.Id,
            attachment.LensId,
            attachment.LensStatusHistoryId,
            attachment.FileName,
            attachment.OriginalName,
            attachment.FileSize,
            attachment.SortOrder,
            $"/{attachment.StorageRelativePath}",
            attachment.CreatedAtUtc);
}
