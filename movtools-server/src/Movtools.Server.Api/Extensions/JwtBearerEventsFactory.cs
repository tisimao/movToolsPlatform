using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Movtools.Server.Api.Contracts;

namespace Movtools.Server.Api.Extensions;

internal static class JwtBearerEventsFactory
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    public static JwtBearerEvents Create()
    {
        return new JwtBearerEvents
        {
            OnChallenge = context =>
            {
                if (context.Response.HasStarted)
                {
                    return Task.CompletedTask;
                }

                context.HandleResponse();
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                context.Response.ContentType = "application/json; charset=utf-8";

                var traceId = context.HttpContext.TraceIdentifier;
                var payload = new ApiErrorResponse("auth", "unauthorized", "Authentication is required.", traceId);
                return context.Response.WriteAsync(JsonSerializer.Serialize(payload, SerializerOptions));
            },
            OnForbidden = context =>
            {
                if (context.Response.HasStarted)
                {
                    return Task.CompletedTask;
                }

                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                context.Response.ContentType = "application/json; charset=utf-8";

                var traceId = context.HttpContext.TraceIdentifier;
                var payload = new ApiErrorResponse("auth", "forbidden", "You do not have permission to perform this action.", traceId);
                return context.Response.WriteAsync(JsonSerializer.Serialize(payload, SerializerOptions));
            }
        };
    }
}
