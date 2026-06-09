# Darwin App 线上部署与维护方案

本文档面向 Darwin App 后端微服务系统的线上部署、扩容、发布和日常维护。当前项目本地开发模式是：基础设施通过 `docker/docker-compose.yml` 启动，Node 微服务通过 `package.json` 中的 `start:*` 脚本启动。线上环境建议逐步演进为 **基础设施 + 应用微服务全容器化**，并保留本地开发的灵活性。

## 1. 结论先行

### 1.1 推荐路线

短期推荐使用：**单台云服务器 + Docker Compose + 每个微服务一个容器**。

中期演进为：**基础设施托管化 + 应用微服务容器化**。

长期在流量、团队和运维复杂度上来后，再考虑：**Kubernetes**。

### 1.2 不建议线上使用的方式

不要在线上继续使用下面这种方式作为生产入口：

```json
"start:all": "concurrently \"npm run start:gateway\" \"sleep 5 && npm run start:user\" ..."
```

原因：

- `nodemon` 是开发工具，不适合作为生产进程管理器。
- `sleep 5/10/20` 不是健康检查，不能保证依赖真正 ready。
- 某个微服务崩溃后，整体恢复和日志定位困难。
- 无法单独扩容某个服务，例如只扩 `metrics-query`。
- 新增微服务时需要维护一条越来越长的命令。

线上应由 Docker Compose、PM2 或 Kubernetes 这类进程/容器编排工具负责服务生命周期。

## 2. 当前系统运行模型

### 2.1 基础设施

当前基础设施定义在：

```text
docker/docker-compose.yml
```

包含：

| 组件 | 用途 | 当前 compose service |
| --- | --- | --- |
| Zookeeper | Kafka 依赖 | `zookeeper` |
| Kafka | Node-Universe transporter / 事件通信 / 服务发现包传输 | `kafka` |
| MySQL | 用户、认证、订阅等业务数据 | `mysql` |
| Redis | 缓存、验证码、部分会话能力 | `redis` |
| InfluxDB | 指标时序数据 | `influxdb` |
| Elasticsearch | 日志检索 | `elasticsearch` |

### 2.2 Node 微服务

当前微服务入口由 `package.json` 管理：

| 服务 | 本地启动脚本 | 入口文件 | 服务名 |
| --- | --- | --- | --- |
| Gateway | `npm run start:gateway` | `src/core/gateway/index.ts` | `gateway` |
| User | `npm run start:user` | `src/core/user/index.ts` | `user` |
| Auth | `npm run start:auth` | `src/core/auth/index.ts` | `auth` |
| File | `npm run start:file` | `src/core/file/index.ts` | `file` |
| Metrics | `npm run start:metrics` | `src/apps/starlight/metrics/index.ts` | `metrics` |
| Metrics Query | `npm run start:metrics-query` | `src/apps/starlight/metrics-query/index.ts` | `metrics-query` |
| Metrics Alerts | `npm run start:metrics-alerts` | `src/apps/starlight/metrics-alerts/index.ts` | `metrics-alerts` |
| Metrics Compat | `npm run start:metrics-compat` | `src/apps/starlight/metrics-compat/index.ts` | `metrics-compat` |
| Logs | `npm run start:logs` | `src/apps/starlight/logs/index.ts` | `logs` |
| Subscription | `npm run start:subscription` | `src/apps/starlight/subscription/index.ts` | `subscription` |

### 2.3 服务发现机制

Darwin App 基于 Node-Universe。各微服务通过 Kafka transporter 交换节点信息、服务信息、请求、响应和事件。

关键配置模式：

```ts
new Star({
  namespace: 'darwin-app',
  nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}`,
  transporter: {
    type: 'KAFKA',
    host: process.env.KAFKA_BROKERS || process.env.KAFKA_HOST,
    options: { /* kafka config */ }
  },
  serializer: { type: 'NotePack' }
})
```

服务启动后执行：

```ts
star.createService({
  name: APP_NAME,
  actions,
  methods,
  events
})

