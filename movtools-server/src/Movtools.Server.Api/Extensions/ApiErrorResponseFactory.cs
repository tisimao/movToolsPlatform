using Microsoft.AspNetCore.Mvc;
using Movtools.Server.Api.Contracts;

namespace Movtools.Server.Api.Extensions;

public static class ApiErrorResponseFactory
{
    public static IActionResult CreateValidationResult(ActionContext context)
    {
        var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Validation");

        var traceId = context.HttpContext.TraceIdentifier;
        var errors = context.ModelState
            .Where(pair => pair.Value is { Errors.Count: > 0 })
            .ToDictionary(
                pair => pair.Key,
                pair => pair.Value!.Errors
                    .Select(error => string.IsNullOrWhiteSpace(error.ErrorMessage) ? "The value is invalid." : error.ErrorMessage)
                    .ToArray(),
                StringComparer.OrdinalIgnoreCase);

        logger.LogWarning(
            "Validation request rejected. TraceId={TraceId} Path={Path} Errors={Errors}",
            traceId,
            context.HttpContext.Request.Path,
            errors);

        return new BadRequestObjectResult(new ApiErrorResponse(
            Category: "validation",
            Code: "validation_error",
            Message: "The request parameters are invalid.",
            TraceId: traceId,
            Errors: errors));
    }
}
