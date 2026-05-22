# Movtools 平台

这是一个面向影视协作流程的工具平台，仓库里目前包含前端桌面端、后端服务端和项目文档。

## 仓库结构

- `movtools-client`：Electron + React 桌面客户端
- `movtools-server`：ASP.NET Core Web API + SignalR + PostgreSQL 后端
- `Doc`：产品、协议、流程相关文档

## 快速开始

### 1. 启动后端

```bash
cd movtools-server
dotnet run --project src/Movtools.Server.Api
```

后端默认开发地址：`http://0.0.0.0:5001`

常用接口：

- `GET /health`
- `GET /api/diagnostics/config`
- `POST /api/diagnostics/echo`
- `GET /api/diagnostics/boom`
- `GET /hubs/movtools`

### 2. 启动前端

```bash
cd movtools-client
npm install
npm run dev
```

### 3. Docker 联调

```bash
cd movtools-server
docker compose up -d
```

启动后会包含：

- `movtools-api`
- `movtools-postgres`

运行前请准备环境变量：

- `DB_PASSWORD`
- `JWT_SIGNING_KEY`

## 前端说明

前端入口：

- `movtools-client/electron/main.ts`
- `movtools-client/src/main.tsx`
- `movtools-client/src/App.tsx`

前端技术栈：

- Electron
- React 19
- Vite / electron-vite
- Zustand
- SignalR 客户端

## 后端说明

后端入口：

- `movtools-server/src/Movtools.Server.Api/Program.cs`
- `movtools-server/src/Movtools.Server.Api/Extensions/ServiceCollectionExtensions.cs`

后端技术栈：

- ASP.NET Core Web API
- Entity Framework Core
- SignalR
- PostgreSQL
- JWT

## 推荐开发流程

1. 先启动后端并确认 `/health` 正常
2. 再启动前端并检查是否能连到本机服务端
3. 新功能建议单独建分支开发
4. 完成后再合回 `main`

## 参考文档

- `Doc/通信协议文档.md`
- `Doc/项目固化文档.md`
- `Doc/平台功能与UI统一命名清单.md`
- `movtools-server/README.md`