await star.start()
```

Node-Universe 会通过 transporter 交换以下类型的包：

- `PACKET_DISCOVER`
- `PACKET_INFO`
- `PACKET_HEARTBEAT`
- `PACKET_REQUEST`
- `PACKET_RESPONSE`
- `PACKET_EVENT`

因此，新增微服务被其他服务识别的必要条件是：

1. 使用同一个 `namespace`，当前为 `darwin-app`。
2. 连接同一个 Kafka。
3. `nodeID` 唯一。
4. `createService({ name })` 的服务名唯一且稳定。
5. actions/events 正确注册。
6. 服务成功启动并保持心跳。

服务间调用示例：

```ts
await ctx.call('payment.v1.createOrder', params)
```

网关 HTTP 访问示例：

```text
/api/payment/v1/createOrder
```

## 3. 线上部署方案

## 3.1 阶段一：单台云服务器 Docker Compose 部署

适用场景：

- 当前项目早期或中小规模阶段。
- 希望部署简单，可快速上线。
- 暂时不需要 Kubernetes 的复杂调度能力。

### 3.1.1 推荐结构

建议拆成两个 compose 文件：

```text
docker-compose.infra.yml   # 基础设施
docker-compose.app.yml     # Node 微服务
```

也可以先保留现有 `docker/docker-compose.yml` 作为基础设施文件，再新增应用 compose。

推荐目录：

```text
darwin-app/
├── docker/
│   ├── docker-compose.infra.yml
│   ├── docker-compose.app.yml
│   ├── mysql_data/
│   ├── influxdb_data/
│   └── elasticsearch_data/
├── Dockerfile
├── .env.production
└── package.json
```

### 3.1.2 基础设施 compose

基础设施可以从现有 `docker/docker-compose.yml` 拆出。线上至少应保留数据卷：

```yaml
services:
  zookeeper:
    image: bitnami/zookeeper:latest
    restart: unless-stopped
    environment:
      ZOO_ENABLE_AUTH: "no"
      ALLOW_ANONYMOUS_LOGIN: "yes"
    networks:
      - app_network

  kafka:
    image: bitnami/kafka:latest
    restart: unless-stopped
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_CFG_LISTENERS: INTERNAL://:29092,EXTERNAL://:9092
      KAFKA_CFG_ADVERTISED_LISTENERS: INTERNAL://kafka:29092,EXTERNAL://${PUBLIC_HOST}:${KAFKA_PORT}
      KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP: INTERNAL:SASL_PLAINTEXT,EXTERNAL:SASL_PLAINTEXT
      KAFKA_CFG_INTER_BROKER_LISTENER_NAME: INTERNAL
      KAFKA_CFG_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE: "true"
      KAFKA_CFG_SASL_ENABLED_MECHANISMS: PLAIN
      KAFKA_CFG_SASL_MECHANISM_INTER_BROKER_PROTOCOL: PLAIN
      KAFKA_CLIENT_USERS: ${KAFKA_USER}
      KAFKA_CLIENT_PASSWORDS: ${KAFKA_PASSWORD}
      KAFKA_INTER_BROKER_USER: ${KAFKA_USER}
      KAFKA_INTER_BROKER_PASSWORD: ${KAFKA_PASSWORD}
    depends_on:
      - zookeeper
    networks:
      - app_network

  mysql:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    volumes:
      - ./mysql_data:/var/lib/mysql
    networks:
      - app_network

  redis:
    image: redis:7
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD}
    networks:
      - app_network

  influxdb:
    image: influxdb:2.7
    restart: unless-stopped
    environment:
      DOCKER_INFLUXDB_INIT_MODE: setup
      DOCKER_INFLUXDB_INIT_USERNAME: ${INFLUXDB_USERNAME}
      DOCKER_INFLUXDB_INIT_PASSWORD: ${INFLUXDB_PASSWORD}
      DOCKER_INFLUXDB_INIT_ORG: ${INFLUXDB_ORG}
      DOCKER_INFLUXDB_INIT_BUCKET: ${INFLUXDB_BUCKET}
      DOCKER_INFLUXDB_INIT_RETENTION: 1w
      DOCKER_INFLUXDB_INIT_ADMIN_TOKEN: ${INFLUXDB_TOKEN}
    volumes:
      - ./influxdb_data:/var/lib/influxdb2
      - ./influxdb_config:/etc/influxdb2
    networks:
      - app_network

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    restart: unless-stopped
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
      - ELASTIC_PASSWORD=${ELASTICSEARCH_PASSWORD}
    volumes:
      - ./elasticsearch_data:/usr/share/elasticsearch/data
    networks:
      - app_network

