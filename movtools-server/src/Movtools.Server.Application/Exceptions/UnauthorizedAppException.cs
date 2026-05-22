using Microsoft.AspNetCore.Http;

namespace Movtools.Server.Application.Exceptions;

public sealed class UnauthorizedAppException : AppException
{
    public UnauthorizedAppException(string code, string message)
        : base(code, message, StatusCodes.Status401Unauthorized)
    {
    }
}
