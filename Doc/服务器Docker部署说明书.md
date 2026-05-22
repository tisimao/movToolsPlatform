# Movtools Server Docker 部署说明书

本文档面向第一次接触服务器部署的使用者，目标是把 `movtools-server` 部署到：

- Windows 备用机器
- 群辉 NAS 的 Container Manager

并用于你当前阶段的局域网多设备登录测试。

## 1. 先说结论

当前项目最适合你的部署方式是：

- 用 Docker 启动 `API 服务`
- 用 Docker 同时启动 `PostgreSQL 数据库`
- 客户端把服务器地址改成 `http://服务器IP:5001`

这样做的好处是：

- 不依赖 Visual Studio
- 备用机器和 NAS 的部署方式接近
- 数据库和服务一起带走，环境更稳定
- 后续迁移到群辉 NAS 更容易

## 2. 当前项目需要注意的两个关键点

这两个点很重要，请先理解：

### 2.1 服务器不是单独一个程序，它依赖数据库

你的服务端在启动时会自动执行数据库迁移和初始化数据，所以必须同时有 PostgreSQL 数据库可用。

也就是说，不能只把 API 单独跑起来，数据库也必须一起运行。

### 2.2 你当前阶段建议继续用 `Development` 环境部署

从代码现状看，客户端打包后是 Electron 本地应用，而服务端当前的 CORS 放行策略在 `Development` 环境下更适合你现在的局域网测试。

所以：

- 当前这次联机测试，建议使用 `ASPNETCORE_ENVIRONMENT=Development`
- 等你后面要做正式生产部署，再单独收紧 CORS 和切换 `Production`

这不是长期最终方案，但很适合你现在这个里程碑测试阶段。

## 3. 本文采用的部署方案

为了避免你直接使用仓库里现有的 `docker-compose.yml` 时踩配置坑，本文提供一份更适合你当前代码结构的 Compose 配置。

原因是当前代码读取数据库配置的核心项是：

- `Database__ConnectionString`

所以本文会直接给你一份可用的 `docker-compose.yml` 模板。

## 4. 部署前你要准备什么

无论是 Windows 还是群辉 NAS，请先准备：

- `movtools-server` 整个文件夹
- 一个局域网固定地址或至少容易找到的服务器 IP
- 一个数据库密码
- 一个 JWT 密钥，长度至少 32 个字符

建议你自己先准备两个值：

- `DB_PASSWORD`：例如 `MovtoolsDb_2026_Test!`
- `JWT_SIGNING_KEY`：例如 `MovtoolsJwtKey_ForLanTesting_2026_ReallyLong`

不要继续使用文档示例里的默认弱密码。

## 5. 建议的目录结构

建议在部署机器上使用这样的目录结构：

```text
movtools-server/
├─ docker-compose.yml
├─ .env
├─ src/
├─ tests/
└─ postgres-data/
```

说明：

- `src/` 和其他源码目录必须保留，因为 Docker 需要根据源码构建镜像
- `postgres-data/` 用来持久化数据库
- `.env` 用来存放密码和密钥

## 6. 你需要使用的 `docker-compose.yml`

请把部署目录中的 `docker-compose.yml` 改成下面这份内容。

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: src/Movtools.Server.Api/Dockerfile
    container_name: movtools-api
    ports:
      - "5001:8080"
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - ASPNETCORE_URLS=http://+:8080
      - Database__ConnectionString=Host=postgres;Port=5432;Database=movtools_server;Username=postgres;Password=${DB_PASSWORD}
      - Jwt__Issuer=Movtools.Server.Development
      - Jwt__Audience=Movtools.Client.Development
      - Jwt__SigningKey=${JWT_SIGNING_KEY}
      - Server__AllowedOrigins__0=http://localhost:3000
      - Server__AllowedOrigins__1=http://localhost:5173
      - Server__AllowedOrigins__2=http://127.0.0.1:3000
      - Server__AllowedOrigins__3=http://127.0.0.1:5173
      - Observability__MinimumLevel=Information
      - Observability__IncludeScopes=true
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    container_name: movtools-postgres
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=movtools_server
    volumes:
      - ./postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d movtools_server"]
      interval: 10s
      timeout: 5s
      retries: 10
    restart: unless-stopped
