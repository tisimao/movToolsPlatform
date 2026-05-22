using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Movtools.Server.Api.Hubs;

/// <summary>
/// Movtools 实时通知 Hub
/// </summary>
[Authorize]
public sealed class MovtoolsHub : Hub
{
    private readonly ILogger<MovtoolsHub> _logger;

    public MovtoolsHub(ILogger<MovtoolsHub> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// 客户端连接时调用
    /// </summary>
    public override async Task OnConnectedAsync()
    {
        var httpContext = Context.GetHttpContext();
        var userId = httpContext?.User.Identity?.Name ?? "unknown";
        
        _logger.LogInformation("Client connected: {ConnectionId}, User: {UserId}", Context.ConnectionId, userId);
        await base.OnConnectedAsync();
    }

    /// <summary>
    /// 客户端断开连接时调用
    /// </summary>
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation("Client disconnected: {ConnectionId}", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>
    /// 客户端加入项目组
    /// </summary>
    public async Task JoinProjectGroup(string projectCode)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"project:{projectCode}");
        _logger.LogDebug("User {ConnectionId} joined project group: {ProjectCode}", Context.ConnectionId, projectCode);
    }

    /// <summary>
    /// 客户端离开项目组
    /// </summary>
    public async Task LeaveProjectGroup(string projectCode)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"project:{projectCode}");
        _logger.LogDebug("User {ConnectionId} left project group: {ProjectCode}", Context.ConnectionId, projectCode);
    }
}