# 阶段1: 构建
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build

WORKDIR /src

# 复制项目文件
COPY src/Movtools.Server.Api/Movtools.Server.Api.csproj ./Movtools.Server.Api/
COPY src/Movtools.Server.Application/Movtools.Server.Application.csproj ./Movtools.Server.Application/
COPY src/Movtools.Server.Domain/Movtools.Server.Domain.csproj ./Movtools.Server.Domain/
COPY src/Movtools.Server.Infrastructure/Movtools.Server.Infrastructure.csproj ./Movtools.Server.Infrastructure/

# 复制源码
COPY src/Movtools.Server.Api/ ./Movtools.Server.Api/
COPY src/Movtools.Server.Application/ ./Movtools.Server.Application/
COPY src/Movtools.Server.Domain/ ./Movtools.Server.Domain/
COPY src/Movtools.Server.Infrastructure/ ./Movtools.Server.Infrastructure/

# 恢复依赖
RUN dotnet restore Movtools.Server.Api/Movtools.Server.Api.csproj

# 发布
WORKDIR /src
RUN dotnet publish Movtools.Server.Api/Movtools.Server.Api.csproj -c Release -o /app/publish

# 阶段2: 运行时
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime

WORKDIR /app
COPY --from=build /app/publish .

# 非 root 用户运行
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080

ENTRYPOINT ["dotnet", "Movtools.Server.Api.dll"]