networks:
  app_network:
    driver: bridge
```

生产环境建议只暴露 Gateway 端口。MySQL、Redis、Kafka、InfluxDB、Elasticsearch 默认不对公网开放。

### 3.1.3 应用 compose

每个微服务单独一个容器，使用同一个镜像，通过 `command` 决定启动哪个服务。

```yaml
services:
  gateway:
    image: darwin-app:latest
    command: npm run start:gateway:prod
    env_file:
      - .env.production
    ports:
      - "6670:6670"
    restart: unless-stopped
    networks:
      - app_network

  auth:
    image: darwin-app:latest
    command: npm run start:auth:prod
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - app_network

  user:
    image: darwin-app:latest
    command: npm run start:user:prod
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - app_network

  file:
    image: darwin-app:latest
    command: npm run start:file:prod
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - app_network

  metrics:
    image: darwin-app:latest
    command: npm run start:metrics:prod
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - app_network

  metrics-query:
    image: darwin-app:latest
    command: npm run start:metrics-query:prod
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - app_network

  metrics-alerts:
    image: darwin-app:latest
    command: npm run start:metrics-alerts:prod
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - app_network

  metrics-compat:
    image: darwin-app:latest
    command: npm run start:metrics-compat:prod
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - app_network

  logs:
    image: darwin-app:latest
    command: npm run start:logs:prod
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - app_network

  subscription:
    image: darwin-app:latest
    command: npm run start:subscription:prod
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - app_network

networks:
  app_network:
    external: true
```

如果 infra 和 app 使用不同 compose 文件，建议显式创建网络：

```bash
docker network create app_network
```

或者让 infra compose 创建网络后，app compose 使用 external network。

### 3.1.4 线上环境变量

当 Node 微服务也运行在 Docker 网络里时，不要使用 `localhost` 访问基础设施。应使用 compose service name。

`.env.production` 示例：

```env
NODE_ENV=production

# Gateway
GATEWAY_PORT=6670
WS_SERVER_PORT=8090
WS_SERVER_PATH=/ws

# MySQL
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_DATABASE=darwin_app
MYSQL_USER=darwin_app
MYSQL_PASSWORD=change-me
MYSQL_ROOT_PASSWORD=change-root-me

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=change-me
REDIS_DB=0

# Kafka
KAFKA_HOST=kafka:29092
KAFKA_BROKERS=kafka:29092
KAFKA_PORT=9092
KAFKA_USER=darwin_app
KAFKA_PASSWORD=change-me

# InfluxDB
INFLUXDB_URL=http://influxdb:8086
INFLUXDB_USERNAME=admin
INFLUXDB_PASSWORD=change-me
INFLUXDB_ORG=darwin_app
INFLUXDB_BUCKET=metrics
INFLUXDB_TOKEN=change-me

# Elasticsearch
ELASTICSEARCH_URL=http://elasticsearch:9200
ELASTICSEARCH_PORT=9200
ELASTICSEARCH_PASSWORD=change-me

# Auth
PASSWORD_SECRET_KEY=change-me
TOKEN_SECRET_KET=change-me
TOKEN_EXIPRE_TIME=2h
REFRESH_TOKEN_EXIPRE_TIME=3d
QR_CODE_EXPIRE=120
ADMIN_EMAILS=admin@example.com
```

如果 Node 微服务仍运行在宿主机，才使用：

```env
MYSQL_HOST=localhost
REDIS_HOST=localhost
KAFKA_HOST=localhost:9092
KAFKA_BROKERS=localhost:9092
INFLUXDB_URL=http://localhost:8086
ELASTICSEARCH_URL=http://localhost:9200
```

生产环境不要混用宿主机 Node + Docker 内网地址，否则最容易出现 Kafka/DB 连接问题。

## 4. Dockerfile 建议

当前项目的 build 脚本只打包 gateway：

```json
"build": "npm run build:gateway"
```

生产建议改造成能输出所有微服务入口。过渡期可以先使用源码镜像，后续再优化为 dist 镜像。

### 4.1 过渡期源码镜像

优点：改造少。缺点：镜像大，启动依赖 ts-node/nodemon/运行时编译，不是最佳生产形态。

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production

CMD ["npm", "run", "start:gateway:prod"]
```

