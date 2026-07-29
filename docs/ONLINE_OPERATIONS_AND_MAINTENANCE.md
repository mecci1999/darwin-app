# Darwin App 线上运营与维护文档

本文档覆盖 Darwin App 当前阶段在腾讯云 CVM 上的部署、日常维护、备份、升级、回滚，以及后续新增博客和摄影作品集微服务的发布方式。

本文档是对旧部署文档的完整替换。所有命令都按照当前仓库实际情况编写；生产 Dockerfile、生产启动脚本和拆分 Compose 文件均已实现，但部署前仍必须完成本机构建、镜像构建和配置校验。

---

## 0. 你的腾讯云服务器规格与部署结论

当前服务器：

| 项目 | 配置 | 影响 |
| --- | --- | --- |
| 实例 | 通用型 | 适合早期单机部署，不适合高并发和高可靠生产集群 |
| CPU | 2 核 | 不建议多副本；编译和 Elasticsearch 启动时会有明显资源竞争 |
| 内存 | 4 GB | 必须限制 JVM、Kafka 和应用内存，并配置 Swap |
| 系统盘 | SSD 云硬盘 100 GB | 数据、镜像、日志和备份共用，必须设置磁盘告警和保留策略 |
| 流量包 | 1000 GB/月 | 应用接口通常足够，图片、视频和大文件不应长期走本机带宽 |
| 带宽 | 7 Mbps | 约 0.875 MB/s，摄影图片和视频建议使用腾讯云 COS + CDN |

### 0.1 推荐的当前路线

第一阶段采用：

```text
腾讯云 CVM
  ├── Nginx：公网 80/443
  ├── Gateway：双网络；仅绑定宿主机 127.0.0.1:6670/8090
  ├── Node 微服务：Docker 内网
  └── 基础设施：Docker 内网
       ├── MySQL
       ├── Redis
       ├── Kafka + Zookeeper
       ├── InfluxDB
       └── Elasticsearch
```

仓库现在提供了以下生产部署契约：

1. `pnpm build:all` 编译所有微服务入口，且每个服务都有非 `nodemon` 的 `start:*:prod` 脚本。
2. 根目录 `Dockerfile` 使用 pnpm 锁文件进行多阶段构建；不会把环境文件复制进镜像。
3. `docker/docker-compose.infra.yml` 和 `docker/docker-compose.app.yml` 分离基础设施和应用；旧 `docker/docker-compose.yml` 保持为开发基础设施配置。
4. `.env.production.example` 是安全模板；实际 `.env.production` 必须只保存在受保护的服务器路径，填入独立生成的密钥后设置为 `600`。
5. 生产 Compose 只发布 Gateway 的 `127.0.0.1:6670` 和 WebSocket 的 `127.0.0.1:8090`。Gateway 同时加入内部 `darwin_app_network` 和仅它使用的普通 bridge `darwin_gateway_ingress`，使 Docker 能建立回环端口转发；所有其他应用和数据服务只加入内部网络。

这仍是单机 Compose 部署方案，不等同于高可用集群。必须先验证镜像、基础设施健康状态和应用的关键业务路径，再接入 Nginx 公网流量。

---

## 1. 上线前必须完成的仓库改造

在腾讯云执行部署前，必须先在本地代码仓库完成并验证以下内容。

### 1.1 统一包管理器

当前仓库存在 `pnpm-lock.yaml`，同时旧 Dockerfile 引用 `yarn.lock`。必须统一使用 pnpm：

```bash
corepack enable
pnpm install --frozen-lockfile
```

不要在同一生产镜像中混用 Yarn 和 pnpm。

### 1.2 增加生产启动脚本

保留开发脚本，例如：

```json
"start:gateway": "cross-env NODE_ENV=development nodemon ./src/core/gateway/index.ts"
```

每个实际服务都已提供不使用 `nodemon` 的生产脚本，脚本路径与 `build:all` 产物一致：

```json
{
  "start:gateway:prod": "cross-env NODE_ENV=production node ./dist/core/gateway/index.js",
  "start:user:prod": "cross-env NODE_ENV=production node ./dist/core/user/index.js",
  "start:auth:prod": "cross-env NODE_ENV=production node ./dist/core/auth/index.js",
  "start:file:prod": "cross-env NODE_ENV=production node ./dist/core/file/index.js",
  "start:metrics:prod": "cross-env NODE_ENV=production node ./dist/apps/starlight/metrics/index.js",
  "start:metrics-query:prod": "cross-env NODE_ENV=production node ./dist/apps/starlight/metrics-query/index.js",
  "start:metrics-alerts:prod": "cross-env NODE_ENV=production node ./dist/apps/starlight/metrics-alerts/index.js",
  "start:metrics-compat:prod": "cross-env NODE_ENV=production node ./dist/apps/starlight/metrics-compat/index.js",
  "start:logs:prod": "cross-env NODE_ENV=production node ./dist/apps/starlight/logs/index.js",
  "start:subscription:prod": "cross-env NODE_ENV=production node ./dist/apps/starlight/subscription/index.js",
  "start:video:prod": "cross-env NODE_ENV=production node ./dist/apps/starlight/video/index.js",
  "start:micro-app:prod": "cross-env NODE_ENV=production node ./dist/apps/starlight/micro-app/index.js"
}
```

完成后逐个验证：

```bash
pnpm run start:gateway:prod
pnpm run start:user:prod
```

如果 `dist` 文件不存在，先修正构建脚本，不要用 `nodemon` 冒充生产方案。

### 1.3 增加全量构建脚本

`pnpm build` 和 `pnpm build:all` 均会编译全部服务入口。确认所有入口均生成到 `dist/`：

```bash
pnpm build:all
find dist -type f -name 'index.js'
```

构建脚本必须在本地通过类型检查和全量构建；以下 focused Jest 测试已在本仓库通过：`__tests__/gateway/cors.test.ts`、`__tests__/micro-app/ticket-secret.test.ts`、`__tests__/subscription/models.test.ts`、`__tests__/migrations/model-registry.test.ts`、`__tests__/migrations/migrate.test.ts`。完整 Jest 当前不是已完成的发布 gate：独立运行仍有已知的非本次改动失败（`metrics-query` 聚合断言、`metrics-alerts` 断言，以及 `metrics-sdk` 对未安装 `vitest` 的导入）。修复这些独立问题前，不得在文档中宣称完整 Jest 已通过。

```bash
pnpm install --frozen-lockfile
pnpm build:all
pnpm exec tsc --noEmit
pnpm exec jest __tests__/gateway/cors.test.ts __tests__/micro-app/ticket-secret.test.ts __tests__/subscription/models.test.ts __tests__/migrations/model-registry.test.ts __tests__/migrations/migrate.test.ts --runInBand
```

### 1.4 重写生产 Dockerfile

生产镜像应使用与锁文件匹配的 pnpm，并且不复制 `.env.production` 进镜像。环境变量通过 Compose 的 `env_file` 或服务器密钥管理注入。

实际根目录 `Dockerfile` 使用四个阶段：`base` 启用 Corepack；`dependencies` 安装 `python3 make g++` 并以 `pnpm install --frozen-lockfile` 安装依赖；`builder` 只复制 TypeScript 构建配置和 `src` 后运行 `pnpm run build:all`；`production-dependencies` 从依赖层执行 `pnpm prune --prod`。最终 `runtime` 使用独立的 `node:22.14.0-bookworm-slim`，不包含 `package.json` 或环境文件。

```dockerfile
FROM node:22.14.0-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS dependencies
RUN apt-get update && apt-get install --no-install-recommends -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build:all

FROM dependencies AS production-dependencies
RUN pnpm prune --prod

FROM node:22.14.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install --no-install-recommends -y util-linux && rm -rf /var/lib/apt/lists/* && mkdir -p /app/uploads && chown node:node /app/uploads
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node scripts ./scripts
COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint
RUN chmod 755 /usr/local/bin/docker-entrypoint
EXPOSE 6670 8090
ENTRYPOINT ["/usr/local/bin/docker-entrypoint"]
CMD ["node", "dist/core/gateway/index.js"]
```

运行镜像保留生产 `node_modules`、`dist` 和 migration/seed `scripts`。入口脚本在容器以 root 启动时创建并递归交还 `/app/uploads` 给 `node:node`，随后用 `setpriv` 以非 root `node` 用户执行命令；若容器已非 root，则直接执行命令。环境变量通过 Compose `env_file` 注入，绝不构建进镜像。

