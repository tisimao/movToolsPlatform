using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Api.Controllers;

[ApiController]
[Route("api/path-mappings")]
[Authorize]
public sealed class PathMappingsController : ControllerBase
{
    private readonly IPathMappingService _pathMappingService;

    public PathMappingsController(IPathMappingService pathMappingService)
    {
        _pathMappingService = pathMappingService;
    }

    // Storage Roots endpoints (admin only)
    [HttpPost("storage-roots")]
    [ProducesResponseType(typeof(StorageRootResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<StorageRootResponse>> CreateStorageRoot([FromBody] StorageRootCreateRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
        {
            return BadRequest(new ApiErrorResponse("validation", "code_required", "Code is required.", null, null));
        }

        var result = await _pathMappingService.CreateStorageRootAsync(request.Code, request.Name, request.Description, cancellationToken);
        return CreatedAtAction(nameof(GetStorageRoots), null, ToStorageRootResponse(result));
    }

    [HttpGet("storage-roots")]
    [ProducesResponseType(typeof(IReadOnlyList<StorageRootResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<StorageRootResponse>>> GetStorageRoots(CancellationToken cancellationToken)
    {
        var roots = await _pathMappingService.GetStorageRootsAsync(cancellationToken);
        return Ok(roots.Select(ToStorageRootResponse).ToArray());
    }

    // Client Node endpoints
    [HttpPost("client-nodes")]
    [ProducesResponseType(typeof(ClientNodeResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ClientNodeResponse>> RegisterClientNode([FromBody] ClientNodeRegisterRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.ClientId))
        {
            return BadRequest(new ApiErrorResponse("validation", "client_id_required", "Client ID is required.", null, null));
        }

        var result = await _pathMappingService.RegisterClientNodeAsync(request.ClientId, request.ClientName, request.MachineName, cancellationToken);
        return CreatedAtAction(nameof(GetClientNode), new { clientId = result.ClientId }, ToClientNodeResponse(result));
    }

    [HttpGet("client-nodes/{clientId}")]
    [ProducesResponseType(typeof(ClientNodeResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ClientNodeResponse>> GetClientNode(string clientId, CancellationToken cancellationToken)
    {
        var node = await _pathMappingService.GetClientNodeAsync(clientId, cancellationToken);
        if (node == null)
        {
            return NotFound(new ApiErrorResponse("not_found", "client_node_not_found", "The client node could not be found.", null, null));
        }
        return Ok(ToClientNodeResponse(node));
    }

    [HttpGet("client-nodes")]
    [ProducesResponseType(typeof(ClientNodeResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ClientNodeResponse>>> GetMyClientNodes(CancellationToken cancellationToken)
    {
        // This would need current user context - for now return empty
        // In a full implementation, filter by current user
        return Ok(Array.Empty<ClientNodeResponse>());
    }

    // Path Mappings endpoints
    [HttpPost("client-nodes/{clientNodeId:guid}/mappings")]
    [ProducesResponseType(typeof(PathMappingResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PathMappingResponse>> SetPathMapping(Guid clientNodeId, [FromBody] PathMappingCreateRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.RootCode))
        {
            return BadRequest(new ApiErrorResponse("validation", "root_code_required", "Root code is required.", null, null));
        }

        var result = await _pathMappingService.SetPathMappingAsync(clientNodeId, request.RootCode, request.LocalPath, cancellationToken);
        return CreatedAtAction(nameof(GetPathMappings), new { clientNodeId }, ToPathMappingResponse(result));
    }

    [HttpGet("client-nodes/{clientNodeId:guid}/mappings")]
    [ProducesResponseType(typeof(IReadOnlyList<PathMappingResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<PathMappingResponse>>> GetPathMappings(Guid clientNodeId, CancellationToken cancellationToken)
    {
        var mappings = await _pathMappingService.GetPathMappingsAsync(clientNodeId, cancellationToken);
        return Ok(mappings.Select(ToPathMappingResponse).ToArray());
    }

    [HttpGet("client-nodes/{clientNodeId:guid}/mappings/{rootCode}")]
    [ProducesResponseType(typeof(PathMappingResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PathMappingResponse>> GetPathMapping(Guid clientNodeId, string rootCode, CancellationToken cancellationToken)
    {
        var mapping = await _pathMappingService.GetPathMappingAsync(clientNodeId, rootCode, cancellationToken);
        if (mapping == null)
        {
            return NotFound(new ApiErrorResponse("not_found", "mapping_not_found", "The path mapping could not be found.", null, null));
        }
        return Ok(ToPathMappingResponse(mapping));
    }

    [HttpDelete("client-nodes/{clientNodeId:guid}/mappings/{rootCode}")]
    [ProducesResponseType(typeof(NoContentResult), StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeletePathMapping(Guid clientNodeId, string rootCode, CancellationToken cancellationToken)
    {
        await _pathMappingService.DeletePathMappingAsync(clientNodeId, rootCode, cancellationToken);
        return NoContent();
    }

    private static StorageRootResponse ToStorageRootResponse(Movtools.Server.Application.Interfaces.StorageRootResult result) => new(
        result.Id, result.Code, result.Name, result.Description, result.IsActive, result.CreatedAtUtc, result.UpdatedAtUtc);

    private static ClientNodeResponse ToClientNodeResponse(Movtools.Server.Application.Interfaces.ClientNodeResult result) => new(
        result.Id, result.ClientId, result.ClientName, result.MachineName, result.IsActive, result.OwnerUserId, result.CreatedAtUtc, result.UpdatedAtUtc);

    private static PathMappingResponse ToPathMappingResponse(Movtools.Server.Application.Interfaces.PathMappingResult result) => new(
        result.Id, result.ClientNodeId, result.RootCode, result.LocalPath, result.CreatedAtUtc, result.UpdatedAtUtc);
}