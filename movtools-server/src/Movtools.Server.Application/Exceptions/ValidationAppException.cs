using Microsoft.AspNetCore.Http;

namespace Movtools.Server.Application.Exceptions;

public sealed class ValidationAppException : AppException
{
    public ValidationAppException(string code, string message)
        : base(code, message, StatusCodes.Status400BadRequest)
    {
    }
}
