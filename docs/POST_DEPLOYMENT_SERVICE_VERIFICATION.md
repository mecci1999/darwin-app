# 发布后服务注册与健康走查手册

> **适用范围：** 每次生产环境部署、镜像替换、单服务重建、配置变更、Kafka/基础设施重启后都必须执行。  
> **目标：** 防止 Gateway 返回 `Service '<name>' is not registered yet`，或出现 `Gateway target service wait timed out`。  
> **生产目录：** `/opt/darwin-app/source`。本文所有命令均不打印 `.env.production` 内容或任何密钥。

---

## 1. 验收原则与停止条件

### 1.1 三层证据缺一不可

| 层级 | 证明内容 | 不能证明什么 |
| --- | --- | --- |
| Docker `healthy` | 容器进程及其 Compose healthcheck 正常 | 不证明服务已连接 Kafka 并注册到 Node-Universe |
| Gateway `/api/health` 返回 200 | Gateway HTTP 进程可用 | 不证明下游服务可被分发 |
| **Gateway 所在集群的实时 Node-Universe 注册表** | Gateway 实际可找到目标服务 | 不证明某个业务 action 的参数、权限或数据库状态正确 |

**只有三层都通过，才允许将本次发布标记为完成。**

### 1.2 立即停止并修复的条件

出现下列任意一项即为**发布失败**，不得继续放量：

- 任何预期应用或基础设施容器不是 `healthy`；
- 实时注册表缺少本次部署所需的服务名；
- Gateway 日志出现 `Service '<name>' is not registered yet`；
- Gateway 日志出现 `Gateway target service wait timed out`；
- 新容器日志出现 `Failed to start`、`uncaught` 或 `unhandled`；
- 经 Gateway 路由重映射后的关键接口返回上述未注册错误。

> Gateway 默认 `GATEWAY_SERVICE_WAIT_TIMEOUT_MS=0`，缺失服务会立即返回 503。设置等待时间只适合有限启动宽限，**不是**注册成功的证据或替代方案。

---

## 2. 发布前记录与 Compose 配置校验

在服务器执行：

```bash
cd /opt/darwin-app/source

# 记录当前运行镜像、状态；不输出环境变量值。
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

# 主应用与基础设施配置必须能渲染。
docker compose --env-file .env.production -f docker/docker-compose.app.yml config --quiet
docker compose --env-file .env.production -f docker/docker-compose.infra.yml config --quiet
```

如果部署 Trails，使用主应用 Compose 中唯一的 `trails` 服务进行配置验证：

```bash
# Trails 源码在 darwin-app/src/apps/trails；必须从仓库根目录使用 release Dockerfile 构建，
# 以便将运行时依赖 shared/trails-contract 放入 /shared/trails-contract。
docker build -f darwin-app/Dockerfile.release -t "$TRAILS_IMAGE" .

# TRAILS_IMAGE 必须填入本次已验证的不可变镜像名。
docker compose --env-file .env.production -f docker/docker-compose.app.yml config --quiet
```

不得用 `darwin-app/Dockerfile` 构建 `TRAILS_IMAGE`：该 Dockerfile 不复制 `shared/trails-contract`，
Trails 会在加载 `dist/apps/trails/shards.js` 时失败，六个 `trails-durable-*` 服务不会注册。

不要为单服务发布执行未限定目标的 `docker compose up -d`，也不要加 `--remove-orphans`；这会影响与当前 Compose 文件不在同一文件中的独立服务。

---

## 3. 第一关：容器与基础设施健康

```bash
cd /opt/darwin-app/source

docker compose --env-file .env.production -f docker/docker-compose.infra.yml ps
docker compose --env-file .env.production -f docker/docker-compose.app.yml ps
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

# Gateway 的真实 HTTP 健康探针。
curl --fail --silent --show-error http://127.0.0.1:6670/api/health
```

检查以下基础设施容器均为 `healthy`：

```text
darwin-app-zookeeper-1
darwin-app-kafka-1
darwin-app-mysql-1
darwin-app-redis-1
darwin-app-influxdb-1
darwin-app-elasticsearch-1
```

检查所有正在部署的 `darwin-app-*` 应用容器均为 `healthy`。注意：除 Gateway 外，多数应用的 Compose healthcheck 仅确认 Node 进程仍存活；必须继续执行第 4 节的注册表验证。

---

## 4. 第二关：Gateway 实时服务注册表（强制）

