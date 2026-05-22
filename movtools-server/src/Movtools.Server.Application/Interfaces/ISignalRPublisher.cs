namespace Movtools.Server.Application.Interfaces;

/// <summary>
/// SignalR 实时通知发布服务接口
/// </summary>
public interface ISignalRPublisher
{
    /// <summary>
    /// 发布项目更新事件
    /// </summary>
    Task PublishProjectUpdatedAsync(string projectCode, Guid projectId, string action, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 发布镜头更新事件
    /// </summary>
    Task PublishLensUpdatedAsync(string projectCode, Guid lensId, string status, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 发布镜头状态变更事件
    /// </summary>
    Task PublishLensStatusChangedAsync(string projectCode, Guid lensId, string oldStatus, string newStatus, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 发布审片任务创建事件
    /// </summary>
    Task PublishReviewCreatedAsync(string projectCode, Guid reviewTaskId, Guid lensId, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 发布审片任务更新事件
    /// </summary>
    Task PublishReviewUpdatedAsync(string projectCode, Guid reviewTaskId, string status, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// 发布审片评论事件
    /// </summary>
    Task PublishReviewCommentAddedAsync(string projectCode, Guid reviewTaskId, Guid commentId, CancellationToken cancellationToken = default);
}