using Microsoft.Extensions.Logging;

namespace Movtools.Server.Application.Options;

// 日志与可观测性配置。
public sealed class ObservabilityOptions
{
    public const string SectionName = "Observability";

    // 控制台/结构化日志的最低输出级别。
    public string MinimumLevel { get; init; } = nameof(LogLevel.Information);

    // 是否保留作用域信息，便于定位请求链路。
    public bool IncludeScopes { get; init; } = true;
}
