using Microsoft.AspNetCore.Http;

namespace Movtools.Server.Application.Exceptions;

public sealed class UnprocessableEntityAppException : AppException
{
    public UnprocessableEntityAppException(string code, string message)
        : base(code, message, StatusCodes.Status422UnprocessableEntity)
    {
    }
}
