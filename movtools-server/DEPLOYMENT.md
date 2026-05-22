# Movtools Server 部署文档

## 环境要求

- .NET 9.0 SDK
- PostgreSQL 16+
- Docker & Docker Compose（可选）

---

## 本地开发调试

### 方式一：直接运行

```bash
# 1. 启动 PostgreSQL（Docker）
docker run -d `
  -e POSTGRES_PASSWORD=movtools123 `
  -e POSTGRES_DB=movtools `
  -p 5432:5432 `
  postgres:16-alpine

# 2. 设置数据库连接（可选）或使用默认
# 默认连接到 localhost:5432
# 开发环境会优先尝试用业务账号重建缺失的开发库；若业务账号权限不足，会自动回退到 `postgres` 维护库继续联调；初始化失败会直接退出，避免假启动

# 3. 运行服务
cd src/Movtools.Server.Api
dotnet run
```

默认监听 `http://0.0.0.0:5001`。

### 方式二：使用 Docker Compose

```bash
# 1. 克隆项目
cd movtools-server

# 2. 设置环境变量
$env:DB_PASSWORD = "movtools123"
$env:JWT_SIGNING_KEY = "YourSuperSecretKeyHereMustBeAtLeast32Characters!"

# Windows:
$env:DB_PASSWORD = "movtools123"
$env:JWT_SIGNING_KEY = "YourSuperSecretKeyHereMustBeAtLeast32Characters!"

# Linux/Mac:
export DB_PASSWORD="movtools123"
export JWT_SIGNING_KEY="YourSuperSecretKeyHereMustBeAtLeast32Characters!"

# 3. 启动
docker-compose up -d --build

# 4. 查看日志
docker-compose logs -f api
```

### 方式三：开发模式（带热重载）

```bash
# 启动服务并监视变化
dotnet watch run --project src/Movtools.Server.Api
```

### 配置说明

在 `src/Movtools.Server.Api/appsettings.Development.json` 中配置：

```json
{
  "Database": {
    "Host": "localhost",
    "Port": 5432,
    "Name": "movtools",
    "Username": "postgres",
    "Password": "movtools123"
  },
  "Jwt": {
    "Issuer": "movtools-server",
    "Audience": "movtools-client",
    "SigningKey": "YourSuperSecretKeyHereMustBeAtLeast32Characters!"
  },
  "Server": {
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://localhost:3000"
    ]
  },
  "Observability": {
    "MinimumLevel": "Debug"
  }
}
```

---

## 生产部署

### Docker Compose（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/your-org/movtools-server.git
cd movtools-server

# 2. 设置环境变量（生产环境请使用更安全的密码）
export DB_PASSWORD="生成强密码"
export JWT_SIGNING_KEY="生成至少32字符的密钥"

# 3. 启动
docker-compose up -d --build

# 4. 检查健康状态
curl http://localhost:5001/health
```

### 端口说明

| 服务 | 端口 | 说明 |
|------|------|------|
| API | 5001 | HTTP API |
| PostgreSQL | 5432 | 数据库 |

LAN 联调时：`http://<host-ip>:5001`

### 验证部署

```bash
# 健康检查
curl http://localhost:5001/health

# API 端点示例
curl http://localhost:5001/api/auth/login -X POST -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}'
```

SignalR Hub：`http://<host-ip>:5001/hubs/movtools`

---

## 常见问题

### 1. 数据库连接失败

检查 PostgreSQL 是否启动：
```bash
docker ps | grep postgres
```

检查连接字符串是否正确：
```json
"Database": {
  "Host": "postgres",  // Docker Compose 中使用服务名
  "Port": "5432",
  ...
}
```

### 2. JWT 认证失败

确保签名密钥一致且长度足够（至少 32 字符）。

### 3. CORS 错误

在 `Server:AllowedOrigins` 中添加客户端地址。

### 4. 迁移失败

```bash
# 手动运行迁移
docker-compose exec api dotnet ef database update

# 或重新创建数据库
docker-compose down -v
docker-compose up -d
```

---

## 测试账号

默认管理员账号（首次运行自动创建）：
- 用户名：`admin`
- 密码：`admin123`