### 1.5 拆分 Compose 文件

生产目录当前为：

```text
darwin-app/
├── docker/
│   ├── docker-compose.infra.yml
│   ├── docker-compose.app.yml
│   ├── mysql_data/
│   ├── influxdb_data/
│   └── elasticsearch_data/
├── Dockerfile
├── .dockerignore
└── .env.production
```

`docker/docker-compose.yml` 保留为开发基础设施配置，不能作为安全的生产配置。生产必须使用下面两个单独的文件。

### 1.6 首次公开上线的 Go / No-Go 门槛

当前生产 Compose、Dockerfile 和构建链路已具备，但在以下四项完成、测试并发布新镜像前，**禁止执行首次应用 Compose 启动或将 API 暴露给公网用户**。

1. **Kafka 认证模式统一。** 生产 `docker-compose.infra.yml` 配置的是仅 Docker 内网可访问的 PLAINTEXT Kafka：`kafka:29092`。所有应用服务仅在 `KAFKA_USER` 和 `KAFKA_PASSWORD` 都显式存在时配置 SASL；生产 PLAINTEXT 模式下两者必须保持空值，且服务端不使用写死的用户名/密码 fallback。
2. **Gateway 生产 CORS 白名单。** `CORS_ALLOWED_ORIGINS` 是逗号分隔的精确 HTTPS 来源列表，例如 `https://app.example.com`。Gateway 会去除空白和重复项、拒绝 `*`/非 HTTPS/带路径的值，并保留本地 Tauri 开发来源；携带凭据的请求禁止使用 `*`。
3. **订阅服务数据库初始化与初始套餐。** `subscription` 在开始支付、通知、配额等任务前初始化 MySQL；`pnpm seed` 可重复执行并且只创建确定的 `free` 套餐。
4. **版本化迁移和可选 seed。** `pnpm migrate` 使用 `app_migrations` 账本执行仅前向、非破坏性的已注册迁移。首次空数据库 bootstrap 由迁移工具受控地加载生产模型并执行一次 `sync({ force: false, alter: false })`，随后验证所有运行时表并写入基线；应用服务仅验证数据库连接，不执行 Sequelize `sync()`。

完成后必须在全新 Docker volume 的预发布环境演练完整顺序：基础设施 → migration → 必要 seed → 应用服务 → 登录、文件、指标、日志、订阅、WebSocket 验收。

---

## 2. 腾讯云控制台准备

### 2.1 安全组

安全组公网入方向只保留：

| 端口 | 协议 | 来源 | 用途 |
| --- | --- | --- | --- |
| 22 | TCP | 你的固定公网 IP/32 | SSH 管理；不要对全网开放 |
| 80 | TCP | `0.0.0.0/0` | HTTP 和证书签发 |
| 443 | TCP | `0.0.0.0/0` | HTTPS |

以下端口不要加入公网安全组：

```text
3306  MySQL
6379  Redis
9092  Kafka
2181  Zookeeper
8086  InfluxDB
9200  Elasticsearch
9300  Elasticsearch transport
6670  Gateway（推荐只监听 127.0.0.1）
8090  WebSocket（通过 Nginx 反代）
```

若必须临时远程调试，只允许你的固定 IP，并在调试结束后立即删除规则。生产不应依赖公网访问数据库或消息队列。

### 2.2 域名和 HTTPS

准备一个 API 域名，例如：

```text
api.example.com -> 腾讯云 CVM 公网 IP
```

建议使用腾讯云 DNSPod 管理解析，使用 Nginx + Certbot 或腾讯云 SSL 证书配置 HTTPS。正式域名和证书配置完成前，不要把登录接口作为长期公网入口。

### 2.3 磁盘规划

100GB 系统盘必须预留空间：

```text
系统和 Docker：约 15-25GB
应用镜像：约 5-15GB
MySQL/InfluxDB/Elasticsearch：按业务增长使用
备份和日志：必须设置上限，不能无限增长
```

不要把长期图片、视频和大文件放在本机 Docker volume。后续摄影作品集应使用腾讯云 COS，必要时通过 CDN 对外分发。

---

## 3. 首次配置腾讯云 CVM

以下命令以 Ubuntu 22.04/24.04 为例，在 SSH 登录后执行。若系统不是 Ubuntu，应先确认对应包管理器，不要盲目执行。

### 3.1 登录并更新系统

```bash
ssh ubuntu@你的服务器公网IP
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git jq nginx unzip rsync ufw htop
```

### 3.2 配置 Swap

4GB 内存运行 Kafka、Elasticsearch、MySQL 和多个 Node 服务时，建议配置 4GB Swap 作为防止瞬时 OOM 的缓冲。Swap 不是内存扩容，不能替代升级实例。

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-darwin-app.conf
sudo sysctl --system
free -h
```

### 3.3 配置 Elasticsearch 内核参数

```bash
echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-elasticsearch.conf
sudo sysctl --system
```

### 3.4 安装 Docker

使用 Docker 官方安装源，不要在生产服务器上安装未经确认来源的旧脚本。安装后把当前用户加入 docker 用户组：

```bash
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sudo sh /tmp/get-docker.sh
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

### 3.5 SSH 加固

先确认密钥登录可用，再关闭密码登录；不要在还未验证密钥前关闭密码登录，避免把自己锁在服务器外。

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
```

将本地公钥追加到 `~/.ssh/authorized_keys` 后，编辑：

```bash
sudoedit /etc/ssh/sshd_config
```

至少确认：

```text
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

验证配置并重启：

```bash
sudo sshd -t
sudo systemctl restart ssh
```

保留当前 SSH 会话，另开一个终端确认新会话可以登录后再关闭旧会话。

---

## 4. 获取代码并建立生产目录

### 4.1 创建目录

```bash
sudo mkdir -p /opt/darwin-app/{releases,shared,backups,logs}
sudo chown -R "$USER":"$USER" /opt/darwin-app
cd /opt/darwin-app
```

### 4.2 拉取代码

推荐使用 Git tag 或 commit 部署，不要直接依赖会变化的 `main` 和 `latest`：

```bash
cd /opt/darwin-app
git clone 你的仓库地址 source
cd source
git checkout 你的已验证版本tag或commit
```

如果仓库是私有仓库，使用部署专用 SSH key，不要把个人私钥上传到服务器。

### 4.3 创建持久化目录

```bash
mkdir -p /opt/darwin-app/shared/{mysql_data,redis_data,influxdb_data,influxdb_config,elasticsearch_data,uploads}
mkdir -p /opt/darwin-app/backups/{mysql,influxdb,elasticsearch}
```

把数据库和文件目录放在 `shared` 中，应用每次发布使用新的 release 或镜像版本；不要把数据目录放在会被删除的代码目录里。

---

## 5. 生产环境变量

### 5.1 先处理现有敏感信息

历史 `.env.production` 曾包含开发值和明文密码，应视为已经暴露：

1. 重新生成 MySQL 密码。
2. 重新生成 `PASSWORD_SECRET_KEY` 和 JWT 相关密钥。
3. 重新生成 Redis、Kafka、InfluxDB、Elasticsearch 凭据。
4. 检查 Git 历史和日志，确认旧密码没有泄露。

不要把真实密码写进本文档、代码、Dockerfile 或 Compose 文件。

### 5.2 创建服务器环境文件

```bash
cd /opt/darwin-app/source
touch .env.production
chmod 600 .env.production
```

从 `.env.production.example` 复制后，容器内基础设施地址必须保持为 Docker service name：

```env
NODE_ENV=production
API_URL=https://api.example.com
FRONTEND_URL=https://app.example.com
# Comma-separated exact HTTPS origins; `*` is invalid because Gateway enables credentials.
CORS_ALLOWED_ORIGINS=https://app.example.com

# 以实际代码读取的变量名为准；以下是部署目标示例
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_DATABASE=darwin_app
MYSQL_USER=darwin
MYSQL_PASSWORD=替换为随机强密码

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=替换为随机强密码
REDIS_DB=0

KAFKA_BROKERS=kafka:29092
KAFKA_HOST=kafka:29092
# 当前生产 Kafka 为 Docker 内网 PLAINTEXT；保持为空，除非 broker 已明确切换到 SASL。
KAFKA_USER=
KAFKA_PASSWORD=

INFLUXDB_URL=http://influxdb:8086
INFLUXDB_USERNAME=admin
INFLUXDB_PASSWORD=替换为随机强密码
INFLUXDB_ORG=darwin_app
INFLUXDB_BUCKET=metrics
INFLUXDB_TOKEN=替换为随机token

ELASTICSEARCH_URL=http://elasticsearch:9200
ELASTICSEARCH_PORT=9200
ELASTICSEARCH_PASSWORD=替换为随机强密码

PASSWORD_SECRET_KEY=替换为随机密钥
ADMIN_EMAILS=你的管理员邮箱
QR_CODE_EXPIRE=120
TOKEN_EXIPRE_TIME=6h
REFRESH_TOKEN_EXIPRE_TIME=3d

# 公网只通过 Nginx 暴露 Gateway
GATEWAY_PORT=6670
WS_SERVER_PORT=8090
WS_SERVER_PATH=/ws
```

