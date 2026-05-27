# GitHub 快速部署与 Windows / 群晖发布手册

## 一、文档目标

本文档用于指导当前 `MovtoolsEx` 项目完成一套适合小范围公测的发布流程，覆盖以下目标：

- 使用 GitHub Actions 自动构建后端 Docker 镜像
- 使用 GitHub Container Registry（`ghcr.io`）保存镜像
- 在 Windows 机器上通过 Docker 部署后端服务
- 本地打包 Electron 客户端并分发给测试用户
- 为后续迁移到群晖 `Container Manager` 做准备

当前项目形态说明：

- 后端：`movtools-server`，ASP.NET Core Web API + PostgreSQL
- 客户端：`movtools-client`，Electron + React 桌面应用

需要特别注意：

- Docker 主要用于部署后端服务
- Electron 客户端不能像普通网页一样直接在线部署，仍然需要打包为安装包给用户安装

---

## 二、推荐发布架构

推荐采用以下方式进行公测：

1. GitHub 仓库存放源码
2. GitHub Actions 自动构建后端镜像
3. GitHub Container Registry 存放后端镜像
4. Windows 机器使用 Docker 拉取镜像并运行 `api + postgres`
5. Electron 客户端本地打包为 `.exe` 后分发给测试人员
6. 后续群晖继续复用同一后端镜像进行部署

整体结构如下：

- GitHub：源码、自动构建、镜像仓库、Release
- Windows：后端部署机
- 测试用户：安装桌面客户端并连接部署后的后端
- 群晖：未来替代 Windows 作为后端运行环境

---

## 三、项目内已有基础

当前仓库中已经具备以下基础文件：

- 后端 Dockerfile：`movtools-server/src/Movtools.Server.Api/Dockerfile`
- 后端 Docker Compose：`movtools-server/docker-compose.yml`
- 客户端打包脚本：`movtools-client/package.json`
- 服务端启动时自动迁移数据库：`movtools-server/src/Movtools.Server.Api/Program.cs:55`

说明：

- 现有 `movtools-server/docker-compose.yml` 更偏开发环境
- 公测或正式环境建议单独准备新的部署文件，不直接原样使用开发版 compose

---

## 四、部署总流程

推荐按以下顺序完成部署：

1. 在 GitHub 中添加后端镜像自动构建工作流
2. 推送代码到 GitHub，自动生成后端 Docker 镜像
3. 在 Windows 机器安装 Docker Desktop
4. 在 Windows 机器上编写部署用 `.env` 和 `docker-compose.yml`
5. 拉取后端镜像并启动服务
6. 配置客户端连接到 Windows 部署的服务地址
7. 在本地打包 Electron 安装包
8. 分发给测试用户进行公测
9. 后续将同一套镜像迁移到群晖 Container Manager

---

## 五、第一部分：使用 GitHub 自动构建后端镜像

### 5.1 准备条件

请先确认：

- 代码仓库已经上传到 GitHub
- 你对该仓库有管理员权限
- GitHub 账号可使用 Packages 功能
- 你使用的发布分支为 `main`

---

### 5.2 新建 GitHub Actions 工作流文件

在仓库根目录新建文件：

- `.github/workflows/server-image.yml`

文件内容如下：

```yaml
name: Build and Publish Server Image

on:
  push:
    branches:
      - main
    paths:
      - 'movtools-server/**'
      - '.github/workflows/server-image.yml'
  workflow_dispatch:

env:
  IMAGE_NAME: ghcr.io/${{ github.repository_owner }}/movtools-server

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout source
        uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest
            type=sha

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: ./movtools-server
          file: ./movtools-server/src/Movtools.Server.Api/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

此工作流作用：

- 当你向 `main` 推送后端相关代码时自动触发
- 自动构建 `movtools-server` 镜像
- 自动推送到 `ghcr.io`

生成的镜像通常类似：

- `ghcr.io/你的GitHub用户名/movtools-server:latest`
- `ghcr.io/你的GitHub用户名/movtools-server:sha-xxxxxxx`

---

### 5.3 提交工作流文件到 GitHub

在本地仓库执行：

```bash
git add .github/workflows/server-image.yml
git commit -m "add server image publish workflow"
git push origin main
```

---

### 5.4 查看 GitHub Actions 是否成功

进入 GitHub 仓库页面：

1. 点击 `Actions`
2. 找到 `Build and Publish Server Image`
3. 确认工作流执行成功

成功后可在 GitHub 个人主页或组织主页的 `Packages` 中看到镜像包。

---

### 5.5 私有镜像说明

如果仓库或镜像是私有的，后续 Windows 或群晖拉取镜像时通常需要登录 GitHub Container Registry。

如果只是自己部署，私有镜像是可以接受的。

---

## 六、第二部分：Windows 小范围部署后端服务

### 6.1 准备 Windows 环境

在 Windows 机器上安装：

- Docker Desktop
- WSL2

安装完成后，在 PowerShell 中验证：

```powershell
docker --version
docker compose version
```

如果都能输出版本号，说明环境正常。

---

### 6.2 创建部署目录

建议新建一个独立目录用于部署：

```powershell
mkdir D:\movtools-deploy
```

后续部署文件都放在这里。

---

### 6.3 创建 `.env` 文件

在 `D:\movtools-deploy\.env` 中写入：

```env
DB_PASSWORD=请替换成强密码
JWT_SIGNING_KEY=请替换成长随机字符串至少32位
```

要求：

- `DB_PASSWORD` 使用强密码
- `JWT_SIGNING_KEY` 至少 32 位，越长越好
- 此文件不要上传到 GitHub

---

### 6.4 创建 Windows 部署用 `docker-compose.yml`

在 `D:\movtools-deploy\docker-compose.yml` 中写入：

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

需要自行替换两项：

- `你的GitHub用户名`
- `你的Windows机器IP`

例如你的局域网地址是 `192.168.1.20`，则可写成：

- `http://192.168.1.20:5001`

