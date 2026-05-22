using Microsoft.Extensions.Logging;
using Movtools.Server.Application.Interfaces;

namespace Movtools.Server.Infrastructure.Services;

/// <summary>
/// SignalR 实时通知发布服务实现
/// 注意：这是一个简化实现，实际的 Hub 发布在 API 层处理
/// </summary>
public sealed class SignalRPublisher : ISignalRPublisher
{
    private readonly ILogger<SignalRPublisher> _logger;

    public SignalRPublisher(ILogger<SignalRPublisher> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc/>
    public Task PublishProjectUpdatedAsync(string projectCode, Guid projectId, string action, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Project updated: {ProjectCode} {ProjectId} {Action}", projectCode, projectId, action);
        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public Task PublishLensUpdatedAsync(string projectCode, Guid lensId, string status, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Lens updated: {ProjectCode} {LensId} {Status}", projectCode, lensId, status);
        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public Task PublishLensStatusChangedAsync(string projectCode, Guid lensId, string oldStatus, string newStatus, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Lens status changed: {ProjectCode} {LensId} {OldStatus} -> {NewStatus}", projectCode, lensId, oldStatus, newStatus);
        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public Task PublishReviewCreatedAsync(string projectCode, Guid reviewTaskId, Guid lensId, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Review created: {ProjectCode} {ReviewTaskId} {LensId}", projectCode, reviewTaskId, lensId);
        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public Task PublishReviewUpdatedAsync(string projectCode, Guid reviewTaskId, string status, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Review updated: {ProjectCode} {ReviewTaskId} {Status}", projectCode, reviewTaskId, status);
        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public Task PublishReviewCommentAddedAsync(string projectCode, Guid reviewTaskId, Guid commentId, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Review comment added: {ProjectCode} {ReviewTaskId} {CommentId}", projectCode, reviewTaskId, commentId);
        return Task.CompletedTask;
    }
}