### 4.2 推荐 dist 镜像

优点：镜像更干净，启动更快。缺点：需要先补齐 build all。

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build:all

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY .env.production ./.env.production
CMD ["node", "dist/core/gateway/index.js"]
```

## 5. package.json 脚本改造建议

保留本地开发脚本：

```json
"start:gateway": "cross-env NODE_ENV=development nodemon ./src/core/gateway/index.ts"
```

新增生产脚本，避免生产使用 `nodemon`：

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
  "start:subscription:prod": "cross-env NODE_ENV=production node ./dist/apps/starlight/subscription/index.js"
}
```

如果 dist build 尚未完善，可临时使用 `tsx` 或 `ts-node` 作为过渡，但这不是长期生产方案。

## 6. nodeID 唯一性要求

当前多处服务使用类似：

```ts
nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}`
```

这在单实例时可用，但如果线上对同一个服务开多个容器副本，会产生相同 nodeID，导致 registry 冲突。

建议统一改为：

```ts
const NODE_INSTANCE_ID = process.env.NODE_INSTANCE_ID || process.env.HOSTNAME || `${process.pid}`

nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'production'}-${NODE_INSTANCE_ID}`
```

容器环境中 `HOSTNAME` 通常就是容器 ID，天然唯一。

扩容前必须完成此改造。

## 7. 新增微服务流程

以下以新增 `payment` 服务为例。

### 7.1 创建目录

```text
src/apps/starlight/payment/
├── index.ts
├── actions/
│   └── index.ts
├── methods/
│   └── index.ts
├── events/
│   └── index.ts
├── constants/
│   └── index.ts
├── types/
│   └── index.ts
└── utils/
```

### 7.2 定义服务名

`constants/index.ts`：

```ts
export const APP_NAME = 'payment'
export const KAFKA_BROKERS = process.env.KAFKA_BROKERS || process.env.KAFKA_HOST || 'kafka:29092'
export const KAFKA_USER = process.env.KAFKA_USER || ''
export const KAFKA_PASSWORD = process.env.KAFKA_PASSWORD || ''
```

### 7.3 创建入口

`index.ts` 示例：

```ts
import { Star } from 'node-universe'
import { Starlight } from 'typings'
import { isTransportDebugEnabled } from 'config'
import actions from './actions'
import methods from './methods'
import events from './events'
import { APP_NAME, KAFKA_BROKERS, KAFKA_PASSWORD, KAFKA_USER } from './constants'

async function initializePaymentService() {
  const nodeInstanceId = process.env.NODE_INSTANCE_ID || process.env.HOSTNAME || `${process.pid}`

  const star = new Star({
    namespace: 'darwin-app',
    nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'production'}-${nodeInstanceId}`,
    transporter: {
      type: 'KAFKA',
      debug: isTransportDebugEnabled(),
      host: KAFKA_BROKERS,
      options: {
        sasl:
          KAFKA_USER && KAFKA_PASSWORD
            ? { mechanism: 'plain', username: KAFKA_USER, password: KAFKA_PASSWORD }
            : undefined,
        ssl: false,
        groupId: `payment-group-${process.env.NODE_ENV === 'development' ? Math.floor(Math.random() * 100000) : 'prod'}`,
        clientId: 'payment-service',
        heartbeatInterval: 3000,
        sessionTimeout: 30000,
        requestTimeout: 60000,
        connectionTimeout: 10000
      }
    },
    serializer: { type: 'NotePack' },
    logger: true
  }) as Starlight

  star.createService({
    name: APP_NAME,
    actions: actions(star),
    methods: methods(star),
    events: events(star)
  })

  await star.start()
  star.logger?.info(`微服务 ${APP_NAME.toUpperCase()} 启动成功`)
}