---

### 6.5 如果镜像为私有，先登录 GHCR

如果你的 `ghcr.io` 镜像是私有的，请先在 GitHub 创建 Personal Access Token（PAT）。

建议至少具备权限：

- `read:packages`

然后在 PowerShell 执行：

```powershell
docker login ghcr.io -u 你的GitHub用户名
```

输入 GitHub Token 后即可完成登录。

---

### 6.6 启动后端服务

进入部署目录：

```powershell
cd D:\movtools-deploy
docker compose up -d
```

首次启动时会：

- 拉取 `movtools-server` 镜像
- 拉取 `postgres:16-alpine`
- 启动 PostgreSQL
- 启动 API 容器
- 自动执行数据库迁移

---

### 6.7 检查容器状态

查看容器运行情况：

```powershell
docker compose ps
```

查看 API 日志：

```powershell
docker compose logs -f api
```

---

### 6.8 验证后端接口

浏览器打开：

```text
http://localhost:5001/health
```

或者在局域网内使用本机 IP 测试：

```text
http://你的Windows机器IP:5001/health
```

如果能正常返回健康检查结果，则说明后端已部署成功。

---

### 6.9 获取 Windows 局域网地址

在 PowerShell 执行：

```powershell
ipconfig
```

找到本机 IPv4 地址，例如：

- `192.168.1.20`

则局域网内其他测试机器访问地址可使用：

- `http://192.168.1.20:5001`

---

### 6.10 放行 Windows 防火墙端口

如果其他设备无法访问你的服务，需要检查 Windows 防火墙是否已放行 `5001` 端口。

建议：

- 将 `5001` 端口加入入站允许规则
- 优先在家庭/专用网络环境中测试

---

## 七、第三部分：客户端连接部署后的后端

### 7.1 当前客户端配置位置

客户端运行时配置读取位置：

- `movtools-client/src/config/runtime.ts`

客户端环境变量示例文件：

- `movtools-client/.env.example`

---

### 7.2 修改客户端环境变量

在 `movtools-client/.env.local` 中写入公测环境配置：

```env
VITE_SERVER_BASE_URL=http://192.168.1.20:5001
VITE_API_HEALTH_PATH=/health
VITE_API_LOGIN_PATH=/api/auth/login
VITE_API_ME_PATH=/api/auth/me
VITE_APP_NAME=Movtools Client
```

请根据你的实际部署地址替换：

- `http://192.168.1.20:5001`

注意：

- 不要再使用 `localhost`，否则测试用户的客户端会连到他们自己的电脑
- 如果未来启用了 HTTPS，这里也要改成 `https://...`
- SignalR 地址会基于服务端地址自动推导为 `ws://` 或 `wss://`

---

## 八、第四部分：打包 Windows 客户端

### 8.1 打包前准备

确认你已安装 Node.js 和 npm，并且客户端配置已指向正确的服务端地址。

---

### 8.2 执行打包命令

进入客户端目录后执行：

```powershell
cd D:\project\MovtoolsEx\movtools-client
npm install
npm run dist
```

根据当前项目脚本，`npm run dist` 会执行 Windows 安装包构建。

---

### 8.3 查找打包产物

打包结果通常位于：

- `movtools-client/release`

你会得到类似以下文件：

- `萌粒制片管理系统-Setup-x.x.x.exe`

将该安装包发给测试用户即可。

---

## 九、第五部分：使用 GitHub Releases 分发客户端安装包

推荐将客户端安装包放到 GitHub Releases 中进行版本分发。

