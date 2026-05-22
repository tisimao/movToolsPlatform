using System.Net;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Movtools.Server.Application;
using Movtools.Server.Application.Options;
using Movtools.Server.Application.Validation;
using Movtools.Server.Infrastructure;

namespace Movtools.Server.Api.Extensions;

// 统一封装服务注册，避免 Program.cs 只保留启动编排逻辑。
public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddMovtoolsServer(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        // Application 层先注册，保持依赖方向自上而下。
        services.AddApplication();
        services.AddInfrastructure(configuration);

        services.AddHttpContextAccessor();

        // API 控制器统一使用同一套错误响应格式。
        services.AddControllers()
            .ConfigureApiBehaviorOptions(options =>
            {
                options.InvalidModelStateResponseFactory = ApiErrorResponseFactory.CreateValidationResult;
            });

        // SignalR Hub 注册
        services.AddSignalR();

        // JSON 输出保持可读且支持枚举字符串化。
        services.Configure<JsonOptions>(options =>
        {
            options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
            options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
        });

        // 基础健康检查，后续可按需叠加数据库、缓存等检查项。
        services.AddHealthChecks()
            .AddCheck("self", () => HealthCheckResult.Healthy("API is running"));

        // CORS 由配置驱动，允许开发/生产环境分别维护白名单。
        var allowedOrigins = configuration.GetSection(ServerOptions.SectionName).Get<ServerOptions>()?.AllowedOrigins ?? [];
        var isDevelopment = environment.IsDevelopment();
        services.AddCors(options =>
        {
            options.AddPolicy("Default", policy =>
            {
                policy.SetIsOriginAllowed(origin => IsAllowedOrigin(origin, allowedOrigins, isDevelopment))
                    .AllowAnyHeader()
                    .AllowAnyMethod();
            });
        });

        // 关键配置项在启动时就绑定并校验，减少运行时才暴露问题。
        services.AddOptions<ServerOptions>()
            .Bind(configuration.GetRequiredSection(ServerOptions.SectionName))
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<ServerOptions>, ServerOptionsValidator>();

        services.AddOptions<DatabaseOptions>()
            .Bind(configuration.GetRequiredSection(DatabaseOptions.SectionName))
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<DatabaseOptions>, DatabaseOptionsValidator>();

        services.AddOptions<JwtOptions>()
            .Bind(configuration.GetRequiredSection(JwtOptions.SectionName))
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<JwtOptions>, JwtOptionsValidator>();

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer();

        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<IOptions<JwtOptions>>((options, jwtOptionsAccessor) =>
            {
                var jwtOptions = jwtOptionsAccessor.Value;

                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = jwtOptions.Issuer,
                    ValidateAudience = true,
                    ValidAudience = jwtOptions.Audience,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(jwtOptions.SigningKey)),
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromMinutes(2),
                    NameClaimType = System.Security.Claims.ClaimTypes.Name,
                    RoleClaimType = System.Security.Claims.ClaimTypes.Role
                };

                options.Events = JwtBearerEventsFactory.Create();
            });

        services.AddAuthorization();

        services.AddOptions<ObservabilityOptions>()
            .Bind(configuration.GetRequiredSection(ObservabilityOptions.SectionName))
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<ObservabilityOptions>, ObservabilityOptionsValidator>();

        return services;
    }

    private static bool IsAllowedOrigin(string origin, string[] allowedOrigins, bool isDevelopment)
    {
        if (allowedOrigins.Any(allowedOrigin => string.Equals(allowedOrigin, origin, StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        if (!isDevelopment)
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(origin) || string.Equals(origin, "null", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
        {
            return false;
        }

        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(uri.Host, "::1", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (!IPAddress.TryParse(uri.Host, out var address))
        {
            return false;
        }

        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            var bytes = address.GetAddressBytes();
            return bytes[0] == 10
                || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
                || (bytes[0] == 192 && bytes[1] == 168)
                || (bytes[0] == 169 && bytes[1] == 254);
        }

        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
        {
            return address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6UniqueLocal;
        }

        return false;
    }
}
