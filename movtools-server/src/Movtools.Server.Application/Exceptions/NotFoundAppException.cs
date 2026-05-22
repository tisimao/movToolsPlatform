using Microsoft.AspNetCore.Http;

namespace Movtools.Server.Application.Exceptions;

public sealed class NotFoundAppException : AppException
{
    public NotFoundAppException(string code, string message)
        : base(code, message, StatusCodes.Status404NotFound)
    {
    }
}