变量名必须以 `src/config` 及各服务实际读取方式为准。`.env.example` 与当前业务代码可能存在历史命名差异，部署前要逐项核对，尤其是 `MYSQL_USER`、JWT 密钥拼写和 Kafka 配置。当前应用实际读取的是 `MYSQL_USER`，不能只配置 `MYSQL_USERNAME`。当生产 Kafka 保持 PLAINTEXT 时，`KAFKA_USER` 和 `KAFKA_PASSWORD` 必须保持空值；只有 broker 与所有客户端已统一切换到 SASL 后才可填写。

### 5.3 首次发布数据库顺序

基础设施健康后、任何应用服务启动前，必须只运行一个 migration job。首次部署的目标数据库必须是新的空 schema；基线迁移使用与生产相同的已编译模型定义创建全部运行时表，拒绝在已有应用表的数据库上执行，且不使用 `force` 或 `alter`。MySQL DDL 会隐式提交，因此首次基线依靠空库前置条件、单 job 锁和完成后的全表验证，而不是声称整套 DDL 可回滚。

生产环境从仓库根目录使用与 MySQL 相同 Docker 网络中的一次性容器执行（生产 `MYSQL_HOST=mysql` 不能由宿主机解析）：

```bash
docker compose --env-file .env.production -f docker/docker-compose.app.yml \
  run --rm --no-deps gateway node scripts/migrate.js

# 可选；仅创建缺失的 free 套餐
docker compose --env-file .env.production -f docker/docker-compose.app.yml \
  run --rm --no-deps gateway node scripts/seed.js
```

`pnpm migrate` 和 `pnpm seed` 供本地或 CI 调用；生产容器使用上述 `node scripts/*.js` 命令。迁移通过 MySQL advisory lock 串行化执行，先创建 `app_migrations` 迁移账本，再执行未记录的前向迁移。非 DDL 的后续 migration 可标记为 transactional，使其 schema 操作与账本记录位于同一数据库事务；MySQL DDL migration 必须具备明确的前置条件和完成后验证，且不得在失败后盲目写入账本。不要在未备份的生产数据库上跳过备份/恢复演练。应用运行时不会在生产环境自动创建或修改表。

### 5.4 生成随机值

```bash
openssl rand -base64 32
openssl rand -hex 32
```

不要在 shell 历史中直接输入完整密码；必要时执行：

```bash
history -d 行号
```

---

## 6. 生产基础设施 Compose 约束

生产 Compose 必须满足以下条件：

1. 固定镜像版本，禁止 `latest`。
2. 所有数据服务使用持久化目录或命名卷。
3. MySQL、Redis、Kafka、Zookeeper、InfluxDB、Elasticsearch 不配置公网端口映射。
4. 所有服务加入同一个内部 Docker network。
5. 使用健康检查，而不是 `sleep 5`、`sleep 20` 判断依赖是否可用。
6. 为 4GB 实例限制内存，避免 Elasticsearch 和 Kafka 抢光内存。
7. Redis 必须设置密码；Kafka 必须正确设置内部 advertised listener。

### 6.1 4GB 实例资源建议

以下不是“完整栈可以稳定运行”的承诺，而是单项上限参考。4GB 实例不能在没有压测和监控的情况下同时无约束运行全部基础设施及所有 Node 服务：

| 服务 | 建议内存上限 |
| --- | ---: |
| Elasticsearch | 512MB-768MB |
| Kafka | 512MB-768MB |
| Zookeeper | 128MB-256MB |
| MySQL | 384MB-512MB |
| InfluxDB | 256MB-384MB |
| Redis | 64MB-128MB |
| Node 服务合计 | 512MB-768MB |

即使按上述参考值，宿主机、Docker、文件缓存和突发峰值仍可能导致 OOM。因此推荐先只启动实际需要的服务；如果业务必须同时运行完整栈，优先把 MySQL、Kafka、InfluxDB 或 Elasticsearch 迁移到腾讯云托管服务，或升级 CVM。不要只增加 Swap 后继续承载更大流量。

### 6.2 现有 Compose 上线前的必要修正

开发用 `docker/docker-compose.yml` 存在以下生产风险：

- 使用 `bitnami/zookeeper:latest`、`bitnami/kafka:latest`、`mysql:latest`、`redis:latest`。
- 对外映射了多个基础设施端口。
- Kafka advertised listener 写死为 `localhost`，容器间服务无法按生产方式可靠发现。
- Kafka 堆内存上限达到 `1536m`，不适合 4GB 机器与其他服务共存。
- 没有完整的健康检查和清晰的生产网络隔离。

这些问题已在 `docker-compose.infra.yml` 中修正：镜像版本固定、持久化使用命名卷、数据端口不发布、Kafka 只通告 `kafka:29092`，并且每项基础设施都有健康检查。Elasticsearch 目前仅限 `internal: true` Docker 网络且 `xpack.security.enabled=false`；这不是认证防护。若未来需要其他网络访问 Elasticsearch，必须先启用并验证认证/TLS。

---

## 7. 应用 Compose 目标结构

生产应用 Compose 为每个微服务启动一个容器，共享同一个不可变应用镜像。`docker/docker-compose.app.yml` 是实际文件；其非 Gateway 健康检查只验证 PID 1 存活，因为这些服务没有独立 HTTP 健康路由。Gateway 健康检查实际请求 `GET /api/health`。Gateway 需要同时连接两个网络：内部 `darwin_app_network` 用于访问所有微服务和数据服务；`darwin_gateway_ingress` 是仅 Gateway 使用的普通 bridge，用于让 Docker 将回环端口发布给宿主机 Nginx。

```yaml
services:
  gateway:
    image: ${APP_IMAGE:?APP_IMAGE is required}
    command: ["node", "dist/core/gateway/index.js"]
    env_file: ["../.env.production"]
    ports:
      - "127.0.0.1:6670:6670"
      - "127.0.0.1:8090:8090"
    restart: unless-stopped
    networks: [app_network, ingress_network]

  auth:
    image: ${APP_IMAGE:?APP_IMAGE is required}
    command: ["node", "dist/core/auth/index.js"]
    env_file: ["../.env.production"]
    restart: unless-stopped
    networks: [app_network]

  user:
    image: ${APP_IMAGE:?APP_IMAGE is required}
    command: ["node", "dist/core/user/index.js"]
    env_file: ["../.env.production"]
    restart: unless-stopped
    networks: [app_network]

  file:
    image: ${APP_IMAGE:?APP_IMAGE is required}
    command: ["node", "dist/core/file/index.js"]
    env_file: ["../.env.production"]
    restart: unless-stopped
    networks: [app_network]

  metrics:
    image: ${APP_IMAGE:?APP_IMAGE is required}
    command: ["node", "dist/apps/starlight/metrics/index.js"]
    env_file: ["../.env.production"]
    restart: unless-stopped
    networks: [app_network]

  logs:
    image: ${APP_IMAGE:?APP_IMAGE is required}
    command: ["node", "dist/apps/starlight/logs/index.js"]
    env_file: ["../.env.production"]
    restart: unless-stopped
    networks: [app_network]

  subscription:
    image: ${APP_IMAGE:?APP_IMAGE is required}
    command: ["node", "dist/apps/starlight/subscription/index.js"]
    env_file: ["../.env.production"]
    restart: unless-stopped
    networks: [app_network]

networks:
  app_network:
    external: true
  ingress_network:
    name: darwin_gateway_ingress
    driver: bridge
```

应用 Compose 必须在基础设施全部健康后启动。由于两个 Compose 文件是独立项目，应用文件不声明跨项目 `depends_on`；启动顺序由第 8 节的健康状态检查保证。

