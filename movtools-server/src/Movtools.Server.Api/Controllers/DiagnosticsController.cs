using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Application.Options;
using Movtools.Server.Application.Exceptions;

namespace Movtools.Server.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class DiagnosticsController : ControllerBase
{
    private readonly IOptions<ServerOptions> _serverOptions;
    private readonly IOptions<DatabaseOptions> _databaseOptions;
    private readonly IOptions<JwtOptions> _jwtOptions;
    private readonly IOptions<ObservabilityOptions> _observabilityOptions;
    private readonly IHostEnvironment _environment;

    public DiagnosticsController(
        IOptions<ServerOptions> serverOptions,
        IOptions<DatabaseOptions> databaseOptions,
        IOptions<JwtOptions> jwtOptions,
        IOptions<ObservabilityOptions> observabilityOptions,
        IHostEnvironment environment)
    {
        _serverOptions = serverOptions;
        _databaseOptions = databaseOptions;
        _jwtOptions = jwtOptions;
        _observabilityOptions = observabilityOptions;
        _environment = environment;
    }

    [HttpGet("config")]
    public ActionResult<DiagnosticsConfigResponse> GetConfig()
    {
        return Ok(new DiagnosticsConfigResponse(
            Environment: _environment.EnvironmentName,
            AllowedOrigins: _serverOptions.Value.AllowedOrigins,
            DatabaseConfigured: !string.IsNullOrWhiteSpace(_databaseOptions.Value.ConnectionString),
            JwtIssuer: _jwtOptions.Value.Issuer,
            JwtAudience: _jwtOptions.Value.Audience,
            LoggingMinimumLevel: _observabilityOptions.Value.MinimumLevel,
            LoggingIncludeScopes: _observabilityOptions.Value.IncludeScopes));
    }

    [HttpPost("echo")]
    public ActionResult<object> Echo([FromBody] DiagnosticEchoRequest request)
    {
        return Ok(new { message = request.Message });
    }

    [HttpGet("validate")]
    public ActionResult<object> Validate([FromQuery, Required] string? name)
    {
        return Ok(new { name });
    }

    [HttpGet("boom")]
    public IActionResult Boom()
    {
        throw new InvalidOperationException("Diagnostics boom for pipeline verification.");
    }

    [HttpGet("business-error")]
    public IActionResult BusinessError()
    {
        throw new BusinessException("diagnostics_conflict", "Diagnostics business rule failed.");
    }
}