initializePaymentService().catch((error) => {
  console.error('Failed to initialize payment service:', error)
  process.exit(1)
})
```

### 7.4 定义 action

`actions/index.ts`：

```ts
import { Context } from 'node-universe'
import { HttpResponseCode, Starlight } from 'typings'

export default function paymentActions(_star: Starlight) {
  return {
    'v1.createOrder': {
      metadata: { auth: true },
      async handler(_ctx: Context) {
        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            success: true,
            message: '创建订单成功',
            content: {}
          }
        }
      }
    }
  }
}
```

服务间调用：

```ts
await ctx.call('payment.v1.createOrder', params)
```

Gateway HTTP 调用：

```text
POST /api/payment/v1/createOrder
```

### 7.5 package.json 增加脚本

```json
{
  "start:payment": "cross-env NODE_ENV=development nodemon ./src/apps/starlight/payment/index.ts",
  "start:payment:prod": "cross-env NODE_ENV=production node ./dist/apps/starlight/payment/index.js"
}
```

### 7.6 docker-compose.app.yml 增加服务

```yaml
payment:
  image: darwin-app:latest
  command: npm run start:payment:prod
  env_file:
    - .env.production
  restart: unless-stopped
  networks:
    - app_network
```

### 7.7 验证服务是否被识别

启动后检查 gateway 日志或内部 registry。

可通过 HTTP 验证：

```bash
curl -X POST http://<server>:6670/api/payment/v1/createOrder \
  -H 'Content-Type: application/json' \
  -d '{}'