Compose 文件位于 `docker/` 时，建议从仓库根目录显式指定变量文件，并在 Compose 中使用正确的相对路径：

```yaml
env_file:
  - ../.env.production
```

同时，`${APP_IMAGE}` 属于 Compose 文件插值变量，不能只依赖 `env_file`。启动时必须显式提供：

```bash
docker compose --env-file .env.production -f docker/docker-compose.app.yml config
```

创建网络：

```bash
# 正常情况下由 docker-compose.infra.yml 创建 darwin_app_network。
# 只有在基础设施已停用、但需单独检查网络时才查看：
docker network inspect darwin_app_network

# 正常情况下由 docker-compose.app.yml 创建 darwin_gateway_ingress。
# 该网络只允许 gateway 加入；不得把数据服务或其他微服务加入其中。
docker network inspect darwin_gateway_ingress
```

---

## 8. 首次上线操作顺序

> **停止条件：** 第 1.6 节的四项 Go / No-Go 门槛未全部完成时，本节只能用于准备 CVM、域名、TCR、Docker、Swap、环境文件和 Compose `config` 校验；不得启动 `docker-compose.app.yml`，不得在宝塔开放 API 公网流量。

### 8.1 本地发布前验证

在本地项目目录执行：

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm exec jest __tests__/gateway/cors.test.ts __tests__/micro-app/ticket-secret.test.ts __tests__/subscription/models.test.ts __tests__/migrations/model-registry.test.ts __tests__/migrations/migrate.test.ts --runInBand
pnpm build:all
docker build --pull -t darwin-app:local-verify .
docker run --rm darwin-app:local-verify node --version
```

镜像构建若依赖镜像拉取超时，应先恢复 Docker registry 网络连接后重试；不得跳过镜像构建直接上传未验证代码。

### 8.2 服务器安装基础设施

进入包含生产 Compose 的版本目录：

```bash
cd /opt/darwin-app/source
# docker-compose.infra.yml 会创建内部网络 darwin_app_network。
docker compose --env-file .env.production -f docker/docker-compose.infra.yml config
docker compose --env-file .env.production -f docker/docker-compose.infra.yml pull
docker compose --env-file .env.production -f docker/docker-compose.infra.yml up -d
```

检查状态：

```bash
docker compose --env-file .env.production -f docker/docker-compose.infra.yml ps
docker compose --env-file .env.production -f docker/docker-compose.infra.yml logs --tail=200 mysql
docker compose --env-file .env.production -f docker/docker-compose.infra.yml logs --tail=200 kafka
docker compose --env-file .env.production -f docker/docker-compose.infra.yml logs --tail=200 elasticsearch
```

在基础设施未稳定前，不要启动应用服务。

### 8.3 初始化数据库

先确认 MySQL 容器健康、已完成可恢复备份，且没有其他 migration job。首次 bootstrap 只允许新的空数据库；迁移会拒绝已有非账本表，不能用于接管历史 schema：

```bash
docker compose --env-file .env.production -f docker/docker-compose.infra.yml exec mysql mysqladmin ping -h localhost -u root -p
docker compose --env-file .env.production -f docker/docker-compose.app.yml \
  run --rm --no-deps gateway node scripts/migrate.js
```

迁移成功并核对 `app_migrations` 后，只在确有需要时执行幂等初始 seed：

```bash
docker compose --env-file .env.production -f docker/docker-compose.app.yml \
  run --rm --no-deps gateway node scripts/seed.js
```

首次基线会从本次镜像的已编译 Sequelize 模型创建完整运行时 schema，并在全表验证后记录 `001-initial-model-baseline`。MySQL DDL 不可作为可回滚事务；失败时不要启动应用，保留日志并在新的预发布空库重新演练，或按经过审查的恢复方案处理。

### 8.4 启动应用

```bash
docker compose --env-file .env.production -f docker/docker-compose.app.yml config
docker compose --env-file .env.production -f docker/docker-compose.app.yml up -d
docker compose --env-file .env.production -f docker/docker-compose.app.yml ps
docker compose --env-file .env.production -f docker/docker-compose.app.yml logs --tail=200 gateway
```

检查容器资源：

```bash
docker stats --no-stream
free -h
df -h
```

### 8.5 配置 Nginx

创建 `/etc/nginx/sites-available/darwin-app`：

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:6670;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

启用并检查：

```bash
sudo ln -s /etc/nginx/sites-available/darwin-app /etc/nginx/sites-enabled/darwin-app
sudo nginx -t
sudo systemctl reload nginx
```

完成 DNS 解析后再申请 HTTPS。证书启用后，把 HTTP 配置改为 301 跳转到 HTTPS，并确认 WebSocket 仍可连接。

### 8.6 首次验收

```bash
curl -i http://127.0.0.1:6670/api/health
curl -i https://api.example.com/api/health
docker compose --env-file .env.production -f docker/docker-compose.app.yml ps
docker compose --env-file .env.production -f docker/docker-compose.infra.yml ps
```

随后验证：

1. 登录和刷新 token。
2. Gateway 到 `auth`、`user` 的服务调用。
3. 指标写入和查询。
4. 日志写入、查询和 Elasticsearch 清理任务。
5. 文件上传；大文件不要长期使用本机磁盘。
6. WebSocket 长连接。

---

## 9. 日常运维

### 9.1 每日检查

```bash
cd /opt/darwin-app/source
docker compose --env-file .env.production -f docker/docker-compose.infra.yml ps
docker compose --env-file .env.production -f docker/docker-compose.app.yml ps
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
free -h
df -h
```

重点观察：

- 容器是否频繁重启。
- 内存是否持续低于 300MB 可用。
- Swap 是否持续大量使用。
- `/var/lib/docker` 和数据目录是否超过 70%。
- Kafka 是否积压。
- Elasticsearch 是否超过 70% 磁盘使用率。
- MySQL 是否出现连接数耗尽。

### 9.2 日志

```bash
docker compose --env-file .env.production -f docker/docker-compose.app.yml logs --tail=200 gateway
docker compose --env-file .env.production -f docker/docker-compose.app.yml logs -f gateway
docker compose --env-file .env.production -f docker/docker-compose.infra.yml logs --tail=200 kafka
```

不要无限制使用 `logs -f` 写入文件。应用日志应配置轮转，Docker 日志也应设置 `max-size` 和 `max-file`。

### 9.3 磁盘清理

先确认没有错误发布或备份任务，再执行：

```bash
docker system df
docker image prune
```

禁止在没有确认数据卷的情况下执行：

```bash
# 危险：可能删除数据库数据
# docker volume prune
```

日志和 Elasticsearch 数据必须按保留周期清理。当前日志清理逻辑按 `logs`/`logs-*` 索引内的 `receivedAt` 文档时间清理，不要通过删除整个长期索引替代文档保留策略。

---

## 10. 备份与恢复

备份不能和唯一数据放在同一块 100GB 系统盘。至少将备份同步到腾讯云 COS 或另一台受保护的存储位置，并定期做恢复演练。

### 10.1 MySQL

```bash
mkdir -p /opt/darwin-app/backups/mysql
# .env.production 包含 MYSQL_ROOT_PASSWORD 和 MYSQL_DATABASE，但 Docker Compose 的 --env-file
# 不会把它们导出到宿主机 shell。将同一组值保存在仅服务器可读的受保护文件中供备份任务加载。
# mysql-root.env 示例：export MYSQL_ROOT_PASSWORD='...'; export MYSQL_DATABASE='darwin_app'
set -a
source /opt/darwin-app/shared/secrets/mysql-root.env
set +a
docker exec mysql mysqldump --single-transaction --routines --triggers \
  -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" \
  | gzip > "/opt/darwin-app/backups/mysql/darwin_app_$(date +%F_%H%M).sql.gz"
```

恢复前先停止会写入同一数据的应用，确认备份文件非空并保留当前数据库快照：

```bash
gunzip -c /opt/darwin-app/backups/mysql/darwin_app_YYYY-MM-DD_HHMM.sql.gz \
  | docker exec -i mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"
```

### 10.2 InfluxDB

```bash
docker exec influxdb influx backup /tmp/influx-backup -t "$INFLUXDB_TOKEN"
docker cp influxdb:/tmp/influx-backup \
  "/opt/darwin-app/backups/influxdb/$(date +%F)"
