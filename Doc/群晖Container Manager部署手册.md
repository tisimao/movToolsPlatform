# 群晖 Container Manager 部署手册

## 一、文档目的

本文档用于指导 `MovtoolsEx` 项目后端服务从 GitHub 镜像仓库部署到群晖 NAS 的 `Container Manager`。

适用场景：

- 你已经把项目代码托管到 GitHub
- 你已经通过 GitHub Actions 自动构建后端镜像
- 你的后端镜像已发布到 `ghcr.io`
- 你准备将当前 Windows 小范围部署迁移到群晖长期运行

本文档只覆盖后端部署，不包含 Electron 客户端打包。

---

## 二、部署目标

在群晖上运行以下两个服务：

- `movtools-api`：后端 API 服务
- `movtools-postgres`：PostgreSQL 数据库

部署完成后，你的客户端将连接群晖上的 API 地址进行使用。

---

## 三、前置条件

开始前，请确保满足以下条件：

- 群晖 DSM 已安装 `Container Manager`
- 群晖可以正常联网
- 你有群晖管理员权限
- GitHub 上已经存在镜像，例如：
  - `ghcr.io/你的GitHub用户名/movtools-server:latest`
- 如果镜像是私有的，你已经准备好了 GitHub Token

建议还准备好：

- 群晖固定局域网 IP
- 一个用于容器数据持久化的共享文件夹

---

## 四、建议的群晖目录结构

建议在群晖里建立一个共享目录，例如：

- `docker/movtools`

在这个目录下再准备两个子目录：

- `docker/movtools/postgres-data`
- `docker/movtools/config`

作用如下：

- `postgres-data`：保存 PostgreSQL 数据
- `config`：保存部署说明或导出的 compose 文件

---

## 五、镜像来源说明

推荐继续使用 GitHub Container Registry 作为镜像源。

镜像地址格式如下：

```text
ghcr.io/你的GitHub用户名/movtools-server:latest
```

如果你以后发布新版本，群晖只需要重新拉取该镜像即可。

---

## 六、如果 GHCR 镜像是私有的

如果你的镜像是私有的，群晖默认无法直接拉取，需要先准备 GitHub Personal Access Token。

### 6.1 创建 Token

在 GitHub 中进入：

1. `Settings`
2. `Developer settings`
3. `Personal access tokens`
4. 创建新 Token

建议至少授予：

- `read:packages`

### 6.2 在群晖中登录镜像仓库

在 `Container Manager` 中添加镜像仓库凭据时：

- Registry：`ghcr.io`
- Username：你的 GitHub 用户名
- Password：你的 GitHub Token

如果你的镜像未来改为公开，可省略这一步。

---

## 七、推荐部署方式

群晖上推荐使用 `Project` 或 `Compose` 方式部署，而不是一个个手工点容器。

原因：

- 更容易维护多个服务
- 配置更清晰
- 后续更新更方便
- 与 Windows 上的 `docker compose` 思路一致

---

## 八、准备群晖版 compose 文件

建议使用以下 compose 内容。

你可以在群晖 `Container Manager` 的项目部署页面直接粘贴，也可以先保存为文件。

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
      - Database__ConnectionString=Host=postgres;Port=5432;Database=movtools_server;Username=postgres;Password=请替换数据库密码
      - Jwt__Issuer=Movtools.Server.Production
      - Jwt__Audience=Movtools.Client.Production
      - Jwt__SigningKey=请替换为至少32位的长随机字符串
      - Server__AllowedOrigins__0=http://localhost:3000
      - Server__AllowedOrigins__1=http://localhost:5173
      - Server__AllowedOrigins__2=http://127.0.0.1:3000
      - Server__AllowedOrigins__3=http://127.0.0.1:5173
      - Server__AllowedOrigins__4=http://你的群晖IP:5001
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
      - POSTGRES_PASSWORD=请替换数据库密码
      - POSTGRES_DB=movtools_server
    volumes:
      - /volume1/docker/movtools/postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d movtools_server"]
      interval: 10s
      timeout: 5s
      retries: 10
    restart: unless-stopped