```

如果返回 service not found，按以下顺序排查：

1. `payment` 容器是否启动成功。
2. `NODE_ENV`、`namespace` 是否与其他服务一致。
3. Kafka 地址是否正确。
4. Kafka 用户名密码是否正确。
5. 服务名是否为 `payment`。
6. action 是否为 `'v1.createOrder'`。
7. gateway 是否把该服务加入了 internal-only 限制列表。

## 8. 发布流程

### 8.1 标准发布步骤

1. 拉取代码：

```bash
git pull
```

2. 安装依赖：

```bash
pnpm install --frozen-lockfile
```

3. 构建镜像：

```bash
docker build -t darwin-app:<version> .
docker tag darwin-app:<version> darwin-app:latest
```

4. 启动或滚动更新应用服务：

```bash
docker compose -f docker/docker-compose.app.yml up -d
```

5. 查看状态：

```bash
docker compose -f docker/docker-compose.app.yml ps
```

6. 查看日志：

```bash
docker compose -f docker/docker-compose.app.yml logs -f gateway
```

### 8.2 回滚流程

如果当前版本异常：

```bash
docker tag darwin-app:<previous-version> darwin-app:latest
docker compose -f docker/docker-compose.app.yml up -d
```

数据库结构变更如果不可逆，必须先准备 migration rollback 或备份恢复方案。

## 9. 扩容方案

### 9.1 横向扩容单个微服务

例如扩容 `metrics-query`：

```bash
docker compose -f docker/docker-compose.app.yml up -d --scale metrics-query=3
```

前提：

- `nodeID` 已包含唯一实例后缀。
- 服务没有强依赖本地文件状态。
- Redis/MySQL/InfluxDB/Kafka 连接数允许。

### 9.2 不建议随意扩容的服务

以下服务扩容前需要检查是否存在定时任务、消费队列或单实例假设：

- `metrics`
- `logs`
- `subscription`
- `metrics-alerts`

如果存在定时任务，扩容后可能重复执行，需要引入分布式锁或将定时任务拆成单独 worker。

### 9.3 Gateway 扩容

Gateway 可多副本，但需要前置 Nginx/SLB：

```text
Client -> Nginx/Cloud LB -> gateway replica 1/2/3
```

WebSocket 场景要确认负载均衡支持长连接，必要时启用 sticky session 或统一事件推送通道。

## 10. 备份与恢复

### 10.1 MySQL

每日备份：

```bash
docker exec mysql mysqldump -u root -p${MYSQL_ROOT_PASSWORD} darwin_app > backups/mysql/darwin_app_$(date +%F).sql
```

恢复：

```bash
docker exec -i mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} darwin_app < backups/mysql/darwin_app_YYYY-MM-DD.sql
```

### 10.2 InfluxDB

InfluxDB 保存指标时序数据，建议定期备份数据卷或使用官方 backup：

```bash
docker exec influxdb influx backup /tmp/influx-backup -t ${INFLUXDB_TOKEN}
docker cp influxdb:/tmp/influx-backup backups/influxdb/$(date +%F)
```

### 10.3 Elasticsearch

Elasticsearch 建议配置 snapshot repository。小规模单机可先备份数据卷，但生产更推荐 snapshot。

### 10.4 Redis

Redis 多为缓存和验证码，通常不作为核心持久数据。但如果未来承载关键状态，应开启 AOF/RDB 并备份数据卷。

## 11. 日常维护清单

### 11.1 每日检查

```bash
docker compose -f docker/docker-compose.infra.yml ps
docker compose -f docker/docker-compose.app.yml ps
```

检查：

- 是否有容器频繁重启。
- Gateway 响应是否正常。
- Kafka/MySQL/Redis/InfluxDB/Elasticsearch 是否健康。
- 磁盘空间是否充足。

### 11.2 日志查看

查看 Gateway：

```bash
docker compose -f docker/docker-compose.app.yml logs -f gateway
```

查看某个服务最近 200 行：

```bash
docker compose -f docker/docker-compose.app.yml logs --tail=200 metrics-query
```

查看基础设施：

```bash
docker compose -f docker/docker-compose.infra.yml logs --tail=200 kafka
```

### 11.3 磁盘清理

谨慎执行：

```bash
docker system df
docker image prune
```

不要随意删除 volume：

```bash
# 危险：可能删除数据库数据
# docker volume prune
```

### 11.4 数据卷容量

重点关注：

- `docker/mysql_data`
- `docker/influxdb_data`
- `docker/elasticsearch_data`
- 应用日志目录 `logs/`

## 12. 常见故障排查

### 12.1 服务互相找不到

现象：

```text
Service 'xxx.v1.action' is not found
```

排查：

1. 目标服务容器是否运行。
2. 目标服务是否成功 `star.start()`。
3. `namespace` 是否一致。
4. Kafka 地址是否一致。
5. Kafka SASL 用户名密码是否正确。
6. `nodeID` 是否冲突。
7. action 名称是否正确。

### 12.2 登录很慢或 userInfo 超时

现象：

```text
Request 'user.v1.getUserInfo' is timed out
```

排查：

1. `user` 服务是否运行。
2. `auth` 和 `user` 是否连到同一个 Kafka。
3. MySQL 是否慢查询。
4. Redis 是否阻塞。
5. auth 登录兜底是否生效。

### 12.3 Kafka 连接失败

排查：

1. 容器内服务应使用 `kafka:29092`。
2. 宿主机服务才使用 `localhost:9092`。
3. `KAFKA_CFG_ADVERTISED_LISTENERS` 是否符合部署模式。
4. SASL 用户密码是否一致。
5. Kafka 是否依赖 zookeeper 正常启动。

### 12.4 MySQL 连接失败

排查：

1. `MYSQL_HOST` 是否为 `mysql` 或正确 RDS 地址。
2. 用户名密码是否正确。
3. 数据库是否已创建。
4. 容器网络是否一致。
5. 云安全组是否放行内网访问。

### 12.5 InfluxDB 无数据

排查：

1. `INFLUXDB_URL` 是否正确。
2. `INFLUXDB_TOKEN` 是否正确。
3. bucket/org 是否匹配。
4. `metrics` 服务的 processing queue 是否积压。
5. 数据是否被 retention policy 清理。

### 12.6 Elasticsearch 启动失败

排查：

1. 宿主机内存是否足够。
2. `vm.max_map_count` 是否符合要求。
3. 数据目录权限是否正确。
4. 单机模式 `discovery.type=single-node` 是否设置。

## 13. 安全建议

1. 不要把 `.env.production` 提交到 Git。
2. 生产密码全部重新生成，不复用开发环境密码。
3. 只暴露 Gateway 和必要的 WebSocket 端口。
4. MySQL/Redis/Kafka/InfluxDB/Elasticsearch 不要直接暴露公网。
5. 使用云安全组限制来源 IP。
6. 管理员账号通过 `ADMIN_EMAILS` 控制新注册，已有账号通过数据库 `power=999` 控制。
7. 定期轮换 JWT secret、数据库密码、Kafka 密码和 InfluxDB token。
8. 对 Gateway 增加 HTTPS 反向代理，例如 Nginx + Certbot。

## 14. 推荐 Nginx 入口

线上建议：

```text
Client -> HTTPS/Nginx -> Gateway:6670 -> Node-Universe/Kafka -> Internal Services
```

Nginx 示例：

```nginx
server {
  listen 80;
  server_name api.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name api.example.com;

  ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

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
  }
}
```

## 15. 上线前检查清单

上线前确认：

- [ ] `.env.production` 已配置生产密码。
- [ ] `MYSQL_HOST/REDIS_HOST/KAFKA_HOST/INFLUXDB_URL/ELASTICSEARCH_URL` 与部署方式一致。
- [ ] `nodeID` 已支持唯一实例后缀。
- [ ] `start:*:prod` 不使用 `nodemon`。
- [ ] 只暴露 Gateway/Nginx 端口。
- [ ] 数据卷目录已挂载并可备份。
- [ ] MySQL 已初始化并可连接。
- [ ] Kafka 内外 listener 配置正确。
- [ ] Redis 密码正确。
- [ ] InfluxDB token/org/bucket 正确。
- [ ] Elasticsearch 内存配置正确。
- [ ] 管理员邮箱或管理员账号权限已设置。
- [ ] Gateway 能访问 `/api/:service/:version/:action`。
- [ ] 服务间 `ctx.call` 能正常调用。
- [ ] 日志和错误告警有查看入口。

## 16. 建议后续工程任务

为了让线上部署真正顺滑，建议按优先级推进以下任务：

### P0

- [ ] 新增 `Dockerfile`。
- [ ] 拆分 `docker-compose.infra.yml` 和 `docker-compose.app.yml`。
- [ ] 新增所有服务的 `start:*:prod` 脚本。
- [ ] 统一 `nodeID` 生成逻辑，支持多副本。
- [ ] 修正 `.env.production`，使用 Docker service name。

### P1

- [ ] 构建脚本从 `build:gateway` 扩展到 `build:all`。
- [ ] 为 Gateway 增加健康检查 action。
- [ ] 为核心服务增加健康检查 action。
- [ ] 增加日志轮转策略。
- [ ] 增加 MySQL/InfluxDB/Elasticsearch 备份脚本。

### P2

- [ ] 引入 CI/CD，自动 build image。
- [ ] 引入 Nginx HTTPS 自动续期。
- [ ] 引入 Prometheus/Grafana 监控容器和业务指标。
- [ ] 将 MySQL/Redis/Kafka 等基础设施迁移到云托管。
- [ ] 评估 Kubernetes 部署。

## 17. 最小可执行上线流程

如果现在要最快上线，建议：

1. 云服务器安装 Docker 和 Docker Compose。
2. 上传代码和 `.env.production`。
3. 修改 `.env.production`：容器内地址使用 `mysql`、`redis`、`kafka:29092`、`influxdb`、`elasticsearch`。
4. 启动基础设施：

```bash
docker compose -f docker/docker-compose.infra.yml up -d
```

5. 构建应用镜像：

```bash
docker build -t darwin-app:latest .
```

6. 启动应用服务：

```bash
docker compose -f docker/docker-compose.app.yml up -d
```

7. 查看 Gateway 日志：

```bash
docker compose -f docker/docker-compose.app.yml logs -f gateway
```

8. 调用登录、指标、日志等核心接口验证。

9. 配置 Nginx + HTTPS。

10. 配置备份任务。

---

这份方案的核心原则是：**本地开发保持灵活，线上运行保持确定；服务通过 Kafka/namespace 自动发现，部署通过容器编排保证可恢复和可扩展。**