```

### 10.3 Elasticsearch

优先使用 Elasticsearch snapshot repository。小规模临时恢复前可以停止 Elasticsearch 后备份数据目录，但不能在运行中直接复制数据目录并把它当作一致性备份。

MySQL、InfluxDB 和 Elasticsearch 备份完成后，必须同步到腾讯云 COS 或其他独立存储；只保存在 `/opt/darwin-app/backups` 不算完成备份。

### 10.4 Redis

Redis 默认是缓存，不能把只存在 Redis 的数据当作唯一业务数据。若未来承载关键状态，应开启 AOF/RDB 并纳入备份。

### 10.5 备份策略

建议：

- MySQL：每天全量，至少保留 7-14 天。
- InfluxDB：每天或按指标重要性备份。
- Elasticsearch：按日志保留策略做 snapshot。
- 备份完成后同步 COS，并定期下载验证。
- 每月至少做一次恢复演练。

---

## 11. 标准发布与回滚

### 11.1 版本发布原则

禁止在生产使用 `latest`。每次发布使用不可变版本号：

```text
darwin-app:2026-07-27-abc1234
```

发布前必须保留：

- 当前运行版本。
- 新版本镜像。
- 当前 Compose 配置。
- 当前环境变量备份位置，不把秘密写入 Git。
- 数据库迁移版本。

### 11.2 当前单机发布流程

在本地验证并构建镜像后，将镜像推送到腾讯云容器镜像服务 TCR，或在服务器构建。2核4GB 服务器不适合频繁在生产编译大型原生依赖，推荐本地/CI 构建后推送：

```bash
docker build --pull -t 你的TCR仓库地址/darwin-app:2026-07-27-abc1234 .
docker push 你的TCR仓库地址/darwin-app:2026-07-27-abc1234
```

服务器执行：

```bash
cd /opt/darwin-app/source
docker compose --env-file .env.production -f docker/docker-compose.app.yml pull
docker compose --env-file .env.production -f docker/docker-compose.app.yml up -d
docker compose --env-file .env.production -f docker/docker-compose.app.yml ps
docker compose --env-file .env.production -f docker/docker-compose.app.yml logs --tail=200 gateway
```

单机 Compose 的 `up -d` 会按服务重建容器。若 Gateway 只有一个实例，重建窗口可能存在短暂连接中断；要做到真正无感发布，需要蓝绿实例或腾讯云负载均衡，见下一节。

### 11.3 真正零停机的蓝绿发布

当前 2核4GB 实例不建议同时运行完整的两套基础设施，但可以只对 Gateway 和需要升级的应用服务做短时间蓝绿。所有现有服务已使用 `NODE_INSTANCE_ID`、容器 hostname 或进程号构成唯一 nodeID；蓝绿发布前仍必须在预发布环境验证 WebSocket 客户端重连和连接排空，因此不能在未演练前宣称已实现无感切换：

```text
客户端 -> Nginx/腾讯云 CLB -> blue Gateway 或 green Gateway

基础设施和 Kafka 仍然只保留一套
```

流程：

1. 构建不可变的新镜像。
2. 使用不同 Compose project 启动 green 应用服务。
3. green 连接同一套基础设施，但使用唯一 `NODE_INSTANCE_ID`。
4. 检查 green 健康状态和关键接口。
5. 切换 Nginx upstream 或 CLB 后端权重到 green。
6. 观察 5-15 分钟错误率、延迟、内存和 Kafka 消费情况。
7. 稳定后停止 blue；异常则把流量切回 blue。

注意：数据库变更必须兼容 blue 和 green，遵循：

```text
expand：先添加兼容的新字段/表
deploy：部署同时兼容旧结构和新结构的代码
migrate/use：迁移数据并启用新逻辑
contract：确认旧版本不再运行后删除旧字段/逻辑
```

### 11.4 回滚

应用回滚（以下命令只有在生产应用 Compose 已实际创建并验证后执行）：

```bash
# 将 .env.production 中 APP_IMAGE 恢复为上一个已验证的不可变镜像版本。
# 以下命令会重建整个应用服务，不适合单服务故障；单服务回滚请使用下一节。
docker compose --env-file .env.production -f docker/docker-compose.app.yml up -d
```

如果使用 blue/green，只需先切换流量，再停止异常版本。数据库回滚不能简单等同于应用回滚；不可逆迁移必须提前准备兼容代码、反向 migration 或备份恢复方案。

### 11.5 单微服务故障修复、替换与回滚

本节用于线上单独处理一个应用微服务。当前生产应用使用一个共享镜像 `APP_IMAGE`，再由每个 Compose service 的 `command` 启动不同入口；因此可以只重启或重建一个 service，而不影响其他应用容器和基础设施。

当前可独立操作的应用服务：

```text
gateway
auth
user
file
metrics
metrics-query
metrics-alerts
metrics-compat
logs
video
subscription
micro-app
```

在服务器项目目录先定义快捷命令：

```bash
cd /opt/darwin-app/source
APP_COMPOSE='docker compose --env-file .env.production -f docker/docker-compose.app.yml'
INFRA_COMPOSE='docker compose --env-file .env.production -f docker/docker-compose.infra.yml'
```

#### 11.5.1 先确认故障边界

不要在发现错误后直接停止整套应用。先用目标服务名替换 `<service>`：

```bash
$APP_COMPOSE ps <service>
$APP_COMPOSE logs --tail=300 <service>
$APP_COMPOSE logs --tail=300 gateway
$INFRA_COMPOSE ps
$INFRA_COMPOSE logs --tail=200 kafka
docker stats --no-stream
free -h
df -h
```

`gateway` 是唯一具备 HTTP 健康检查的应用服务：

```bash
curl -i http://127.0.0.1:6670/api/health
```

其他应用服务的 Compose healthcheck 只确认 Node 进程仍在运行，不代表它已成功连接 Kafka、MySQL、Redis、InfluxDB 或 Elasticsearch。修复后必须结合服务日志和真实业务调用验证。

#### 11.5.2 临时故障：只重启目标服务

适用于偶发进程异常、短暂依赖断连等未修改代码的情况：

```bash
$APP_COMPOSE restart <service>
$APP_COMPOSE ps <service>
$APP_COMPOSE logs --tail=300 <service>
```

示例：

```bash
$APP_COMPOSE restart logs
```

`restart` 不会拉取新镜像、不会应用新代码，也不会重启其他服务。

#### 11.5.3 容器异常：用当前镜像单独重建服务

当重启无效、但仍要使用当前已部署镜像时：

```bash
$APP_COMPOSE rm --stop --force <service>
$APP_COMPOSE up -d --no-deps <service>
$APP_COMPOSE ps <service>
$APP_COMPOSE logs --tail=300 <service>
```

`--no-deps` 是必须项：它保证只处理目标应用容器，不会重启 Kafka、MySQL、Redis、InfluxDB、Elasticsearch、Gateway 或其他应用服务。

`file` 服务和 `gateway` 共用 `uploads_data` 命名卷。替换 `file` 时绝对不要附加 `-v`，也不要执行 `docker volume prune`，否则可能删除已上传文件：

```bash
# 错误：会删除服务挂载的数据卷
# $APP_COMPOSE rm --stop --force -v file
```

#### 11.5.4 代码修复：仅把一个服务切换到新镜像

代码修复应先在本地或 CI 完成检查，构建并推送不可变镜像：

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm run build:all
docker build --pull -t 你的TCR仓库地址/darwin-app:2026-07-27-abc1234 .
docker push 你的TCR仓库地址/darwin-app:2026-07-27-abc1234
```

上线前记录旧版本，作为回滚点：

```bash
grep '^APP_IMAGE=' .env.production
$APP_COMPOSE ps
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```

将服务器 `.env.production` 的镜像变量更新为新镜像：

```env
APP_IMAGE=你的TCR仓库地址/darwin-app:2026-07-27-abc1234
```

然后只拉取并重建目标服务，例如只发布 `metrics-alerts`：

```bash
$APP_COMPOSE config
$APP_COMPOSE pull metrics-alerts
$APP_COMPOSE up -d --no-deps --force-recreate metrics-alerts
$APP_COMPOSE ps metrics-alerts
$APP_COMPOSE logs --tail=300 metrics-alerts
```

虽然 `.env.production` 中的 `APP_IMAGE` 是共享变量，但只有被 `up -d --force-recreate` 的服务会切换到新镜像；未重建的其他容器继续使用原先的镜像 ID。必须记录哪些服务已升级，以免出现无法追踪的混合版本状态。

不要在只修复一个服务时执行下面的命令：

```bash
# 会影响整个应用 Compose 项目，不是单服务发布命令
# $APP_COMPOSE up -d
```

