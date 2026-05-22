# Movtools Server 本地调试指南

## 快速启动

### 1. 前置要求

- .NET 9.0 SDK
- PostgreSQL 16+（本地或 Docker）

### 2. 启动数据库

```powershell
# 使用 Docker 启动 PostgreSQL
docker run -d `
  --name movtools-postgres `
  -e POSTGRES_PASSWORD=movtools123 `
  -e POSTGRES_DB=movtools `
  -p 5432:5432 `
  postgres:16-alpine
```

### 3. 启动服务

```powershell
cd src/Movtools.Server.Api
dotnet run
```

默认监听 `http://0.0.0.0:5001`，本机和局域网电脑都可访问。

或使用热重载：

```powershell
dotnet watch run
```

### 4. 验证

```powershell
# 健康检查
curl http://localhost:5001/health

# 登录
curl http://localhost:5001/api/auth/login `
  -X POST `
  -H "Content-Type: application/json" `
  -d '{"username":"admin","password":"admin123"}'
```

LAN 联调时把 `localhost` 换成主机 IP：`http://<host-ip>:5001`

---

## API 端点概览

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/me` | GET | 当前用户信息 |
| `/api/projects` | GET | 项目列表 |
| `/api/projects` | POST | 创建项目 |
| `/api/episodes` | GET | 集列表 |
| `/api/lenses` | GET | 镜头列表 |
| `/api/reviews` | GET | 待审列表 |
| `/api/reviews` | POST | 提交审片 |
| `/api/reviews/{id}/approve` | POST | 通过审片 |
| `/api/reviews/{id}/reject` | POST | 拒绝审片 |
| `/api/reviews/{id}/comments` | POST | 添加评论 |
| `/api/sync/changes` | GET | 增量拉取 |
| `/hubs/movtools` | WS | SignalR Hub |

---

## 调试技巧

### Visual Studio Code

```json
// .vscode/launch.json
{
  "configurations": [
    {
      "name": "Movtools Server",
      "type": "coreclr",
      "request": "launch",
      "program": "${workspaceFolder}/src/Movtools.Server.Api/bin/Debug/net9.0/Movtools.Server.Api.dll",
      "args": [],
      "cwd": "${workspaceFolder}/src/Movtools.Server.Api",
      "env": {
        "ASPNETCORE_ENVIRONMENT": "Development"
      }
    }
  ]
}
```

### Visual Studio

直接按 F5 启动 `Movtools.Server.Api` 项目。

---

## 测试账号

- 用户名：`admin`
- 密码：`admin123`

首次启动时会自动创建默认角色和用户。

---

## 常见问题

### 连接 PostgreSQL 失败

确认数据库正在运行：
```powershell
docker ps | findstr postgres
```

### 端口冲突

5001 端口被占用时，修改 `launchSettings.json` 或启动端口：
```json
{
  "profiles": {
    "http": {
      "applicationUrl": "http://0.0.0.0:5002"
    }
  }
}
```

### 查看详细日志

设置 `Logging:LogLevel:Default` 为 `Debug`。

---

## SignalR 测试

使用浏览器控制台连接：

```javascript
const connection = new signalR.HubConnectionBuilder()
  .withUrl("http://<host-ip>:5001/hubs/movtools")
  .withAutomaticReconnect()
  .build();

await connection.start();
console.log("Connected!");

// 监听事件
connection.on("review.created", (data) => {
  console.log("New review:", data);
});
```
