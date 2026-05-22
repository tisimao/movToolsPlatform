using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Exceptions;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Controllers;

[ApiController]
[Route("api/lenses/{lensId:guid}/repair-attachments")]
[Authorize]
public sealed class RepairAttachmentsController : ControllerBase
{
    private readonly IRepairAttachmentService _repairAttachmentService;

    public RepairAttachmentsController(IRepairAttachmentService repairAttachmentService)
    {
        _repairAttachmentService = repairAttachmentService;
    }

    [HttpPost]
    [ProducesResponseType(typeof(RepairAttachmentResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RepairAttachmentResponse>> Upload(
        Guid lensId,
        [FromForm] RepairAttachmentUploadRequest request,
        CancellationToken cancellationToken)
    {
        if (request.File == null || request.File.Length == 0)
        {
            return BadRequest(new ApiErrorResponse("validation", "file_required", "A file must be provided.", null, null));
        }

        var result = await _repairAttachmentService.UploadAsync(
            lensId,
            request.LensStatusHistoryId,
            request.File,
            request.SortOrder,
            cancellationToken);

        return CreatedAtAction(nameof(GetByLens), new { lensId }, result.ToResponse());
    }

    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<RepairAttachmentResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<RepairAttachmentResponse>>> GetByLens(
        Guid lensId,
        CancellationToken cancellationToken)
    {
        var attachments = await _repairAttachmentService.GetByLensIdAsync(lensId, cancellationToken);
        return Ok(attachments.Select(x => x.ToResponse()).ToArray());
    }

    [HttpDelete("{attachmentId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(
        Guid lensId,
        Guid attachmentId,
        CancellationToken cancellationToken)
    {
        await _repairAttachmentService.DeleteAsync(attachmentId, cancellationToken);
        return NoContent();
    }

    [HttpPut("{attachmentId:guid}/sort-order")]
    [ProducesResponseType(typeof(RepairAttachmentResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RepairAttachmentResponse>> UpdateSortOrder(
        Guid lensId,
        Guid attachmentId,
        [FromBody] RepairAttachmentSortOrderRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _repairAttachmentService.UpdateSortOrderAsync(attachmentId, request.SortOrder, cancellationToken);
        return Ok(result.ToResponse());
    }
}
