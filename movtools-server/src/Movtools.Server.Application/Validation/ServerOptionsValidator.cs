using Microsoft.Extensions.Options;
using Movtools.Server.Application.Options;

namespace Movtools.Server.Application.Validation;

// 校验服务端基础配置，首批重点是 CORS 白名单。
public sealed class ServerOptionsValidator : IValidateOptions<ServerOptions>
{
    public ValidateOptionsResult Validate(string? name, ServerOptions options)
    {
        var failures = new List<string>();

        // 白名单必须至少有一个来源，且不能出现空字符串。
        if (options.AllowedOrigins is null || options.AllowedOrigins.Length == 0)
        {
            failures.Add($"{ServerOptions.SectionName}:AllowedOrigins must contain at least one origin.");
        }
        else if (options.AllowedOrigins.Any(string.IsNullOrWhiteSpace))
        {
            failures.Add($"{ServerOptions.SectionName}:AllowedOrigins cannot contain empty values.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }
}