```

这份配置做了几件事：

- 对外暴露 `5001` 端口，和你当前客户端默认地址一致
- 服务端和 PostgreSQL 一起启动
- 用 `Development` 环境适配你当前局域网测试
- 数据库存到 `postgres-data` 文件夹，重启机器后数据不会丢

## 7. 你需要使用的 `.env`

在 `docker-compose.yml` 同目录创建一个 `.env` 文件，内容如下：

```env
DB_PASSWORD=MovtoolsDb_2026_Test!
JWT_SIGNING_KEY=MovtoolsJwtKey_ForLanTesting_2026_ReallyLong
```

要求：

- `JWT_SIGNING_KEY` 至少 32 个字符
- 不要在末尾多加空格
- `.env` 文件和 `docker-compose.yml` 必须放在同一层目录

如果你不想手动新建，也可以直接复制项目里的示例文件：

- 示例文件：`movtools-server/.env.example`
- 复制后改名为：`movtools-server/.env`

Windows 下可以这样操作：

```powershell
Copy-Item .env.example .env
```

然后再用文本编辑器打开 `.env`，把里面的示例值替换成你自己的真实值。

## 8. Windows 机器部署步骤

下面按“从零开始”的方式写。

### 8.1 安装 Docker Desktop

1. 打开 Docker 官网下载安装 Docker Desktop
2. 安装过程中如果提示启用 `WSL 2`，按提示安装
3. 安装完成后重启电脑
4. 启动 Docker Desktop，等它显示运行正常

你第一次安装时，可能还会看到以下提示：

- 开启虚拟化
- 安装 WSL
- Windows 子系统相关组件缺失

如果 Docker Desktop 没有正常启动，先不要继续后面的部署步骤。

### 8.2 验证 Docker 是否安装成功

打开 PowerShell，执行：

```powershell
docker --version
docker compose version
```

如果都能正常输出版本号，说明 Docker 可以用了。

### 8.3 准备部署文件夹

例如你可以把项目放到：

```text
D:\deploy\movtools-server
```

把你当前仓库里的整个 `movtools-server` 文件夹复制过去。

然后确认这个目录里至少能看到：

- `docker-compose.yml`
- `.env`
- `src`

如果没有 `postgres-data` 文件夹，也没关系，第一次启动时会自动生成。

### 8.4 修改 `docker-compose.yml`

用记事本、VS Code 或任何文本编辑器打开 `docker-compose.yml`，替换成本文第 6 节提供的内容。

### 8.5 创建 `.env`

在同一目录创建 `.env`，填写本文第 7 节的内容。

### 8.6 首次启动容器

打开 PowerShell，进入部署目录，例如：

```powershell
cd D:\deploy\movtools-server
docker compose up -d --build
```

说明：

- `--build` 表示根据当前源码重新构建服务镜像
- 第一次启动会比较慢，因为要下载 .NET 和 PostgreSQL 镜像

### 8.7 查看容器是否启动成功

执行：

```powershell
docker compose ps
```

正常情况下你应该能看到两个服务：

- `movtools-api`
- `movtools-postgres`

如果 `State` 或 `Status` 是 `running`，说明基本启动成功。

### 8.8 查看日志

如果你想确认启动有没有报错，执行：

```powershell
docker compose logs -f api
```

如果想看数据库日志：

```powershell
docker compose logs -f postgres
```

退出日志查看可以按：

```text
Ctrl + C
```

### 8.9 放行 Windows 防火墙端口

这一步非常重要，否则别的设备可能访问不到你的服务器。

你至少要允许：

- TCP `5001`

操作思路：

1. 打开“Windows Defender 防火墙（高级安全）”
2. 进入“入站规则”
3. 新建规则
4. 选择“端口”
5. 选择 `TCP`
6. 指定端口填写 `5001`
7. 选择“允许连接”
8. 配置文件建议三个都勾上：域、专用、公用
9. 名称可写：`Movtools Server 5001`

### 8.10 找到服务器 IP

在 PowerShell 执行：

```powershell
ipconfig
```

找到你当前网卡的 IPv4 地址，例如：

```text
192.168.1.88
```

那么你的服务端地址就是：

```text
http://192.168.1.88:5001
```

### 8.11 验证服务器是否可访问

先在服务器本机浏览器里打开：

```text
http://localhost:5001/health
```

再在同一局域网其他设备浏览器里打开：

```text
http://服务器IP:5001/health
```

例如：

```text
http://192.168.1.88:5001/health
```

如果能返回健康检查结果，说明 API 已经通了。

### 8.12 用 PowerShell 测试登录接口

你可以在服务器机器上执行：

```powershell
Invoke-RestMethod -Uri "http://localhost:5001/api/auth/login" -Method Post -ContentType "application/json" -Body '{"username":"admin","password":"admin123"}'
```

如果登录成功，通常会返回带 token 的 JSON。

如果失败，先看：

- `docker compose logs -f api`
- `docker compose logs -f postgres`

### 8.13 客户端如何连接

你已经打包好了客户端，接下来只要把客户端中的服务器地址改成：

```text
http://服务器IP:5001
```

例如：

```text
http://192.168.1.88:5001
```

注意：

- 不要填 `localhost`
- 不要填 `127.0.0.1`
- 因为客户端运行在其他设备上时，这两个地址只会指向客户端自己的机器

## 9. Windows 下常用运维命令

### 启动服务

```powershell
docker compose up -d
```

### 重新构建并启动

```powershell
docker compose up -d --build
```

### 查看状态

```powershell
docker compose ps
```

### 查看 API 日志

```powershell
docker compose logs -f api
```

### 查看数据库日志

```powershell
docker compose logs -f postgres
```

### 停止服务

```powershell
docker compose down
```

### 停止服务并删除数据库数据

```powershell
docker compose down -v
```

警告：这条命令会清空数据库卷。只有在你明确知道自己要重置数据时才使用。

## 10. 群辉 NAS 部署思路

群辉 NAS 上推荐使用：

- `Container Manager`
- 通过“项目 / Project”方式导入 Compose

这样和 Windows 的部署逻辑基本一致。

## 11. 群辉 NAS 部署前准备

请先确认：

- 你的群辉已经安装 `Container Manager`
- NAS 剩余空间足够
- NAS 能联网下载镜像
- 你准备好了完整的 `movtools-server` 目录

建议在群辉里创建一个共享文件夹，例如：

```text
/volume1/docker/movtools-server
```

然后把整个 `movtools-server` 文件夹内容上传进去。

最终建议目录类似：

```text
/volume1/docker/movtools-server/
├─ docker-compose.yml
├─ .env
├─ src/
├─ tests/
└─ postgres-data/
```

## 12. 群辉 NAS 用 Container Manager 部署的详细步骤

### 12.1 安装 Container Manager

1. 登录 DSM
2. 打开“套件中心”
3. 搜索 `Container Manager`
4. 点击安装

安装完成后，左侧菜单会出现 Container Manager。

### 12.2 创建部署目录

1. 打开“File Station”
2. 进入你准备的共享目录，例如 `docker`
3. 新建文件夹：`movtools-server`
4. 把 `movtools-server` 项目文件上传进去

### 12.3 修改 `docker-compose.yml`

把上传后的 `docker-compose.yml` 内容改成本文第 6 节那份。

### 12.4 创建 `.env`

在同目录创建 `.env`，内容使用本文第 7 节模板。

### 12.5 创建项目

1. 打开 `Container Manager`
2. 进入“项目”或 “Project”
3. 点击“新增”或“Create”
4. 选择“从 docker-compose.yml 创建”
5. 选择你的目录：`/volume1/docker/movtools-server`
6. 选中 `docker-compose.yml`
7. 项目名称填写：`movtools-server`
8. 确认创建

如果 DSM 版本界面有细微差异，核心思路不变：

- 选择项目目录
- 选择 Compose 文件
- 让 Container Manager 按这个 Compose 启动

### 12.6 等待镜像构建和容器启动

第一次部署时，群辉会：

- 下载 PostgreSQL 镜像
- 下载 .NET 基础镜像
- 构建你的 API 镜像

这一步可能需要几分钟，取决于 NAS 性能和网络情况。

### 12.7 查看容器状态

创建完成后，在 Container Manager 中查看：

- `movtools-api`
- `movtools-postgres`

如果都显示“运行中”，说明启动成功。

### 12.8 查看日志

如果启动失败：

1. 打开 `movtools-api`
2. 查看日志
3. 再打开 `movtools-postgres`
4. 查看日志

重点看有没有以下报错：

- 数据库连接失败
- 端口被占用
- `.env` 未读取
- `JWT_SIGNING_KEY` 长度不够

### 12.9 打开 NAS 防火墙端口

如果你启用了 DSM 防火墙，请放行：

- TCP `5001`

操作思路：

1. DSM 控制面板
2. 安全性
3. 防火墙
4. 新建规则
5. 允许 `5001` 端口

### 12.10 获取 NAS 的局域网 IP

例如你的 NAS 地址是：

```text
192.168.1.99
```

那么客户端服务器地址就是：

```text
http://192.168.1.99:5001
```

### 12.11 浏览器验证

先在浏览器打开：

```text
http://NAS-IP:5001/health
```

例如：

```text
http://192.168.1.99:5001/health
```

如果可以打开，说明 NAS 部署基本完成。

## 13. 多设备联调推荐流程

建议你按下面顺序测试：

1. 在服务器本机访问 `/health`
2. 在同局域网另一台电脑访问 `/health`
3. 用 PowerShell 或 Postman 测试登录接口
4. 打开一个客户端，测试登录
5. 再打开第二个、第三个客户端继续测试
6. 最后再测试实时同步和 SignalR 相关功能

推荐测试地址：

- 健康检查：`http://服务器IP:5001/health`
- 登录接口：`http://服务器IP:5001/api/auth/login`
- SignalR：`http://服务器IP:5001/hubs/movtools`