#### 11.5.5 单服务镜像回滚

如果新版本异常，将 `.env.production` 的 `APP_IMAGE` 改回 11.5.4 中记录的旧不可变镜像，然后仅重建失败服务：

```bash
$APP_COMPOSE config
$APP_COMPOSE pull <service>
$APP_COMPOSE up -d --no-deps --force-recreate <service>
$APP_COMPOSE logs --tail=300 <service>
```

镜像回滚只回退程序文件，不能自动回滚数据。

#### 11.5.6 完整替换服务的分级处理

| 场景 | 示例 | 操作方式 |
| --- | --- | --- |
| 代码修复 | 空指针、查询条件、接口逻辑 | 新镜像 + 仅重建目标服务 |
| 配置修复 | 超时、日志级别、单服务地址 | 优先使用服务专属变量；确认影响范围后只重建目标服务 |
| 兼容替换 | 保持原服务名、actions、Kafka 事件格式 | 先验证新镜像，再单服务替换并走真实业务链路验收 |
| 数据破坏性替换 | 改表、删字段、重建 ES 索引、改 Kafka 消费语义 | 备份、迁移演练、兼容代码、维护窗口；禁止直接原地替换 |

完整替换仍要保持以下契约稳定，除非已执行专项迁移方案：

1. Node-Universe 服务名和 Gateway action 名称。
2. Kafka topic、消息 payload 和 consumer group 行为。
3. MySQL、Redis、InfluxDB、Elasticsearch 的数据结构与读写语义。
4. 服务的 `namespace: darwin-app` 和唯一 `nodeID`。

新旧版本并行或蓝绿演练时必须显式设置不同的 `NODE_INSTANCE_ID`。不要复用其他服务的 Kafka consumer group，否则可能发生消费者抢占或重复处理。

#### 11.5.7 数据变更的禁止事项

仓库提供 `scripts/migrate.js`、`scripts/migrations.js` 和 `scripts/seed.js`。首次空库基线和每个后续数据变更都必须经过迁移测试、账本核对和预发布恢复演练；以下变更不能只靠替换镜像完成：

- MySQL 表、列、索引、约束变更。
- Elasticsearch 索引 mapping 或删除/重建索引。
- InfluxDB bucket、保留策略或 measurement 语义变更。
- Kafka topic、消费者组、事件格式或幂等性语义变更。

这类修改必须遵循：

```text
备份并验证恢复 -> expand（新增兼容结构） -> 部署兼容代码 -> 迁移/切换 -> 验证 -> contract（确认旧版本停止后清理）
```

迁移 job 必须唯一执行；MySQL DDL 迁移需要前置条件和完成后验证，不能声称可由事务自动回滚。安排维护窗口，不要承诺单服务替换能够无损回滚数据。

---

## 12. 后续新增博客/摄影作品集微服务

新增服务不得直接修改正在运行的容器，也不要把新业务塞进 `start:all` 的长命令。每个新业务都应是独立服务、独立容器和独立发布单元。

### 12.1 目录和服务命名

例如博客服务：

```text
src/apps/starlight/blog/
├── index.ts
├── actions/
├── methods/
├── events/
├── types/
├── validators/
└── utils/
```

摄影作品集服务可以是：

```text
src/apps/starlight/portfolio/
```

服务名必须唯一且稳定，例如 `blog`、`portfolio`。所有服务使用相同的 `namespace: 'darwin-app'` 和同一个 Kafka 集群，但 `nodeID` 必须包含唯一实例标识：

```ts
const instanceId = process.env.NODE_INSTANCE_ID || process.env.HOSTNAME || `${process.pid}`
nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'production'}-${instanceId}`
```

### 12.2 数据隔离

博客和摄影服务不要随意复用现有业务表：

- 至少使用独立表前缀或独立 schema。
- 更推荐独立数据库用户和独立 schema。
- 所有业务数据继续带 `tenantId`，不能绕过租户隔离。
- 文件不要写入容器临时目录。
- 摄影原图、缩略图和视频使用腾讯云 COS，数据库只保存对象 key 和元数据。

### 12.3 Kafka 隔离

每个新服务使用独立 consumer group，例如：

```text
darwin-blog-production
darwin-portfolio-production
```

不要复用现有服务的 consumer group，否则新服务可能抢走旧服务的消息。topic 名称要有版本和业务边界，例如：

```text
blog.article-events.v1
portfolio.asset-events.v1
```

### 12.4 新服务接入步骤

1. 创建服务目录和入口。
2. 定义 actions、methods、events、校验器和数据库迁移。
3. 增加开发脚本和生产脚本。
4. 增加 `build:all` 的构建输入。
5. 增加应用 Compose service，但先不修改公网路由。
6. 构建新版本镜像。
7. 在生产启动新服务容器。
8. 验证容器健康、Kafka 注册、数据库连接和内部 `ctx.call`。
9. 只增加新的 Gateway 路由，例如 `/api/blog/v1/...`。
10. 通过 Nginx/CLB 灰度少量流量。
11. 观察稳定后扩大流量。

新服务启动失败时，现有 Gateway、auth、user、metrics、logs 等服务仍应保持运行，因为它们是独立容器。

### 12.5 新服务 Compose 示例

```yaml
  blog:
    image: ${APP_IMAGE:?APP_IMAGE is required}
    command: ["node", "dist/apps/starlight/blog/index.js"]
    env_file: ["../.env.production"]
    environment:
      NODE_INSTANCE_ID: blog-primary
      KAFKA_GROUP_ID: darwin-blog-production
    restart: unless-stopped
    networks: [app_network]