以下探针会启动一个临时、无 action 的 Node-Universe 观察节点，连接到同一 Kafka namespace，仅读取服务名后自动退出。它不打印环境变量、密码或 token。

```bash
cd /opt/darwin-app/source

# 在已有 Gateway 容器内运行，避免在宿主机 shell 导出生产环境变量。
docker compose --env-file .env.production -f docker/docker-compose.app.yml \
  exec -T gateway node -e '
const { Star } = require("node-universe");
const kafka = process.env.KAFKA_BROKERS || process.env.KAFKA_HOST;
const suffix = Date.now().toString();
const star = new Star({
  namespace: "darwin-app",
  nodeID: `registry-inspector-${suffix}`,
  transporter: {
    type: "KAFKA",
    host: kafka,
    options: {
      producer: { "linger.ms": 0, "batch.size": 0, acks: 1 },
      consumer: { "fetch.min.bytes": 1, "fetch.wait.max.ms": 100 },
      ssl: false,
      groupId: `registry-inspector-${suffix}`,
      clientId: `registry-inspector-${suffix}`,
      heartbeatInterval: 3000,
      sessionTimeout: 30000,
      requestTimeout: 60000,
      connectionTimeout: 10000,
    },
  },
  serializer: { type: "NotePack" },
  logger: { type: "Console", options: { level: "error" } },
});
(async () => {
  await star.start();
  await new Promise(resolve => setTimeout(resolve, 5000));
  const names = [...new Set((star.registry.services.list() || [])
    .map(item => item.name)
    .filter(name => name && !name.startsWith("$")))].sort();
  console.log(`REGISTERED_SERVICE_COUNT=${names.length}`);
  console.log(`REGISTERED_SERVICES=${names.join(",")}`);
  await star.stop();
})().catch(async error => {
  console.error(`REGISTRY_INSPECTOR_FAILED=${error instanceof Error ? error.message : String(error)}`);
  try { await star.stop(); } catch {}
  process.exit(1);
});
'
```

### 4.1 核对预期服务名

主应用完整部署时，注册表至少应出现以下 **21** 个服务：

```text
auth
file
gateway
logs
metrics
metrics-alerts
metrics-compat
metrics-lifecycle
metrics-query
micro-app
subscription
subscription-billing
trails-durable-content
trails-durable-media
trails-durable-sales
trails-durable-workspace
trails-durable-trips
trails-durable-site
trails-durable-site-public
user
video
```

说明：

- `metrics-lifecycle` 与 `subscription-billing` 是容器内额外注册的真实服务；后者是 Gateway 重映射后的账单请求目标。
- `trails` 是对外路由与目录的逻辑身份，不是实际注册服务；其动作会被 Gateway 映射到具体 shard。
- Trails 只部署唯一的 `trails` 容器，并注册七个 `trails-durable-*` 分片；历史 action 路径由该统一实例兼容分派，不再对应独立服务或容器。
- 新服务上线后，以该服务实际注册的 Node-Universe 名称补充到本次发布记录；**不需要修改客户端服务列表**。

### 4.2 Node-Universe 目录漂移防护验收

Node-Universe 运行时以进程启动时生成的 `instanceEpoch` 区分复用固定 `NODE_INSTANCE_ID` 的新旧容器；较旧实例延迟到达的 `INFO`、heartbeat 或 `DISCONNECT` 不得覆盖新实例的服务目录或将其标为离线。

- 首次部署包含该运行时的镜像，或重建任一应用服务后，必须在第 4 节探针中确认完整 **21/21** 注册表，并完成第 6 节 90 秒日志观察；不得仅以 Gateway 恢复 200 判定通过。
- 若该变更引发注册回归，只回滚包含 Node-Universe runtime overlay 的应用镜像至上一个已验证的不可变镜像，并用 `up -d --no-deps --force-recreate <service>` 逐项恢复。不要通过改用 Docker hostname 作为 `NODE_INSTANCE_ID`、`compose down` 或重启 Kafka 来规避问题；这些做法会破坏指标身份或扩大影响范围。

---

## 5. 第三关：Gateway 路由与重映射验收

必须经 Gateway 的公开路由测试，而不是直接访问内部服务名。Gateway 会在注册校验前把下列路由重映射到实际服务：