## 14. 常见问题排查

### 14.1 浏览器打不开 `/health`

常见原因：

- Docker 没启动
- 容器没成功运行
- 5001 端口没映射成功
- Windows 或 DSM 防火墙没放行
- 访问的 IP 不对

排查顺序：

1. 先看 `docker compose ps`
2. 再看 `docker compose logs -f api`
3. 确认 `http://localhost:5001/health` 本机能打开
4. 再从其他设备访问 `http://服务器IP:5001/health`

### 14.2 API 启动了，但登录失败

常见原因：

- 数据库没准备好
- 数据库密码和连接字符串不一致
- 首次迁移失败

重点检查：

- `DB_PASSWORD`
- `Database__ConnectionString`
- `movtools-postgres` 容器日志

### 14.3 客户端提示无法连接服务器

常见原因：

- 客户端仍然连的是 `localhost`
- 客户端填错了服务器 IP
- 服务器防火墙没放行 5001
- API 容器没正常运行

### 14.4 容器一直重启

常见原因：

- `.env` 文件值错误
- JWT 密钥太短
- 数据库连接失败
- Compose 内容没按本文修改

### 14.5 我想重置数据库

Windows 下可以执行：

```powershell
docker compose down -v
docker compose up -d --build
```

这会删除旧数据并重新初始化。

