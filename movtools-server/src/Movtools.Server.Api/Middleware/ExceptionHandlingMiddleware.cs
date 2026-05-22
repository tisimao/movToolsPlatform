using System.Text.Json;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Exceptions;

namespace Movtools.Server.Api.Middleware;

// 统一异常处理中间件：把不同异常类型转换成一致的响应结构。
public sealed class ExceptionHandlingMiddleware
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception exception)
        {
            await WriteErrorAsync(context, exception);
        }
    }

    private async Task WriteErrorAsync(HttpContext context, Exception exception)
    {
        var traceId = context.TraceIdentifier;

        // 区分验证错误、业务错误和系统错误，分别返回不同状态码与分类。
        var (statusCode, category, code, message, logLevel) = exception switch
        {
            ValidationAppException validation => (
                validation.StatusCode,
                "validation",
                validation.Code,
                validation.Message,
                LogLevel.Warning),
            UnauthorizedAppException unauthorized => (
                unauthorized.StatusCode,
                "auth",
                unauthorized.Code,
                unauthorized.Message,
                LogLevel.Warning),
            NotFoundAppException notFound => (
                notFound.StatusCode,
                "business",
                notFound.Code,
                notFound.Message,
                LogLevel.Warning),
            UnprocessableEntityAppException unprocessable => (
                unprocessable.StatusCode,
                "business",
                unprocessable.Code,
                unprocessable.Message,
                LogLevel.Warning),
            BusinessException business => (
                business.StatusCode,
                "business",
                business.Code,
                business.Message,
                LogLevel.Warning),
            _ => (
                StatusCodes.Status500InternalServerError,
                "system",
                "internal_server_error",
                "An unexpected error occurred.",
                LogLevel.Error)
        };

        // 日志中必须包含追踪号和路径，方便定位问题请求。
        _logger.Log(
            logLevel,
            exception,
            "Request failed. Category={Category} Code={Code} TraceId={TraceId} Path={Path}",
            category,
            code,
            traceId,
            context.Request.Path);

        context.Response.Clear();
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";

        // 对外只返回稳定、统一的错误结构，不泄漏内部堆栈。
        var payload = new ApiErrorResponse(
            Category: category,
            Code: code,
            Message: message,
            TraceId: traceId);

        await context.Response.WriteAsync(JsonSerializer.Serialize(payload, SerializerOptions));
    }
}
