using Microsoft.Extensions.DependencyInjection;

namespace Movtools.Server.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddOptions();
        return services;
    }
}