```

摄影作品集服务同理，但图片流量应由 COS/CDN 承担，不能把 7Mbps CVM 作为图片分发节点。

### 12.6 新服务失败时的处理

```bash
docker compose --env-file .env.production -f docker/docker-compose.app.yml logs --tail=300 blog
docker compose --env-file .env.production -f docker/docker-compose.app.yml stop blog
```

停止新服务不会停止现有服务。只有在数据库迁移已经影响旧服务时，才需要按迁移回滚方案处理；因此数据库必须先 expand，再部署新服务。

---

## 13. 常见故障排查

### 13.1 容器内连不上基础设施

容器内使用：

```text
mysql:3306
redis:6379
kafka:29092
influxdb:8086
elasticsearch:9200
```

不要在容器环境使用 `localhost`。`localhost` 指向当前容器本身。

### 13.2 服务互相找不到

检查：

1. 目标服务容器是否运行。
2. `namespace` 是否都是 `darwin-app`。
3. Kafka broker 地址和认证是否一致。
4. 服务名和 action 名称是否正确。
5. `nodeID` 是否冲突。
6. Kafka 是否已经 ready。

```bash
docker compose --env-file .env.production -f docker/docker-compose.app.yml ps
docker compose --env-file .env.production -f docker/docker-compose.infra.yml logs --tail=200 kafka
docker compose --env-file .env.production -f docker/docker-compose.app.yml logs --tail=200 gateway
```

### 13.3 4GB 内存不足

```bash
free -h
docker stats --no-stream
dmesg -T | grep -i -E 'oom|killed process'
```

处理顺序：

1. 确认 Elasticsearch heap 不超过约 1GB。
2. 确认 Kafka 没有使用 1536MB 以上的堆上限。
3. 降低日志级别和日志保留量。
4. 暂停不必要的开发工具和监控容器。
5. 将 MySQL、ES、Kafka 或 InfluxDB 迁移到腾讯云托管服务。
6. 仍不足时升级 CVM，不要依赖 Swap 长期运行。

### 13.4 磁盘满

```bash
df -h
docker system df
du -sh /opt/darwin-app/shared/*
```

先清理过期镜像和日志，再检查 Elasticsearch、上传文件和备份目录。不要删除数据库数据卷。

### 13.5 Kafka 连接失败

检查 `KAFKA_CFG_ADVERTISED_LISTENERS`：容器内应用必须拿到 `kafka:29092`，不能拿到 `localhost`。Kafka 的客户端认证配置、listener protocol 和 group ID 必须与 Node 服务一致。

---

## 14. 安全基线

1. `.env.production` 权限为 `600`，不提交 Git。
2. 生产密码全部重新生成，不复用当前开发环境密码。
3. 安全组只开放 SSH、80、443。
4. SSH 使用密钥登录，禁止 root 远程登录和密码登录。
5. MySQL、Redis、Kafka、Zookeeper、InfluxDB、Elasticsearch 不开放公网。
6. 不使用 `latest` 镜像标签。
7. 不使用 `nodemon`、`start:all` 或 `sleep` 作为生产进程管理和就绪判断。
8. 定期更新基础镜像和依赖，但必须先在预发布环境验证。
9. 网关启用 HTTPS、请求体限制、速率限制和安全响应头。
10. 管理员邮箱、JWT 密钥、支付密钥和第三方密钥单独保管。
11. 备份同步到 CVM 之外，并验证可恢复。
12. 为 CPU、内存、磁盘、接口错误率和 Kafka 积压配置告警。

---

## 15. 上线验收清单

### 仓库

- [x] 已统一 pnpm/yarn，不再引用不存在的锁文件。
- [x] 已实现 `build:all`；发布前仍须在目标版本上验证。
- [x] 所有生产入口不使用 `nodemon`。
- [x] 生产 Dockerfile 使用实际存在的构建脚本。
- [x] `docker-compose.infra.yml` 和 `docker-compose.app.yml` 已实际存在；发布前仍须以实际受保护环境文件运行 `docker compose config`。
- [ ] 所有镜像使用固定版本。
- [x] 多副本前已修正 `nodeID` 唯一性。

### 腾讯云

- [ ] 安全组只开放 22、80、443，且 22 仅允许固定 IP。
- [ ] 已配置 Swap 和 `vm.max_map_count`。
- [ ] Docker 和 Compose 版本已确认。
- [ ] 域名已解析到 CVM。
- [ ] Nginx 配置通过 `nginx -t`。
- [ ] HTTPS 和 WebSocket 已验证。

### 应用和数据

- [ ] `.env.production` 使用真实生产值，权限为 600。
- [ ] `MICRO_APP_TICKET_SECRET` 已设置为独立随机值；`CORS_ALLOWED_ORIGINS` 仅包含精确 HTTPS 前端来源。
- [ ] 容器内地址使用 service name。
- [ ] MySQL 迁移完成并有备份。
- [ ] Kafka、Redis、InfluxDB、Elasticsearch 状态正常。
- [ ] 登录、服务发现、指标、日志、文件上传接口验证通过。
- [ ] MySQL、InfluxDB、Elasticsearch 备份任务已配置。
- [ ] 已检查 `docker stats`、`free -h` 和 `df -h`。

---

## 16. 当前最短执行路线

不要直接执行开发用 `docker/docker-compose.yml` 作为生产部署。正确顺序是：

1. 在本地通过类型检查、测试、全量构建和镜像构建。
2. 以受保护的生产环境文件审查生产基础设施 Compose。
3. 以受保护的生产环境文件审查生产应用 Compose。
5. 在腾讯云完成安全组、Swap、Docker、域名和 HTTPS 准备。
6. 上传或拉取已验证版本，创建 `.env.production`。
7. 启动基础设施，逐项检查健康状态。
8. 在基础设施健康、迁移前备份完成且没有并发 migration job 时，用一次性 Gateway 容器执行 `node scripts/migrate.js`。首次只针对新的空库；需要初始套餐时再执行 `node scripts/seed.js`。核对 `app_migrations` 和 `free` 套餐后，将备份同步到腾讯云 COS 或其他独立存储。
9. 启动应用服务，检查服务发现和核心接口。
10. 启用 Nginx/HTTPS，对外开放 API。
11. 建立备份、告警、日志和回滚流程。
12. 后续新增博客/摄影服务时，只新增独立容器和路由，不重启或修改现有服务容器。

生产 Dockerfile、两个 Compose 文件、全量构建脚本、生产启动脚本和健康检查已经补齐并完成本地配置校验。生产镜像入口会在保持应用非 root 运行的前提下初始化 `/app/uploads` 命名卷权限。当前上线前剩余工作是：使用真实受保护的 `.env.production` 构建镜像，并在全新 Docker volume 的预发布环境完成“基础设施 → migration → 可选 seed → 账本/表核对 → 应用 → 备份恢复”演练。

---

## 17. 腾讯云生产环境基线（2026-07，后续发布先读本节）

> **内部受限运维资料：**本节包含公网 IP、内部端口、容器/网络名称、部署路径、镜像仓库和代理拓扑；不得发布到公开仓库、公开工单、截图或对外文档。信息会随服务器变更而过期；每次重大发布后应更新镜像版本、Compose 变更和验收状态。**严禁在本文档记录 SSH 私钥、密码、Token、API/Registry/DNS/宝塔凭据、`.env.production` 内容、连接串、会话密钥或证书私钥。**

### 17.1 主机与访问边界

| 项目 | 当前值 | 说明 |
| --- | --- | --- |
| 云厂商 / 实例 | 腾讯云 CVM / Lighthouse | 单机生产环境，非高可用集群 |
| 公网 IPv4 | `175.178.250.182` | `api.starlight.host` 的默认线路 A 记录目标 |
| 系统 | Ubuntu 20.04，`x86_64` | 观察到的基线；Ubuntu 20.04 标准支持已于 2025-05 结束，当前未安装 Ubuntu Pro 工具，需安排受控的系统升级或 ESM 评估 |
| Docker | 24.0.2，Compose v2.18.1 | 不更改 Docker daemon 配置或重启 Docker，除非已评估 FRPS 影响 |
| Nginx | 宝塔管理，`/www/server/nginx` | 站点 include 位于 `/www/server/panel/vhost/nginx/` |
| 反向代理站点 | `api.starlight.host` | vhost：`/www/server/panel/vhost/nginx/api.starlight.host.conf` |
| 运维用户 | `lighthouse` | 通过 SSH 密钥登录，具备非交互式 `sudo` |
| SSH 防火墙 | UFW 仅允许明确的固定来源 IP | 每次变更前保留可用 SSH 会话；不得先关闭当前有效管理路径 |

公网入口只应是宝塔 Nginx 的 `80/443`。防火墙已允许 `80/tcp`、`443/tcp`；应用端口和数据端口不得加到公网安全组或 UFW。

### 17.2 网络与服务拓扑

```text
公网用户
  -> api.starlight.host:443
  -> 宝塔 Nginx
     -> 127.0.0.1:6670  Gateway HTTP API
     -> 127.0.0.1:8090  Gateway WebSocket
  -> Docker darwin_app_network（internal=true）
     -> 应用微服务 + MySQL/Redis/Kafka/Zookeeper/InfluxDB/Elasticsearch
```

- `darwin_app_network` 是内部 Docker 网络；数据服务和普通微服务不能直接暴露公网。
- Gateway 额外连接 `darwin_gateway_ingress`，这是使 Docker 能发布**仅回环**端口的必要普通 bridge；该网络只允许 Gateway 加入。
- Gateway 端口必须保持：`127.0.0.1:6670:6670`、`127.0.0.1:8090:8090`。验证时使用 `ss -ltnp`，不得出现 `0.0.0.0:6670` 或 `0.0.0.0:8090`。
- 现有 `frps` 容器是独立服务。**禁止**为发布 darwin-app 重启 Docker、FRPS、宝塔面板或整台主机。

### 17.3 生产目录、镜像和环境文件

| 项目 | 路径 / 值 | 规则 |
| --- | --- | --- |
| 部署根目录 | `/opt/darwin-app` | 保留，不要删除 shared/release 数据 |
| 当前源码目录 | `/opt/darwin-app/source` | CVM GitHub 网络可能不稳定；发布不能依赖远端 `git fetch` 成功 |
| 生产环境文件 | `/opt/darwin-app/source/.env.production` | `600`；仅服务器保存；禁止输出、复制进镜像或提交 Git |
| Release manifest | `/opt/darwin-app/shared/releases/` | 每次发布记录 commit、镜像 tag/digest、时间和验收结果 |
| 应用镜像仓库 | `ccr.ccs.tencentyun.com/starlight/darwin-app` | 使用 TCR，不使用 `latest` |
| 当前应用镜像 | `20260728.4-g22356fe` | 已验证 `linux/amd64`；对应应用代码提交 `22356fe` |
| 当前镜像 digest | `sha256:fb1428c00c6ca7d37ff51fb8e1e90622d21aa0fc03fbc0a9294a96b38abf2686` | 不可变发布锚点 |
| 当前 Compose 网络修订 | `0739de2` | Gateway dual-network / loopback ingress 修复 |

生产基础设施镜像也已镜像到同一 TCR namespace 并在 Compose 中按 digest 固定。CVM 到 Docker Hub 曾超时；遇到拉取问题优先使用既有 TCR 镜像，**不要**通过改 Docker daemon 或安装不可信镜像加速器排障。

### 17.4 已完成的生产验收

截至本节更新时，下列项目已经通过实际验证：

- [x] 6 个基础设施服务 healthy：ZooKeeper、Kafka、MySQL、Redis、InfluxDB、Elasticsearch。
- [x] 12 个应用服务 healthy：Gateway、auth、user、file、metrics、metrics-query、metrics-alerts、metrics-compat、logs、subscription、video、micro-app。
- [x] 在 fresh Docker volume 上完成 `001-initial-model-baseline` migration、迁移账本验证和幂等 `free` 套餐 seed。
- [x] 修复并回归验证模型 timestamp/index 的 snake_case 映射；不存在已知的 `Unknown column` schema 问题。
- [x] Gateway 回环健康检查：`curl --fail http://127.0.0.1:6670/api/health` 返回 200。
- [x] 公网 HTTPS 健康检查：`https://api.starlight.host/api/health` 返回 200。
- [x] Let’s Encrypt 证书已部署到 `/www/server/panel/vhost/letsencrypt/api.starlight.host/`；证书 SAN 为 `api.starlight.host`，当前证书有效至 `2026-10-26`。
- [x] HTTP 的非 ACME 请求 301 跳转 HTTPS；Nginx 配置每次修改先执行 `/www/server/nginx/sbin/nginx -t`，通过后仅执行 graceful reload。
- [x] 服务器本地 WebSocket 验收：`https://127.0.0.1/ws?clientId=...`（带 Host/SNI `api.starlight.host`）返回 `101 Switching Protocols`，Gateway 有连接日志。
- [x] FRPS 在部署过程中持续运行，未被重启。

### 17.5 当前未完成项与停止条件

| 状态 | 项目 | 下一步 / 验收条件 |
| --- | --- | --- |
| 进行中 | 个人 ICP 备案 | 当前已提交审核；保持域名解析稳定，等待腾讯云/管局审核通过并完成腾讯云接入备案生效 |
| 阻塞于备案 | 公网 WSS 终验 | 备案生效后，从至少两个独立外网重复验证 `wss://api.starlight.host/ws?clientId=<唯一值>`；每次必须得到 `101`、`connected` 和 `pong`，并在 Gateway/Nginx 日志关联成功连接 |
| 未完成 | 生产备份自动化与异地恢复演练 | 配置 MySQL、InfluxDB、Elasticsearch 的定时备份至 COS；至少一次恢复演练后才标记完成 |
| 未完成 | 监控与告警 | 为 CPU、内存、磁盘、容器重启、HTTPS 失败、证书到期、Kafka 积压和关键 API 错误率配置告警 |
| 持续任务 | Release manifest | 后续每次部署都更新 commit、镜像 tag/digest、迁移、服务清单、回滚版本和验收结果 |

**公网 WSS 当前未验证，不能作为已对外可用的能力声明。**备案前的外部 WSS 失败证据：外网 TLS ClientHello 已到达 CVM，但客户端侧随后发送 TCP reset，Nginx 没有对应 HTTP access log；这不是 Gateway、Docker、Nginx 或回环端口的故障。备案生效并完成最终 ingress/proxy 验证前，不得通过暴露 `8090`、关闭 TLS、关闭 UFW 或重启基础设施绕过问题。

### 17.6 HTTPS 与 DNS-01 续期

当前域名的 HTTP-01 曾被 DNSPod 备案拦截页影响，因此证书续期采用 DNS-01。

| 项目 | 当前配置 |
| --- | --- |
| 证书 | Let’s Encrypt，`api.starlight.host` |
| DNS 提供商 | DNSPod；专用凭据仅绑定 `starlight.host` 区域 |
| 凭据存储 | 宝塔 `/www/server/panel/config/dns_mager.conf`，`root:root`、`0600`；禁止记录凭据值 |
| 续期脚本 | `/usr/local/sbin/darwin-app-cert-renewal`，`root:root`、`0700` |
| 调度 | `/etc/cron.d/darwin-app-cert-renewal`，每天 `03:17`（服务器时区 `Asia/Shanghai`，cron） |
| 续期阈值 | 剩余不超过 30 天 |
| 更新动作 | 仅当证书文件 hash 改变时执行 `nginx -t` 和 graceful reload；不重启 Docker/FRPS |
| 续期日志 | `/var/log/darwin-app-cert-renewal.log` |

日常验证：

```bash
sudo /usr/local/sbin/darwin-app-cert-renewal
sudo tail -n 100 /var/log/darwin-app-cert-renewal.log
sudo openssl x509 \
  -in /www/server/panel/vhost/letsencrypt/api.starlight.host/fullchain.pem \
  -noout -subject -issuer -dates -ext subjectAltName
```

若 DNSPod Token 需要轮换：先在 DNSPod 创建仅限 `starlight.host` DNS TXT 管理、且 IP 白名单为 `175.178.250.182` 的新凭据；更新 root-only DNS 配置后，先用临时 `_acme-challenge` TXT 创建/删除做验证，再撤销旧 Token。不得在聊天、Git、shell history、Compose 文件或应用 `.env.production` 中保存 Token。

### 17.7 后续新增/升级服务的最短 Runbook

每次新增服务或发布新镜像按以下顺序执行；不要跳过前置验证：

1. **本地实现与验证**：增加服务入口、生产启动命令、`build:all` 输入、Compose service、健康检查、必要 migration/seed、Gateway 路由和文档。运行 `pnpm exec tsc --noEmit`、相关 Jest 测试、`pnpm run build:all`、`docker build`。完整 Jest 仍存在已知独立失败，不能把“完整 Jest 通过”作为虚假 gate。
2. **镜像发布**：本地/CI 构建 `linux/amd64` 不可变镜像，推送到 TCR；记录 tag 和 digest。不要在 2C4G CVM 构建大型镜像，也不要使用 `latest`。
3. **发布前记录与配置校验**：保存当前 `APP_IMAGE`、运行容器镜像和 release manifest；同步必要的 Compose 文件；在 CVM 执行 `docker compose --env-file .env.production -f docker/docker-compose.app.yml config`。不得输出 `.env.production`。
4. **数据变更先行**：若有 migration，先备份并在预发布 fresh volume 演练；生产只启动一个 migration job，核对 `app_migrations`。对已有服务采用 expand -> deploy -> migrate/use -> contract 兼容策略。
5. **最小影响发布**：新增服务时使用 `up -d --no-deps <新服务>`；修复单服务时只 pull/recreate 目标服务。不要为单服务发布执行全量 `up -d`，更不要重启 Docker、FRPS、Nginx 或基础设施。
6. **验收与观察**：检查目标容器健康、日志、Kafka 注册、依赖连接、Gateway 调用；再做公网 HTTPS/WSS（如涉及）和真实业务路径验证。观察 `docker stats --no-stream`、`free -h`、`df -h`。
7. **记录与回滚准备**：更新 release manifest 和本节的“当前应用镜像”；保留上一个不可变镜像及迁移/备份记录。若失败，先回滚目标服务镜像；数据库问题按已演练的恢复方案处理，不能用应用镜像回滚替代数据库回滚。

### 17.8 快速检查命令（不输出密钥）

```bash
# 服务健康与版本
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
sudo docker compose --env-file /opt/darwin-app/source/.env.production \
  -f /opt/darwin-app/source/docker/docker-compose.infra.yml ps
sudo docker compose --env-file /opt/darwin-app/source/.env.production \
  -f /opt/darwin-app/source/docker/docker-compose.app.yml ps

# 本机入口隔离和 Gateway
ss -ltnp | grep -E ':(80|443|6670|8090)\\b'
curl --fail http://127.0.0.1:6670/api/health
curl --fail https://api.starlight.host/api/health

# Nginx 与证书
sudo /www/server/nginx/sbin/nginx -t
sudo openssl x509 \
  -in /www/server/panel/vhost/letsencrypt/api.starlight.host/fullchain.pem \
  -noout -dates -ext subjectAltName

# 资源和独立服务连续性
free -h
df -h
sudo docker stats --no-stream
sudo docker ps --filter name=frps --format '{{.Names}} {{.Status}}'
```

---

**核心原则：基础设施不暴露公网，应用按版本独立容器化，数据和代码分离，新增服务先启动后接入路由，数据库变更保持向后兼容，所有发布都可观察、可回滚。**
