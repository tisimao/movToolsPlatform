using Microsoft.Extensions.Options;
using Movtools.Server.Application.Options;

namespace Movtools.Server.Application.Validation;

// 校验 JWT 配置完整性，认证任务依赖这些值。
public sealed class JwtOptionsValidator : IValidateOptions<JwtOptions>
{
    public ValidateOptionsResult Validate(string? name, JwtOptions options)
    {
        var failures = new List<string>();

        // Issuer / Audience / SigningKey 缺一不可。
        if (string.IsNullOrWhiteSpace(options.Issuer))
        {
            failures.Add($"{JwtOptions.SectionName}:Issuer is required.");
        }

        if (string.IsNullOrWhiteSpace(options.Audience))
        {
            failures.Add($"{JwtOptions.SectionName}:Audience is required.");
        }

        if (string.IsNullOrWhiteSpace(options.SigningKey) || options.SigningKey.Length < 32)
        {
            failures.Add($"{JwtOptions.SectionName}:SigningKey must be at least 32 characters.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }
}
