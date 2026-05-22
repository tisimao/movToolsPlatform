using Microsoft.Extensions.Options;
using Movtools.Server.Application.Options;

namespace Movtools.Server.Application.Validation;

// 校验数据库配置是否完整，避免启动后才发现无法连接。
public sealed class DatabaseOptionsValidator : IValidateOptions<DatabaseOptions>
{
    public ValidateOptionsResult Validate(string? name, DatabaseOptions options)
    {
        var failures = new List<string>();

        // 连接串为空时，给出明确、可读的错误信息。
        if (string.IsNullOrWhiteSpace(options.ConnectionString))
        {
            failures.Add($"{DatabaseOptions.SectionName}:ConnectionString is required.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }
}
