using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Movtools.Server.Application.Options;

namespace Movtools.Server.Application.Validation;

// 校验日志级别配置，避免输入非法字符串导致启动异常不清晰。
public sealed class ObservabilityOptionsValidator : IValidateOptions<ObservabilityOptions>
{
    public ValidateOptionsResult Validate(string? name, ObservabilityOptions options)
    {
        // 先判断是否为空，再判断是否属于合法的 LogLevel 枚举值。
        if (string.IsNullOrWhiteSpace(options.MinimumLevel))
        {
            return ValidateOptionsResult.Fail($"{ObservabilityOptions.SectionName}:MinimumLevel is required.");
        }

        return Enum.TryParse<LogLevel>(options.MinimumLevel, true, out _)
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail($"{ObservabilityOptions.SectionName}:MinimumLevel must be a valid LogLevel value.");
    }
}
