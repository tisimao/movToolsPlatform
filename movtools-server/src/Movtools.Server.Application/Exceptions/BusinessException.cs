using Microsoft.AspNetCore.Http;

namespace Movtools.Server.Application.Exceptions;

public sealed class BusinessException : AppException
{
    public BusinessException(string code, string message)
        : base(code, message, StatusCodes.Status409Conflict)
    {
    }
}