```

你需要替换以下内容：

- `你的GitHub用户名`
- `请替换数据库密码`
- `请替换为至少32位的长随机字符串`
- `你的群晖IP`
- `/volume1/docker/movtools/postgres-data`（若你的卷路径不同）

---

## 九、在群晖 Container Manager 中创建项目

### 9.1 打开 Container Manager

登录群晖 DSM 后：

1. 打开 `Container Manager`
2. 进入 `项目` 或 `Projects`
3. 点击 `新增` / `Create`

---

### 9.2 选择通过 Compose 创建

在创建项目时：

1. 选择使用 `docker-compose.yml` 或直接粘贴 Compose 内容
2. 项目名称建议填写：`movtools`
3. 将上一节的 compose 内容粘贴进去

---

### 9.3 检查卷映射目录

确认 PostgreSQL 数据目录映射路径正确，例如：

- `/volume1/docker/movtools/postgres-data`

如果目录不存在，请先在 File Station 中手动创建。

---

### 9.4 确认端口映射

确认 API 对外暴露端口为：

- 宿主机：`5001`
- 容器：`8080`

这样外部访问地址将是：

```text
http://你的群晖IP:5001
```

---

### 9.5 启动项目

确认无误后点击部署。

部署成功后，群晖会自动：

- 拉取后端镜像
- 拉取 PostgreSQL 镜像
- 启动数据库
- 启动 API 服务

---

## 十、验证服务是否启动成功

部署完成后请检查以下内容。

### 10.1 查看容器状态

在 `Container Manager` 中确认：

- `movtools-api` 正在运行
- `movtools-postgres` 正在运行

---

### 10.2 查看日志

优先查看 `movtools-api` 日志，确认是否出现以下问题：

- 配置项缺失
- JWT 密钥无效
- 数据库连接失败
- 数据库迁移失败

---

### 10.3 健康检查

在浏览器中访问：

```text
http://你的群晖IP:5001/health
```

如果能返回正常结果，说明 API 已可用。

---

## 十一、客户端如何连接群晖后端

如果客户端要连接群晖上的服务，请修改客户端打包前环境变量：

```env
VITE_SERVER_BASE_URL=http://你的群晖IP:5001
VITE_API_HEALTH_PATH=/health
VITE_API_LOGIN_PATH=/api/auth/login
VITE_API_ME_PATH=/api/auth/me
VITE_APP_NAME=Movtools Client
```

注意：

- 不要填写 `localhost`
- 要填写群晖实际可访问地址
- 如果用了域名和 HTTPS，就改成正式域名地址

---

## 十二、后续如何更新群晖中的服务

如果你已经配置了 GitHub Actions 自动构建镜像，则后续更新非常简单。

流程如下：

1. 修改后端代码
2. 推送到 GitHub `main`
3. GitHub 自动构建并推送新镜像到 `ghcr.io`
4. 回到群晖重新拉取镜像并重建项目

在群晖中通常有两种方式：

- 重新部署项目
- 停止后重新拉取最新镜像并启动

核心目标是让 `movtools-api` 使用新镜像重新创建。

---

## 十三、外网访问建议

如果后续需要让外网测试用户访问群晖后端，不建议直接裸露 `5001` 端口到公网。

更推荐的做法：

- 使用群晖反向代理
- 配置域名
- 启用 HTTPS
- 通过 `443` 对外服务

原因：

- 更安全
- 更适合登录与 Token 传输
- 更方便未来扩展

如果未来启用 HTTPS：

- 客户端中的 `VITE_SERVER_BASE_URL` 也要改成 `https://你的域名`
- SignalR 会自动切换到 `wss://`

---

## 十四、重要安全建议

部署到群晖后，请尽量遵守以下原则：

- 不要将数据库端口 `5432` 直接暴露到公网
- JWT 密钥必须足够长且随机
- 数据库密码不要使用简单口令
- 使用持久化卷保存数据库数据
- 定期备份 PostgreSQL 数据目录
- 尽量使用 HTTPS 对外提供服务

---

## 十五、常见问题排查

### 15.1 容器启动失败

优先检查：

- Compose 配置是否写错
- 环境变量是否填写完整
- 卷映射路径是否存在
- GHCR 镜像是否能拉取成功

---

### 15.2 拉取 GHCR 镜像失败

常见原因：

- 镜像是私有的，但未登录
- GitHub Token 权限不足
- 镜像名填写错误

应检查：

- 镜像地址是否为 `ghcr.io/用户名/movtools-server:latest`
- 群晖中的 Registry 凭据是否正确

---

### 15.3 后端能启动但客户端连不上

常见原因：

- 客户端仍使用旧地址
- 群晖 IP 变了
- 端口 `5001` 未开放
- 防火墙或路由规则阻挡

优先验证：

```text
http://你的群晖IP:5001/health
```

---

### 15.4 数据丢失

常见原因：

- PostgreSQL 未使用持久化卷
- 重建容器时未保留数据目录

必须确认：

- `/var/lib/postgresql/data` 已映射到群晖持久路径

---

## 十六、推荐迁移顺序

如果你当前已经在 Windows 上完成部署，建议按以下顺序迁移到群晖：

1. 先保持 GitHub 镜像自动构建流程稳定
2. 在群晖创建持久化目录
3. 在群晖用 compose 建立 `api + postgres`
4. 测试 `health` 接口
5. 再修改客户端连接地址到群晖
6. 小范围试运行一段时间
7. 确认稳定后再完全替代 Windows 部署

---

## 十七、结论

对你当前项目来说，群晖最合适的部署方式是：

- GitHub Actions 构建镜像
- `ghcr.io` 存储镜像
- 群晖 `Container Manager` 通过 Compose 运行后端
- Electron 客户端继续本地打包并发放

这样可以保证：

- Windows 和群晖的部署逻辑统一
- 后端更新方式统一
- 公测与正式迁移成本较低

如果后续需要，可以继续补充以下文档：

- 群晖反向代理与 HTTPS 配置手册
- PostgreSQL 数据备份与恢复手册
- GitHub Releases 客户端发版手册
