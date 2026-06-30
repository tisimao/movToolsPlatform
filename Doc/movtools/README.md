# Movtools 群晖部署包

把整个 `movtools` 文件夹复制到群晖 NAS 的 `docker` 共享目录下，最终路径应为：

```text
/volume1/docker/movtools/
├─ docker-compose.yml
├─ .env
├─ .env.example
└─ postgres-data/
```

## 部署前需要确认

- `docker-compose.yml` 中的镜像地址是 `ghcr.io/tisimao/movtools-server:latest`。
- 如果 GHCR 镜像是私有的，需要先在群晖 Container Manager 中登录 `ghcr.io`。
- 把 `.env` 里的 `MOVTOOLS_SERVER_BASE_URL` 改成 NAS 的局域网地址，例如 `http://192.168.1.99:5001`。
- `.env` 已生成一组本地部署值；如果这是正式环境，建议在部署前再换成你自己的强密码和长随机 JWT 密钥。
- 远程仓库只保存 `.env.example`，不会保存包含真实密钥的 `.env`。
- `postgres-data` 目录首次部署前应保持为空，PostgreSQL 会自动初始化数据库文件。

## Container Manager 创建项目

1. 打开群晖 `Container Manager`。
2. 进入 `项目` / `Project`。
3. 新增项目，项目名称建议使用 `movtools`。
4. 项目路径选择 `/volume1/docker/movtools`。
5. Compose 文件选择 `/volume1/docker/movtools/docker-compose.yml`。
6. 部署完成后访问 `http://你的群晖IP:5001/health` 验证服务。