| 公共路由类别 | 实际注册目标 |
| --- | --- |
| `/api/metrics/v2/schema`、v2 查询 | `metrics-query` |
| 指标告警、规则、通知路由 | `metrics-alerts` |
| `/api/metrics/v1/realtime`、目录详情兼容路由 | `metrics-compat` |
| `/api/subscription/v1/billing/...` | `subscription-billing` |
| `/api/trails/v1/...` | 三个旧 Trails 分片之一 |
| `/api/trails/v2/...` | 七个 durable Trails 分片之一 |

对每个本次受影响的公共路由家族，用管理员或测试账号执行一个**只读、参数合法**的请求。认证失败、权限拒绝或业务 404 不代表注册失败；但以下响应一律失败：

```text
HTTP 503
Service '<name>' is not registered yet
```

不要直接探测 `/api/metrics-query/...`、`/api/metrics-alerts/...` 或 Trails shard 服务名；这些是 Gateway 明确禁止的内部路由。

---

## 6. 第四关：日志观察窗口

完成重建、注册表检查和关键路由探测后，至少观察 90 秒：

```bash
# Gateway 的未注册目标与等待超时必须为零输出。
docker logs --since 90s darwin-app-gateway-1 2>&1 | \
  grep -Ei "Gateway target service wait timed out|service '[^']+' is not registered yet" \
  && { echo 'FAILED: registration error observed'; exit 1; } \
  || echo 'PASS: no unregistered-service error in 90 seconds'

# 所有应用服务不应出现启动失败或未捕获异常。
failed=0
for container in $(docker ps --format '{{.Names}}' | grep '^darwin-app-'); do
  matches=$(docker logs --since 90s "$container" 2>&1 | \
    grep -Ei 'Failed to start|uncaught|unhandled' || true)
  if [ -n "$matches" ]; then
    failed=1
    printf '[%s]\n%s\n' "$container" "$matches"
  fi
done
test "$failed" -eq 0 && echo 'PASS: no startup or unhandled errors'
```

如果发布窗口流量很低，90 秒日志“零错误”不代表每个路由都已覆盖；必须结合第 5 节的代表性 Gateway 请求。

---

## 7. 缺失注册时的恢复顺序

1. **不要先重启 Gateway。** Gateway 重启不能注册缺失的目标服务。
2. 检查 Kafka、Zookeeper、Redis 和目标服务依赖是否 `healthy`。
3. 使用第 4 节探针确认缺失的是哪个真实 Node-Universe 服务名。
4. 只重启或重建拥有该服务的目标容器：

```bash
cd /opt/darwin-app/source
APP_COMPOSE='docker compose --env-file .env.production -f docker/docker-compose.app.yml'

# 临时网络/进程问题：仅重启目标服务。
$APP_COMPOSE restart <service>

# 当前镜像容器异常：仅重建目标服务，不重启依赖或其他应用。
$APP_COMPOSE up -d --no-deps --force-recreate <service>
```

5. 任一 Trails shard 缺失时，只恢复唯一的 `trails` 容器。
6. 重复第 3 至第 6 节；注册表和 90 秒日志验收未通过前，不要关闭事件或宣称修复完成。

### 7.1 回滚边界

若目标容器无法重新注册：保留失败日志，将该单服务镜像回滚到上一个已验证的不可变镜像，然后只重建该服务。数据库 migration 已执行时，应用回滚不等于数据回滚；按数据库备份和兼容性方案处理，禁止盲目恢复 schema。

---

## 8. 发布记录模板

每次发布在变更单、值班记录或发布日志保存以下非敏感证据：

```text
发布时间（UTC/本地时区）：
发布服务与镜像摘要：
变更/回滚镜像：
基础设施健康：通过 / 失败
Gateway /api/health：通过 / 失败
注册表数量与缺失项：
受影响公共路由探测：通过 / 失败（仅记录状态码与路径类别，不记录 token）
90 秒未注册错误采样：通过 / 失败
90 秒启动/未捕获异常采样：通过 / 失败
最终结论：通过 / 回滚 / 待处理
执行人：
```

---

## 9. 与现有文档的关系

- 日常部署、备份、数据库 migration、单服务回滚与主机资源限制：见 `docs/ONLINE_OPERATIONS_AND_MAINTENANCE.md`。
- 本文只定义**每次发布后的强制服务注册与健康验收**。
- Trails COS/CDN 与媒体发布安全边界：见 `docs/STARLIGHT_TRAILS_ARCHITECTURE.md`；媒体 Worker 是否关闭不影响本手册对 Trails API shard 注册的检查。