注意：数据库中的已有内容会被清空。

## 15. 当前阶段的推荐做法

对你现在的里程碑来说，我建议这样执行：

1. 先在 Windows 备用机器上按本文完成部署
2. 用 `http://服务器IP:5001/health` 验证
3. 用打包后的客户端逐台连接测试
4. 确认功能稳定后，再把同一套 Compose 迁移到群辉 NAS

这样风险最低，也最容易排查问题。

## 16. 后续正式部署时你还需要做的事

等你后面从“测试服”升级到“长期运行的正式服务”时，建议再做这些改造：

- 把服务端 CORS 策略从“测试友好”改成“正式白名单”
- 切换到 `ASPNETCORE_ENVIRONMENT=Production`
- 使用更规范的备份策略保存 PostgreSQL 数据
- 给 NAS 或服务器设置固定 IP
- 如需外网访问，再单独配置路由器端口映射、HTTPS 和域名

## 17. 默认测试账号

根据当前项目文档，首次运行会自动创建默认管理员账号：

- 用户名：`admin`
- 密码：`admin123`

如果你后续修改过种子逻辑或数据库内容，请以实际数据库为准。

## 18. 一句话版操作清单

如果你已经理解上面的内容，真正执行时可以只记住这几步：

1. 复制整个 `movtools-server` 到部署机器
2. 把 `docker-compose.yml` 改成本文提供的版本
3. 创建 `.env`
4. 执行 `docker compose up -d --build`
5. 打开防火墙 `5001`
6. 用 `http://服务器IP:5001/health` 测试
7. 客户端服务器地址改成 `http://服务器IP:5001`

---

如果你后面愿意，我下一步可以继续帮你补两份东西：

1. 一份“适合直接复制使用”的 NAS 专用 `docker-compose.yml`
2. 一份“Windows 和 NAS 部署检查清单”
