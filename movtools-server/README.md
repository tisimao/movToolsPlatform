# Movtools Server

## Run

```bash
dotnet run --project src/Movtools.Server.Api
```

Development listens on `http://0.0.0.0:5001`, so the host machine and LAN peers can both reach the server.

## Health check

```bash
GET /health
```

## LAN联调地址

- Health: `http://<host-ip>:5001/health`
- Login: `http://<host-ip>:5001/api/auth/login`
- SignalR: `http://<host-ip>:5001/hubs/movtools`

## Diagnostics endpoints

- `GET /api/diagnostics/config` - verify configuration binding
- `POST /api/diagnostics/echo` - verify validation error shape
- `GET /api/diagnostics/boom` - verify unhandled exception handling

## Environment

- Development settings: `src/Movtools.Server.Api/appsettings.Development.json`
- Default settings: `src/Movtools.Server.Api/appsettings.json`

## Review workflow docs

- Protocol baseline: `..\Doc\通信协议文档.md`
- Project baseline: `..\Doc\项目固化文档.md`
- UI naming baseline: `..\Doc\平台功能与UI统一命名清单.md`

Current producer/director review workflow uses the `review-tasks` and `review-feedbacks` route families as the formal baseline.
