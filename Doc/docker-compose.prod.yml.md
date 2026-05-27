# `docker-compose.prod.yml` 文档版配置

这份文件用于 `MovtoolsEx` 后端的公测/准生产部署，适合：

- Windows 小范围部署
- 后续迁移到群晖 `Container Manager`

它的核心目标是：

- 使用 GitHub Actions 构建好的 `ghcr.io` 镜像
- 同时运行 API + PostgreSQL
- 通过 `.env` 注入敏感配置
- 保留数据库数据卷

---

## 一、配套文件

建议同目录准备以下文件：

- `docker-compose.prod.yml`
- `.env`

`.env` 示例：

```env
DB_PASSWORD=请替换成强密码
JWT_SIGNING_KEY=请替换成长随机字符串至少32位
```

---

## 二、compose 配置

```yaml
services:
  api:
    image: ghcr.io/你的GitHub用户名/movtools-server:latest
    container_name: movtools-api
    ports:
      - "5001:8080"
    environment:
      - ASPNETCORE_ENVIRONMENT=Production
      - ASPNETCORE_URLS=http://+:8080
      - Database__ConnectionString=Host=postgres;Port=5432;Database=movtools_server;Username=postgres;Password=${DB_PASSWORD}
      - Jwt__Issuer=Movtools.Server.Production
      - Jwt__Audience=Movtools.Client.Production
      - Jwt__SigningKey=${JWT_SIGNING_KEY}
      - Server__AllowedOrigins__0=http://localhost:3000
      - Server__AllowedOrigins__1=http://localhost:5173
      - Server__AllowedOrigins__2=http://127.0.0.1:3000
      - Server__AllowedOrigins__3=http://127.0.0.1:5173
      - Server__AllowedOrigins__4=http://你的Windows机器IP:5001
      - Observability__MinimumLevel=Information
      - Observability__IncludeScopes=false
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    container_name: movtools-postgres
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=movtools_server
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d movtools_server"]
      interval: 10s
      timeout: 5s
      retries: 10
    restart: unless-stopped

volumes:
  postgres-data:
```

---

## 三、你需要替换的内容

- `你的GitHub用户名`
- `你的Windows机器IP`
- `.env` 中的数据库密码
- `.env` 中的 JWT 签名密钥

---

## 四、启动命令

在 `docker-compose.prod.yml` 同目录执行：

```powershell
docker compose -f docker-compose.prod.yml up -d
```

更新镜像时执行：

```powershell
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## 五、访问检查

健康检查地址：

```text
http://你的Windows机器IP:5001/health
```

如果后续切换到 HTTPS，再把客户端里的服务地址改成正式域名即可。
