using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Controllers;

[ApiController]
[Route("api/sync")]
[Authorize]
public sealed class SyncController : ControllerBase
{
    private readonly ISyncService _syncService;

    public SyncController(ISyncService syncService)
    {
        _syncService = syncService;
    }

    /// <summary>
    /// 获取同步变更（增量拉取）
    /// </summary>
    [HttpGet("changes")]
    [ProducesResponseType(typeof(SyncChangesResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<SyncChangesResponse>> GetChanges(
        [FromQuery] long since = 0, 
        [FromQuery] int limit = 100, 
        CancellationToken cancellationToken = default)
    {
        if (limit <= 0 || limit > 500)
        {
            limit = 100;
        }

        var changes = await _syncService.GetChangesAsync(since, limit, cancellationToken);
        var currentSequence = await _syncService.GetCurrentSequenceAsync(cancellationToken);

        return Ok(new SyncChangesResponse(
            currentSequence,
            changes.Select(c => new SyncChangeResponse(
                c.Sequence,
                c.EntityType,
                c.EntityId,
                c.Action,
                c.OldValue,
                c.NewValue,
                c.UserId,
                c.CreatedAtUtc)).ToArray()));
    }

    /// <summary>
    /// 获取当前同步序号
    /// </summary>
    [HttpGet("sequence")]
    [ProducesResponseType(typeof(SyncSequenceResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<SyncSequenceResponse>> GetSequence(CancellationToken cancellationToken)
    {
        var sequence = await _syncService.GetCurrentSequenceAsync(cancellationToken);
        return Ok(new SyncSequenceResponse(sequence));
    }
}