操作步骤：

1. 打开 GitHub 仓库页面
2. 点击 `Releases`
3. 点击 `Draft a new release`
4. 填写版本号，例如 `v1.3.11-beta.1`
5. 上传刚打包好的 `.exe` 文件
6. 填写更新说明
7. 点击发布

推荐版本命名：

- `v1.3.11-beta.1`
- `v1.3.11-beta.2`
- `v1.3.11-beta.3`

这样便于回溯测试问题和版本差异。

---

## 十、第六部分：后端后续更新流程

当后端代码有更新时，可按下面步骤发布新版本：

1. 本地修改后端代码
2. 推送到 GitHub `main`
3. GitHub Actions 自动重新构建并发布镜像
4. 在 Windows 机器拉取新镜像并更新容器

Windows 更新命令：

```powershell
cd D:\movtools-deploy
docker compose pull
docker compose up -d
```

说明：

- `pull` 拉取最新镜像
- `up -d` 用新镜像重建并重启容器

---

## 十一、第七部分：未来迁移到群晖 Container Manager

未来迁移到群晖时，发布模式基本不需要改变，只是部署位置从 Windows 切换为群晖。

### 11.1 可复用的部分

以下内容基本可以直接复用：

- GitHub Actions 自动构建镜像
- `ghcr.io` 镜像地址
- 数据库环境变量
- JWT 环境变量
- 端口映射思路
- PostgreSQL 数据持久化思路

---

### 11.2 群晖侧的主要配置项

在群晖 `Container Manager` 中，你主要需要配置：

- 镜像地址：`ghcr.io/你的GitHub用户名/movtools-server:latest`
- 环境变量
- 端口映射
- 数据卷映射
- 重启策略

如果镜像是私有的，还需要在群晖中配置 GitHub Container Registry 登录信息。

---

### 11.3 群晖部署建议

建议在群晖中：

- 为 PostgreSQL 数据单独映射持久化目录
- 不将数据库端口直接暴露到公网
- 若需要外网访问，使用反向代理和 HTTPS
- 将业务容器和数据容器区分清楚

---

## 十二、建议的公测发布顺序

推荐你按如下顺序进行第一次小范围公测：

1. 配置 GitHub Actions 自动构建后端镜像
2. 在 Windows 上通过 Docker 成功启动后端
3. 浏览器确认 `http://你的IP:5001/health` 可访问
4. 修改客户端 `.env.local` 指向该服务地址
5. 本地打包 `.exe` 安装包
6. 发给 2 至 5 名测试用户试跑
7. 修复问题后再扩大测试范围
8. 稳定后迁移到群晖部署

---

## 十三、常见问题与排查建议

### 13.1 无法拉取 GHCR 镜像

可能原因：

- 镜像是私有的
- 未执行 `docker login ghcr.io`
- GitHub Token 权限不足

排查方向：

- 检查镜像包是否已成功发布
- 检查账号是否有 `read:packages` 权限

---

### 13.2 服务启动失败

常见原因：

- `JWT_SIGNING_KEY` 太短
- 数据库密码为空或不一致
- 容器环境变量填写错误

排查命令：

```powershell
docker compose logs -f api
docker compose logs -f postgres
```

---

### 13.3 客户端连接不上后端

常见原因：

- 客户端仍配置为 `localhost`
- Windows 防火墙未放行端口
- 服务器 IP 填写错误
- 后端未正常启动

优先检查：

- `movtools-client/.env.local`
- `http://你的IP:5001/health` 是否可访问

---

### 13.4 局域网其他设备无法访问

常见原因：

- 不在同一局域网
- 路由器启用了客户端隔离
- Windows 防火墙阻断
- 端口未监听成功

建议先在部署机本机验证 `localhost:5001`，再验证局域网 IP 地址。

---

## 十四、最终结论

当前阶段最适合你的发布方案是：

- GitHub Actions 负责自动构建后端 Docker 镜像
- Windows 机器负责小范围公测部署
- Electron 客户端本地打包为安装包并发放
- 后续迁移到群晖时继续复用同一镜像与配置思路

这套方案有几个优点：

- 部署速度快
- 后端更新流程清晰
- Windows 和群晖两边都能复用
- 适合当前小范围公测阶段逐步迭代

---

## 十五、建议下一步行动

建议你接下来按顺序完成这三件事：

1. 在仓库中加入 `.github/workflows/server-image.yml`
2. 在 Windows 上建立 `D:\movtools-deploy` 并完成后端部署
3. 修改 `movtools-client/.env.local` 后打包第一版测试安装包

如果后续需要，还可以继续补充两份文档：

- 群晖 `Container Manager` 专用部署手册
- GitHub Release 客户端发版规范手册
