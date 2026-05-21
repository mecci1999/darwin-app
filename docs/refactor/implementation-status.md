# darwin-app 重构实施状态

> 更新时间：当前会话自动维护

## 当前阶段

- Milestone: 2 主路径 V1（后端真实实现开始）
- Phase: 2 第一批 read-model 风格 action 落地
- 当前状态: 已完成（本轮主线）

## 已完成（已落代码）

### 1. metrics 服务第一批 read-model 风格 action 落地

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`

本轮实现内容：

- 新增 `v1.overview.summary`
- 新增 `v1.service.detail`
- 新增 `v1.catalog.services`
- 新增 `v1.catalog.service.detail`
- 上述 action 均基于现有 `getServicesList / getInstancesList / InfluxDBHandler.getRealtimeStats / buildRequestStats` 聚合
- 为前端 V2 的 overview / services / service detail 后续接新契约预留了真实后端落点

验证结果：

- `build:fengyuServer` 仍被仓库既有问题阻塞（`rollup.config.js` 中 `terser is not a function`）
- 全量 `tsc --noEmit` 仍被仓库既有问题阻塞（`metrics/sdk/client.ts` 缺少 `axios`）
- 已使用 `node -r ts-node/register/transpile-only -r tsconfig-paths/register -e "require('./src/apps/starlight/metrics/actions/realtime.ts')"` 完成定向模块加载验证，通过

状态：**已完成** 说明：本轮新增后端 action 代码已落地并完成定向运行态验证，后续再逐步清理仓库既有构建阻塞。

### 2. darwin-app 构建阻塞清理

已修改文件：

- `rollup.config.js`
- `src/apps/starlight/metrics/sdk/client.ts`

本轮修复内容：

- 修复 `@rollup/plugin-terser` 的 CommonJS 引用方式
- 修复 Rollup 入口路径，改为真实存在的 `src/core/gateway/index.ts`
- 移除 SDK 对缺失依赖 `axios` 的硬依赖，改为原生 `fetch`

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：darwin-app 已恢复全量构建与类型检查能力，后续后端改动可重新使用全量验证链路。

### 3. 登录链路正确性修复第一批落地

已修改文件：

- `src/error/index.ts`
- `src/core/auth/actions/refresh.ts`
- `src/core/auth/actions/qrcode.ts`

本轮修复内容：

- `UserNotLoginError` 的 HTTP 状态由 200 修正为 401
- 修复 refresh action 中错误的 refreshToken 读取逻辑，优先取 body，其次取 cookie
- refresh 失败/过期时返回 401 语义，和前端 401 驱动重登保持一致
- 二维码确认登录补齐 `refreshToken` 的生成与下发

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：本轮只修认证正确性问题，不涉及整套 auth 架构重构。

### 4. subscription 第二批 read-model 能力落地

已修改文件：

- `src/apps/starlight/subscription/actions/subscription.ts`
- `src/apps/starlight/subscription/actions/quota.ts`

本轮实现内容：

- 新增 `v1.current.detail`
- 新增 `v1.usage.summary`
- `v1.current.detail` 复用现有订阅、计划、用量能力，输出更稳定的 current detail 结构
- `v1.usage.summary` 复用现有 quota/status 底层方法，输出 billing/quota 摘要视图所需结构

验证结果：

- `npm run build:fengyuServer` 通过（仅保留外部依赖 warning，不影响构建完成）
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：subscription 已开始具备面向前端的 read-model 风格输出，后续 billing/admin 页可逐步接入。

### 5. metrics 服务最小可用 alerts/read-model 能力落地

已修改文件：

- `src/apps/starlight/metrics/actions/alerts.ts`
- `src/apps/starlight/metrics/actions/index.ts`

本轮实现内容：

- 新增 `v1.alerts`
- 新增 `v1.alert-rules`
- 新增 `v1.notifications`
- 新增 `v1.alerts/:id/resolve`
- 新增 `v1.alerts/:id/suppress`
- 新增 `v1.notifications/:id/resend`
- 先以最小可用的 read-model 形式补齐前端现有 `metrics/v1/alerts*` 路径的真实后端落点

验证结果：

- `npm run build:fengyuServer` 通过（保留外部依赖 warning，不影响构建完成）
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：alerts 路径已不再悬空，后续可在此基础上再逐步替换为更完整的告警服务实现。

### 6. logs 第二批 read-model 能力落地

已修改文件：

- `src/apps/starlight/logs/actions/read-model.ts`
- `src/apps/starlight/logs/actions/index.ts`

本轮实现内容：

- 新增 `v1.explorer.search`
- 新增 `v1.explorer.stats`
- 新增 `v1.exceptions.list`
- 在不重写底层 search/stats/exception-analysis 的前提下，补齐面向前端 explorer 的 read-model 风格输出

验证结果：

- `npm run build:fengyuServer` 通过（保留外部依赖 warning，不影响构建完成）
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：logs 服务已开始具备 explorer/read-model 风格输出，后续前端日志与异常分析页可逐步切换。

### 7. subscription billing history 后端能力启用

已修改文件：

- `src/apps/starlight/subscription/actions/index.ts`

本轮实现内容：

- 将现有 `billing.ts` action 正式挂入 subscription actions 导出
- 前端 `billing/payment` 页现在可通过 `subscription/v1/billing/list` 获取真实账单历史

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：billing 历史相关后端能力不再只是存在于代码中未导出，而是已成为真实可调用契约。

### 8. subscription methods 补齐 billing/current 依赖方法

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`

本轮实现内容：

- 新增 `getUserCurrentSubscription`
- 新增 `getUserCurrentUsage`
- 新增 `getCurrentUsage`
- 新增 `getUserBills`
- 新增 `getBillById`
- 新增 `getBillItems`
- 新增 `generateInvoice`
- 新增 `logInvoiceDownload`
- 以上方法直接复用真实 DB billing API，不再让 `billing.ts` / `current.detail` / `usage.summary` 依赖悬空方法

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：subscription 的 billing/current 链路现在已从“能编译”提升为“方法真实存在且连接到 DB 层”。

### 9. plan-manager 去除 mock pricing history 返回

已修改文件：

- `src/apps/starlight/subscription/utils/plan-manager.ts`

本轮实现内容：

- `getPlanPricingHistory()` 不再返回伪造的价格历史数组
- 在缺少真实价格历史数据源时，改为返回空数组，避免 mock 数据误导前端与业务判断

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：subscription 价格历史逻辑已从“假数据占位”切换为“空值安全”，为后续接真实数据源留出口。

### 10. payment-handler 去除伪造成功支付回包

已修改文件：

- `src/apps/starlight/subscription/utils/payment-handler.ts`

本轮实现内容：

- Stripe / PayPal / Alipay 在未接真实网关时，不再伪造 `completed` 成功回包
- 统一改为 `pending + manual_review` 的安全占位语义
- 避免假成功支付结果误导前端与业务判断

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：payment-handler 已从“伪造支付成功”收敛为“待人工确认”的保守语义，业务可信度更高。

### 11. subscription webhook 验签默认通过逻辑修正

已修改文件：

- `src/apps/starlight/subscription/utils/payment-handler.ts`

本轮实现内容：

- Stripe / PayPal / Alipay webhook 验签不再默认 `return true`
- 在没有真实校验配置时，统一改为保守失败
- 避免伪签名事件被当作合法 webhook 处理

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：subscription webhook 处理的安全语义已从“默认放行”收敛为“默认拒绝”。

### 12. logs 导出历史去除 mockExports 假数据

已修改文件：

- `src/apps/starlight/logs/methods/log-export.ts`

本轮实现内容：

- `getExportHistory()` 不再返回伪造的 `mockExports` 历史记录
- 在尚未接入真实导出历史存储时，改为返回空列表，避免假数据误导前端

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：logs 导出历史逻辑已从“假记录占位”切换为“空值安全”。

### 13. plan-manager 去除 mockPlan 套餐回包

已修改文件：

- `src/apps/starlight/subscription/utils/plan-manager.ts`

本轮实现内容：

- `getPlanById()` 不再返回伪造的 Basic Plan
- 改为直接从真实 `queryAllSubscriptionPlans()` 结果中按 id 查找并映射
- 避免套餐查询继续使用假套餐数据误导前端和订阅逻辑

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：plan-manager 的套餐查询已从“假套餐占位”切换为真实 DB 查询。

### 14. webhook-processor 去除 mock webhook 重处理事件

已修改文件：

- `src/apps/starlight/subscription/utils/webhook-processor.ts`

本轮实现内容：

- `reprocessFailedWebhooks()` 不再伪造 `mock_signature` webhook 事件进行重处理
- 在未接入真实 webhook 事件存储时，改为明确跳过并记录 warning
- 避免使用伪 webhook 数据继续误导支付事件重放流程

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：webhook 重处理逻辑已从“假事件重放”收敛为“空值安全/显式跳过”。

### 15. metrics ingestion 改接新的 subscription current detail 契约

已修改文件：

- `src/apps/starlight/metrics/services/ingestion.ts`

本轮实现内容：

- `getUserLimits()` 不再走过时的 `subscription.getUserSubscription + plans.limits` 组合
- 改为通过 `subscription.v1.current.detail` 统一读取当前套餐与限制
- `getUserSubscription()` 也同步改为复用 current detail 结果
- metrics 采集链路对订阅/配额的依赖开始统一到新的 subscription read-model

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：metrics ingestion 的订阅/配额读取已切到新的 subscription read-model。

### 16. overview / service detail 契约层接入 timeRange 参数

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`

本轮实现内容：

- `v1.service.detail` action 显式增加 `timeRange` 参数
- `buildServiceDetailContent()` 签名同步接收 `timeRange`
- 后端 service detail 契约层开始显式承接来自前端的时间范围参数

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：overview/service detail 的 timeRange 参数已从前端 UI 层打通到后端契约层。

### 17. metrics 第二批补充 overview incidents / service runtime 契约

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`

本轮实现内容：

- 新增 `v1.overview.incidents`
- 新增 `v1.service.runtime`
- 用现有 `getServicesList / getInstancesList` 能力聚合出总览事件和服务运行时视图
- 补齐文档中明确要求、但此前仍缺失的两个后端 read-model 路径

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：overview incidents 与 service runtime 两条后端契约已补齐，后续前端可继续接入。

### 18. metrics 第二批补充 overview incidents / service runtime 契约

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`

本轮实现内容：

- 新增 `v1.overview.incidents`
- 新增 `v1.service.runtime`
- 用现有 `getServicesList / getInstancesList` 能力聚合出总览事件和服务运行时视图
- 补齐文档中明确要求、但此前仍缺失的两个后端 read-model 路径

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：overview incidents 与 service runtime 两条后端契约已补齐，后续前端可继续接入。

### 19. service detail 摘要真正按 timeRange 计算

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`

本轮实现内容：

- `buildServiceDetailContent()` 不再忽略 `timeRange`
- 使用 `buildSystemSeries / buildQpsSeries / buildDurationSeries` 基于给定时间范围计算摘要均值
- service detail 的 CPU / memory / QPS / responseTime 摘要开始真正受时间范围影响

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：service detail 时间范围已从“仅透传参数”变为“真实参与数据计算”。

### 20. logs 服务补齐最小可用 trace search/detail 契约

已修改文件：

- `src/apps/starlight/logs/actions/read-model.ts`

本轮实现内容：

- 新增 `v1.trace.search`
- 新增 `v1.trace.detail`
- 基于现有日志 traceId 数据生成最小可用的 trace 结果，但不再由前端直接伪装
- 作为真正的后端契约承接前端 trace 查询与详情请求

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：trace 不再只停留在前端伪装层，而是已有最小可用后端契约落点。

### 21. overview incidents / service runtime 进一步去假化

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`

本轮实现内容：

- `buildOverviewIncidentsContent()` 不再只从服务列表生成带 `Date.now()` 的假事件
- 改为基于给定 `timeRange` 内的 QPS/耗时序列为告警服务生成时间范围相关事件
- `buildServiceRuntimeContent()` 的 ingestStatus 不再硬编码全 true，改为保守真实值（当前仅 metrics 依据实例存在与否）

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：overview incidents 与 service runtime 的伪数据问题已进一步收敛。

### 22. alerts 后端动作支持时间过滤与最小状态记忆

已修改文件：

- `src/apps/starlight/metrics/actions/alerts.ts`

本轮实现内容：

- 告警列表支持 `startTime/endTime` 过滤
- `resolve/suppress/resend` 改为更新最小状态存储，而不再只是永远成功的空返回
- alerts 路径从纯当前服务状态投影，进一步收敛到可交互的状态模型

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：alerts 行为已从“永远成功 stub”收敛为最小可交互状态模型。

### 23. alert-rules 后端补齐 create/update/delete 动作

已修改文件：

- `src/apps/starlight/metrics/actions/alerts.ts`

本轮实现内容：

- 新增 `v1.alert-rules/create`
- 新增 `v1.alert-rules/:id`
- 新增 `v1.alert-rules/:id/delete`
- 为 alert-rules 提供最小可用的增删改后端落点，不再只有读取动作
- 规则列表同时支持按 `serviceId` 过滤，并使用内存级规则存储承接 CRUD

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：alert-rules 不再只有只读接口，前端规则编辑链路已有真实后端动作承接。

### 24. alerts 后端补齐规则写动作并按 Redis 优先承接状态

已修改文件：

- `src/apps/starlight/metrics/actions/alerts.ts`

本轮实现内容：

- 新增 `v1.alert-rules/create`
- 新增 `v1.alert-rules/:id`
- 新增 `v1.alert-rules/:id/delete`
- alert-rules 规则状态与 notifications/resolved/suppressed 状态改为 Redis 优先承接，不再以内存 Map 为唯一来源
- alerts 行为从“最小 stub”进一步向可持续状态模型收敛

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：alerts 规则写链路与最小状态承接已补齐。

### 25. alerts 后端补齐 serviceId 过滤与通知状态模型一致性

已修改文件：

- `src/apps/starlight/metrics/actions/alerts.ts`

本轮实现内容：

- AlertItem 增加 `serviceId`，告警过滤改为按真实 `serviceId` 判断
- Notifications 返回结构补齐 `serviceId`
- `notifications/:id/resend` 的状态统一改为 `sent`，避免前后端状态模型不一致
- alerts 路径中的 service 过滤与通知状态语义进一步对齐

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：alerts service 过滤与 notifications 状态模型的一致性问题已修正。

### 26. alerts 后端补齐 serviceId/timeRange 过滤与 sent 状态一致性

已修改文件：

- `src/apps/starlight/metrics/actions/alerts.ts`

本轮实现内容：

- AlertItem 与 NotificationItem 都开始携带 `serviceId`
- alerts 按真实 `serviceId` 过滤，不再拿服务名硬匹配
- notifications 重发状态统一为 `sent`，避免前后端状态模型分叉
- alert-rules 同时支持 `serviceId + startTime + endTime` 过滤

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：alerts 的过滤和通知状态模型已进一步与前端页面对齐。

### 27. subscription 后端补齐 payment methods 实际读接口

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`

本轮实现内容：

- 补齐 `getAvailablePaymentMethods()` 内部方法，承接 `v1.payment.methods` action
- 支付方式列表开始基于 `PAYMENT_GATEWAY_CONFIG` 输出启用状态、支持币种、手续费与说明
- billing payment 页不再需要依赖前端静态占位文案判断支付渠道状态

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过

状态：**已完成** 说明：subscription 的 payment methods 路径已具备真实后端返回，不再因缺失内部方法而悬空。

### 28. subscription 后端补齐 payment order 基础执行链路

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`
- `src/db/mysql/apis/payment.ts`

本轮实现内容：

- 补齐 `calculatePlanPricing / getPaymentProvider / createPaymentOrder / generatePaymentUrl`
- 补齐 `getPaymentOrderById / getPaymentOrderByNumber / updatePaymentOrderStatus / cancelPaymentOrder / getUserPaymentHistory`
- 将 `payment.ts` 与 `subscription.ts` 依赖的订单基础能力接到现有 `payment_orders` 表读写上
- 统一 `orderNo -> orderNumber`、`metadata.expiresAt`、`paymentUrl` 等返回字段，减少 action 与底层表结构不一致造成的运行时断点

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：可创建 pending 订单、查询订单、取消订单，并从历史列表读回该订单

状态：**已完成** 说明：subscription 的支付订单基础 create/query/cancel/history 链路已不再依赖缺失的内部方法悬空运行。

### 29. subscription webhook processor 补齐最小可重放事件存储

已修改文件：

- `src/apps/starlight/subscription/utils/webhook-processor.ts`

本轮实现内容：

- webhook processor 新增进程内 `webhookStore / paymentRecordStore`
- `saveWebhookEvent()` 与 `savePaymentRecord()` 不再只是空实现日志，而会实际保存到处理器内存状态
- `getWebhookStats()` 改为基于已保存事件聚合，不再返回固定的 mock 统计值
- `reprocessFailedWebhooks()` 改为可对已保存的失败 webhook 做真实重放，不再无条件跳过

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：失败 webhook 可被重放成功，失败标记被清除，统计信息同步更新

状态：**已完成** 说明：subscription webhook 的最小事件存储与重放能力已补齐，不再停留在“永远跳过重放”的占位实现。

### 30. subscription 服务启动链路接回 payment / notification / webhook 处理器

已修改文件：

- `src/apps/starlight/subscription/index.ts`

本轮实现内容：

- 服务 `started()` 生命周期开始真实调用 `PaymentHandler.initialize()`
- 服务 `started()` 生命周期开始真实调用 `NotificationHandler.initialize()` 与 `WebhookProcessor.startProcessor()`
- 服务 `stopped()` 生命周期补齐 `WebhookProcessor.stopProcessor()`、`PaymentHandler.closeAll()`、`NotificationHandler.closeAll()`
- subscription 服务不再只打印“Starting subscription processors...”占位日志，而是真实切换处理器运行状态

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：启动后支付网关/通知服务状态变为 true，webhook processor 激活；停止后全部回落为 false

状态：**已完成** 说明：subscription 处理器链路已真实接入服务生命周期，不再只停留在启动日志层。

### 31. subscription 支付成功与发票成功事件名对齐

已修改文件：

- `src/apps/starlight/subscription/actions/payment.ts`
- `src/apps/starlight/subscription/utils/webhook-processor.ts`

本轮实现内容：

- `payment.notify` 成功分支的事件名从 `payment.success` 改为 `payment.succeeded`
- webhook processor 的支付成功事件名从 `payment.success` 改为 `payment.succeeded`
- webhook processor 的发票成功事件名从 `invoice.payment.success` 改为 `invoice.paid`
- 事件发射端与 `events/index.ts` 中现有订阅处理器的事件名保持一致，避免成功支付后下游处理器收不到事件

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：当前成功路径实际发出的事件名为 `payment.succeeded`, `payment.succeeded`, `invoice.paid`

状态：**已完成** 说明：subscription 的支付/发票成功事件链路已从“事件名错位”修正为可被现有处理器真实消费。

### 32. subscription 补齐 free plan 创建与历史查询方法

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`

本轮实现内容：

- 补齐 `createFreeSubscription()`，将免费套餐创建接到 `user_subscriptions` 表写入
- 补齐 `getUserSubscriptionHistory()`，为导出的订阅历史 action 提供真实数据来源
- `subscription.create` 的 free 路径不再依赖缺失内部方法悬空运行

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：可创建 free 订阅，并可从订阅历史接口对应方法读回该记录

状态：**已完成** 说明：subscription 的免费套餐创建与历史读取主链路已补齐。

### 33. subscription 支付回调默认 URL 与 notify 主链路补齐

已修改文件：

- `src/apps/starlight/subscription/actions/payment.ts`
- `src/apps/starlight/subscription/methods/index.ts`

本轮实现内容：

- `payment.createOrder` 默认 `notifyUrl` 改为真实网关路由 `/api/subscription/v1/payment/notify`
- 补齐 `verifyPaymentNotification / parsePaymentNotification / processPaymentSuccess / processPaymentFailure`
- `v1.payment.notify` 不再依赖缺失内部方法，可对成功/失败回调做最小状态落库更新

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：`v1.payment.notify` 成功回调返回 200，且对应订单状态更新为 `paid`

状态：**已完成** 说明：subscription 的异步支付完成主链路已从“默认回调错误 + 缺失 notify 方法”修正为可执行状态。

### 34. subscription paid 订单成功后补齐真实订阅激活

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`
- `src/db/mysql/apis/payment.ts`

本轮实现内容：

- `processPaymentSuccess()` 不再只把订单状态改为 `paid`
- 成功支付后会基于订单信息创建真实 `user_subscriptions` 记录
- 支付订单会回写 `subscriptionId / providerOrderId / paidAt`
- 成功路径补发 `subscription.created`，让现有订阅事件链可以消费该结果

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：成功回调后订单状态为 `paid`、订单已关联 `subscriptionId`、创建出 1 条 `pro` 订阅记录，并发出 `subscription.created` 与 `payment.succeeded`

状态：**已完成** 说明：subscription 的付费订阅主链路已从“仅订单支付成功”补齐到“真实激活订阅”。

### 35. subscription cancel / resume 主链路补齐方法承接

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`
- `src/db/mysql/apis/subscription.ts`

本轮实现内容：

- 补齐 `calculateRefundAmount / cancelSubscription / recordCancellationFeedback`
- 补齐 `getUserCancelledSubscription / canResumeSubscription / resumeSubscription`
- `subscription.cancel` 与 `subscription.resume` 不再依赖缺失内部方法悬空运行

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：可创建 free 订阅、取消为 `cancelled`、识别为可恢复订阅，并恢复回 `active`

状态：**已完成** 说明：subscription 的取消 / 恢复主链路已具备最小真实数据承接能力。

### 36. subscription upgrade 主链路补齐方法承接

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`

本轮实现内容：

- 补齐 `canUpgradePlan / calculateUpgradeCost / upgradeSubscriptionDirect / createUpgradeOrder`
- `getUserActiveSubscription()` 返回结构补齐 `planName / billingCycle / currency / price / expiresAt` 等 action 真实依赖字段
- `subscription.upgrade` 不再依赖缺失内部方法悬空运行

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：可判断升级资格、计算升级费用、创建升级订单，并完成无额外费用的直接升级

状态：**已完成** 说明：subscription 的升级主链路已具备最小真实数据承接能力。

### 37. subscription webhook processor 补齐真实签名校验门槛

已修改文件：

- `src/apps/starlight/subscription/utils/webhook-processor.ts`

本轮实现内容：

- `verifyStripeSignature()` 不再无条件返回 true，改为基于 `STRIPE_WEBHOOK_SECRET` 和 payload HMAC 校验
- `verifyPayPalWebhook()` 不再无条件返回 true，改为基于 `PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID` 与传输头构造签名校验
- `verifyAlipaySignature()` 不再无条件返回 true，改为基于 `ALIPAY_PUBLIC_KEY` 与 payload 摘要校验
- live `WebhookProcessor` 队列路径不再默认接受伪造 webhook

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：Stripe / PayPal / Alipay 三条路径均能拒绝错误签名并接受正确签名

状态：**已完成** 说明：subscription 的 queue-backed webhook 处理链已从“无条件验签成功”收敛到最小可用的配置化校验门槛。

### 38. subscription refund 主链路补齐真实方法承接

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`
- `src/db/mysql/apis/payment.ts`

本轮实现内容：

- 补齐 `checkRefundPolicy / createRefundRequest / processRefund`
- 退款申请开始写入 `refund_requests` 表的真实字段结构
- 自动退款处理后会更新退款记录状态，并将支付订单状态更新为 `refunded`
- 修正 `findRefundRequestsByOrderId()` 误查 `id` 的问题，改为按 `paymentOrderId` 查询

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：`v1.payment.refund` 返回成功，生成 1 条退款记录，退款记录状态为 `processed`，支付订单状态变为 `refunded`

状态：**已完成** 说明：subscription 的退款主链路已具备最小真实数据承接能力。

### 39. StarLight billing plans 已接回 subscription 生命周期动作

关联前端文件：

- `../StarLight/src/api/url.ts`
- `../StarLight/src/api/subscription.ts`
- `../StarLight/src/views/homeWindow/billing/plans.tsx`

本轮联动结果：

- 后端已落地的 `subscription.upgrade / subscription.cancel / subscription.resume` 不再停留在 backend-only 状态
- StarLight 当前计费页已开始根据订阅状态切换到升级、取消、恢复等动作入口
- 前后端 subscription 生命周期链路的“前端不可达”缺口已收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）下，billing plans 页已能渲染生命周期动作标签，不再只有统一的“发起订阅”入口

状态：**已完成** 说明：subscription 生命周期动作的前端可达性已补齐，便于后续继续收口剩余支付分支。

### 40. StarLight billing plans 已接回后端 plans.list 契约

关联前端文件：

- `../StarLight/src/api/url.ts`
- `../StarLight/src/api/subscription.ts`
- `../StarLight/src/views/homeWindow/billing/plans.tsx`

本轮联动结果：

- StarLight 前端不再依赖本地硬编码套餐列表
- billing plans 当前渲染已改为消费后端 `v1.plans.list` 返回的数据结构
- subscription 计划目录的前后端契约从“后端存在但前端未接”进一步收敛到真实联动

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）下，billing plans 页已显示后端返回的计划名与特性，而不是旧硬编码套餐内容

状态：**已完成** 说明：subscription 计划目录契约已从 backend-only 落到当前前端账单页。

### 41. StarLight billing plans 动作排序已改为后端计划驱动

关联前端文件：

- `../StarLight/src/views/homeWindow/billing/plans.tsx`

本轮联动结果：

- StarLight 账单页不再依赖固定 `free / pro / enterprise` 升级阶梯
- 当前订阅动作的启用/禁用逻辑改为根据后端实际返回的计划顺序计算
- subscription 计划目录不仅数据源接回后端，动作判断也已去掉旧命名耦合

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）下，后端返回 `Starter / Growth / Scale` 时，billing plans 页仍能正确渲染并给出合理的升级/当前套餐/取消订阅动作状态

状态：**已完成** 说明：subscription 计划目录的前端行为逻辑已进一步收敛到后端计划顺序本身。

### 42. subscription plans.list 改为显式暴露 sortOrder 契约

已修改文件：

- `src/db/mysql/apis/subscription.ts`
- `src/apps/starlight/subscription/actions/plans.ts`

关联前端文件：

- `../StarLight/src/api/subscription.ts`
- `../StarLight/src/views/homeWindow/billing/plans.tsx`

本轮实现内容：

- `queryAllSubscriptionPlans()` 从按价格排序改为按 `sortOrder ASC, price ASC` 返回
- `v1.plans.list` 与 `v1.plans.compare` 返回内容开始显式携带 `sortOrder`
- StarLight 账单页开始消费 `sortOrder` 字段作为真实升级阶梯依据，而不是依赖接口原始列表顺序

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：后端计划查询结果按 `sortOrder` 输出
- 联动浏览器 QA 验证：即使接口返回顺序被打乱，StarLight billing plans 页仍按 `sortOrder` 正确展示和判定动作

状态：**已完成** 说明：subscription 计划排序契约已从隐式价格/列表顺序，收口为显式 `sortOrder` 字段驱动。

### 43. subscription 支付跳转改为 provider-aware checkout URL

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`

本轮实现内容：

- `createPaymentOrder()` 不再把本地 `/home/billing?tab=payment&orderId=...` 写入为 `paymentUrl`
- `generatePaymentUrl()` 改为按 `stripe / paypal / alipay` 生成外部 provider checkout URL，并携带 `returnUrl / notifyUrl`
- 补齐 `generateQRCode()`，为二维码支付分支返回实际可展示的编码值

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：Stripe / PayPal / Alipay 三条路径都返回外部 checkout URL，Alipay 同时返回可用的 `qr://...` 编码值

状态：**已完成** 说明：subscription 的支付跳转已从本地账单页占位 URL 收敛为真实 provider-aware handoff。

### 44. subscription create / upgrade / queryOrder 补齐新的 paymentUrl 生成方式

已修改文件：

- `src/apps/starlight/subscription/actions/subscription.ts`
- `src/apps/starlight/subscription/actions/payment.ts`
- `src/apps/starlight/subscription/methods/index.ts`

本轮实现内容：

- `subscription.create` 与 `subscription.upgrade` 不再读取已移除的 `order.paymentUrl` 持久字段
- paid create / upgrade 改为基于订单 `paymentMethod` 重新调用 `generatePaymentUrl()`
- `payment.queryOrder` 的 `nextAction` 改为异步生成 provider-aware checkout target，不再返回空目标

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- `npm run build` 通过
- 手动脚本验证：paid create 返回 `https://checkout.example/stripe/o1`，paid upgrade 返回 `https://checkout.example/paypal/o2`，pending order 的 `nextAction.target` 返回 `https://checkout.example/alipay/o3`

状态：**已完成** 说明：provider-aware payment handoff 的回归问题已修复，paid create / upgrade / continuation 三条路径重新可用。

### 45. StarLight 已接回 paid create 与 pending-order continuation 前端入口

关联前端文件：

- `../StarLight/src/api/url.ts`
- `../StarLight/src/api/subscription.ts`
- `../StarLight/src/views/homeWindow/billing/plans.tsx`
- `../StarLight/src/views/homeWindow/billing/payment.tsx`

本轮联动结果：

- StarLight paid 新订阅创建改为走后端 `subscription.create`，不再绕过当前订阅主链路
- StarLight 新增 `payment.queryOrder` 使用入口，billing payment 页开始消费 `nextAction.target`
- 后端已修复的 create / upgrade / queryOrder paymentUrl 链路现在都能从当前前端实际触达

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：paid 新订阅命中 `/subscription/create`，pending order 页面可显示并打开“继续支付”checkout URL

状态：**已完成** 说明：subscription payment 主链路的前端可达性已进一步补齐。

### 46. payment.queryOrder 补齐 provider-aware 状态对账

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`

本轮实现内容：

- `queryThirdPartyPaymentStatus()` 不再只回显订单当前状态
- 对已终态订单保持原状态
- 对带 provider transaction / externalStatus 的 pending 订单可推进为 `paid` 或 `failed`
- 对过期 pending 订单可推进为失败态，避免前端永远停留在“等待支付确认”

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：
  - 含 `providerOrderId` 的 pending 订单返回 `paid`
  - `externalStatus=failed` 的 pending 订单返回 `failed`
  - 已过期 pending 订单返回 `failed` 且带 `payment session expired`

状态：**已完成** 说明：payment.queryOrder 已具备最小真实的 provider-aware 状态对账能力。

### 47. paid 订单默认 returnUrl 改为 billing payment continuation

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`
- `src/apps/starlight/subscription/actions/payment.ts`

关联前端文件：

- `../StarLight/src/views/homeWindow/billing/index.tsx`
- `../StarLight/src/views/homeWindow/billing/plans.tsx`

本轮实现内容：

- paid 订单默认 `returnUrl` 改为 `/home/billing?tab=payment&orderId=...`
- `payment.createOrder` 不再默认注入不存在的 `/subscription/success`
- StarLight billing 页开始受 `tab` / `orderId` 路由参数控制，paid 新订阅和 upgrade 可直接落到续付页面

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：paid create 后当前页面 URL 切到 `/home/billing?tab=payment&orderId=o99`，payment tab 自动展示待处理订单并保留外部 checkout 打开动作

状态：**已完成** 说明：paid 订单的 return path 已从不存在的 success 路由收敛到当前前端真实 continuation 页面。

### 48. logs explorer stats 补齐 legacy 日志中心概览所需字段

已修改文件：

- `src/apps/starlight/logs/actions/read-model.ts`
- `src/apps/starlight/logs/utils/elasticsearch.ts`

关联前端文件：

- `../StarLight/src/views/homeWindow/log/index.tsx`

本轮实现内容：

- `v1.explorer.stats` 不再只返回基础 summary，而是补齐 `totalLogs / errorLogs / warnLogs / levelStats / serviceStats / topServices / avgResponseTime`
- 热门服务统计开始带出 `avgResponseTime`
- 旧日志中心概览页可直接消费这些真实字段，去掉 `todayLogs=totalLogs` 与 `avgResponseTime=0` 的临时占位逻辑

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：`v1.explorer.stats` 可返回完整 overview 字段
- 手动浏览器 QA（Tauri bridge mock）验证：legacy 日志中心概览页显示真实的总日志数、今日日志、平均响应时间与 Top 服务

状态：**已完成** 说明：logs read-model 对 legacy 日志中心概览的统计支撑已补齐，用户不再看到临时占位值。

### 68. logs config connection test 已接回真实后端探活

已修改文件：

- `src/apps/starlight/logs/actions/stats.ts`

关联前端文件：

- `../StarLight/src/views/homeWindow/log/config.tsx`
- `../StarLight/src/api/logs.ts`
- `../StarLight/src/api/url.ts`

本轮实现内容：

- logs service 新增 `v1.config.testConnection` 动作
- 该动作通过 `elasticsearchManager.getClient(...).healthCheck()` 执行真实连接探活，而不是固定成功结果
- `log/config` 页的“测试连接”现已调用该动作并根据真实返回结果显示成功/失败

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：健康探活成功返回 `200 / connected=true`，失败返回 `503 / connected=false`

### 69. logs config connection test 已支持 username-only 认证配置

已修改文件：

- `src/apps/starlight/logs/utils/elasticsearch.ts`
- `src/apps/starlight/logs/utils/elasticsearch-manager.ts`

联动前端文件：

- `../StarLight/src/views/homeWindow/log/config.tsx`

本轮实现内容：

- Elasticsearch 客户端创建 auth 信息时不再要求 `password` 必填
- 仅传 `username` 时也会保留认证配置，避免用户填写的用户名在连接测试里被静默丢弃
- manager 初始化和默认 client 创建也统一支持显式 username

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：`new ElasticsearchClient({ username: 'custom-user' })` 的内部 auth 为 `{ username: 'custom-user', password: '' }`，而完全不传认证时 auth 为 `null`

### 70. logs config fallback 探活已复用服务初始化配置

已修改文件：

- `src/apps/starlight/logs/utils/elasticsearch-manager.ts`

本轮实现内容：

- ElasticsearchManager 现在会保存 `initialize()` 传入的 base config
- fallback `getClient()` / `getClient(tenantId)` 不再重建自裸 `process.env`
- `v1.config.testConnection` 在不传自定义配置时，探活对象与 logs service 实际初始化配置保持一致

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：在 `initialize({ node: 'http://service-es:9200', username: 'svc-user', password: 'svc-pass' })` 后，fallback client 与 tenant-scoped client 都返回同一 `node/auth`

状态：**已完成** 说明：logs config 的 fallback 探活路径已不再与服务实际运行配置脱节。

### 72. log/stream 导出已接回真实后端导出 action

关联前端文件：

- `../StarLight/src/views/homeWindow/log/stream.tsx`

本轮联动结果：

- `log/stream` 页的导出按钮不再直接导出浏览器缓冲中的临时日志文本
- 前端已改为调用 logs 服务现有的 `v1.export` 导出链路
- 实时日志页导出结果开始与后端正式日志导出能力保持一致

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过

状态：**已完成** 说明：log/stream 的导出能力已从前端临时实现收敛到 logs 后端真实导出链路。

### 73. log/stream 的实时日志投递已接回真实 SSE 链路

已修改文件：

- `src/apps/starlight/logs/actions/stream.ts`
- `src/apps/starlight/logs/events/logs-events.ts`
- `src/apps/starlight/logs/methods/log-ingestion.ts`
- `src/apps/starlight/logs/validators/logs.ts`

关联前端文件：

- `../StarLight/src/views/homeWindow/log/stream.tsx`

本轮实现内容：

- 前端实时流改为直连后端真实 SSE 路径 `/api/logs/v1/stream?...`，不再使用不存在的 `/api/logs/stream/:id`
- 前端开始按 `LogStreamEvent` 信封解析流消息，而不是把 SSE payload 当成裸日志对象
- `registerStreamListeners()` 现在会把 broadcast 事件写入响应流
- `logs.ingested / logs.batch.ingested / logs.stream.ingested` 事件现在会携带真实日志 payload，并通过 `broadcastToStreams()` 推送到活跃 SSE 连接
- 过时的 `apiKey` 参数强校验已从 stream validator 移除，使 live SSE 路径与当前 handler 参数模型一致

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：`v1.stream` 建连成功后，SSE 输出包含 `connected` 事件和真实 `log` 事件，日志消息为 `stream ok`

状态：**已完成** 说明：log/stream 已从“仅建立 SSE 连接”收敛为真正的实时日志投递链路。

### 74. log/stream 的导出 action 已支持前端认证上下文调用

已修改文件：

- `src/apps/starlight/logs/actions/export.ts`

关联前端文件：

- `../StarLight/src/views/homeWindow/log/stream.tsx`

本轮实现内容：

- 导出 action 不再强依赖 body-level `tenantId / apiKey`
- 当前已登录前端调用会优先使用 `ctx.meta.tenantId / ctx.meta.apiKey` 作为认证上下文
- 前端导出逻辑也已改为读取后端真实返回的 `content.exportData` 与 `content.meta`

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：导出 action 返回 `status=200 / success=true`，且 `content.exportData` 与 `content.meta.filename` 可用

状态：**已完成** 说明：log/stream 的导出链路已从“认证上下文和响应结构错位”收敛到真实可用状态。

状态：**已完成** 说明：logs config 的可配置连接测试已完整支持 username-only 认证场景。

状态：**已完成** 说明：logs config 的连接测试能力已从 placeholder 收敛为真实后端探活。

### 71. exception-analysis 已改用与后端 sampleLogs 一致的文案语义

关联前端文件：

- `../StarLight/src/views/homeWindow/log/exception.tsx`

本轮联动结果：

- 异常详情中的 `sampleLogs` 展示文案不再误导为静态示例内容
- 前端已将其表述收敛为“关联日志”，与后端 `sampleLogs` 实际语义保持一致

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：异常详情弹层显示“关联日志”，且不再出现“示例日志”字样

状态：**已完成** 说明：exception-analysis 的 sampleLogs 展示文案已与后端真实数据语义对齐。

### 49. legacy 日志中心概览页分布百分比口径对齐

关联前端文件：

- `../StarLight/src/views/homeWindow/log/index.tsx`

本轮联动结果：

- 旧日志中心概览页的级别分布与 Top 服务百分比，改为统一使用同一批 today-range 统计总量
- 不再出现 `levelStats` 来自 today-range，而百分比分母来自 later search total 的口径错位

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：legacy 日志中心概览页可正确显示 `66.7% / 16.7% / 16.7%` 级别分布百分比

状态：**已完成** 说明：legacy 日志中心概览页的分布百分比口径已与 logs read-model 输出保持一致。

### 50. service-detail-v2 已接回 topology/runtime 页内 continuation

关联前端文件：

- `../StarLight/src/domains/service/pages/ServiceDetailPage.tsx`

本轮联动结果：

- 当前主 V2 路径 `service-detail-v2` 不再只把 topology/runtime 作为跳转入口
- topology tab 已在页内展示当前服务的直接上下游关系，并支持节点详情抽屉
- runtime tab 已在页内展示当前服务实例预览表，减少对旧实例页的纯跳转依赖

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：V2 服务详情页可直接显示 topology 预览、节点详情和实例预览

状态：**已完成** 说明：Milestone 3 的前端主路径已从“按钮式 continuation”推进到真正的页内 continuation 体验。

### 51. service-domain 页面开始接管 topology / instance 真正实现

关联前端文件：

- `../StarLight/src/domains/service/pages/TopologyPage.tsx`
- `../StarLight/src/domains/service/pages/InstanceMonitorPage.tsx`
- `../StarLight/src/views/homeWindow/service/topology.tsx`
- `../StarLight/src/views/homeWindow/service/instance.tsx`

本轮联动结果：

- service-domain 路由对应页面不再只是 legacy view 的薄包装
- legacy `views/homeWindow/service/*` 入口反向变为兼容层，domain 页面成为真实实现承载层
- Milestone 3 在 topology / instance 这两条路径上的页面归属进一步向新域结构收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/service-topology` 与 `/home/instance-monitor` 两条 service-domain 路由都能正常渲染功能页面

状态：**已完成** 说明：Milestone 3 的 topology / instance 页面所有权已开始从 legacy view 收敛到 domain 页面本身。

### 52. trace-v2 页面所有权开始从 legacy monitor view 收敛到 trace domain

关联前端文件：

- `../StarLight/src/domains/trace/pages/TraceExplorerPage.tsx`
- `../StarLight/src/views/homeWindow/monitor/trace.tsx`

本轮联动结果：

- `trace-v2` 域页面不再只是旧 trace 页的壳层包装
- 旧 `monitor/trace.tsx` 入口反向变为兼容层，domain 页面成为真实实现承载层
- Milestone 3 在 trace 路径上的页面归属进一步向 domain 结构收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/trace-v2` 路由可正常显示 trace 列表与详情抽屉

状态：**已完成** 说明：Milestone 3 的 trace 路由所有权已开始从 legacy monitor view 收敛到 trace domain 页面本身。

### 53. service-logs 页面所有权开始从 legacy log view 收敛到 logs domain

关联前端文件：

- `../StarLight/src/domains/logs/pages/LogExplorerPage.tsx`
- `../StarLight/src/views/homeWindow/log/service.tsx`

本轮联动结果：

- `service-logs` 域页面不再只是较轻量的旧日志检索入口
- 旧 `log/service.tsx` 入口反向变为兼容层，domain 页面成为真实实现承载层
- Milestone 3 在 service-logs 路径上的页面归属进一步向 logs domain 结构收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/service-logs` 路由可正常显示统计、过滤、日志列表和详情弹层

状态：**已完成** 说明：Milestone 3 的 service-logs 路由所有权已开始从 legacy log view 收敛到 logs domain 页面本身。

### 54. metrics-v2 页面所有权开始从 legacy metrics view 收敛到 metrics domain

关联前端文件：

- `../StarLight/src/domains/metrics/pages/MetricsExplorerPage.tsx`
- `../StarLight/src/views/homeWindow/monitor/metrics.tsx`

本轮联动结果：

- `metrics-v2` 域页面不再只是旧 metrics 页的壳层包装
- 旧 `monitor/metrics.tsx` 入口反向变为兼容层，domain 页面成为真实实现承载层
- Milestone 3 在 metrics 路径上的页面归属进一步向 metrics domain 结构收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/metrics-v2` 路由可正常显示服务选择、图表区与请求统计卡片

状态：**已完成** 说明：Milestone 3 的 metrics 路由所有权已开始从 legacy metrics view 收敛到 metrics domain 页面本身。

### 55. real-time-monitor 页面所有权开始从 legacy realtime view 收敛到 overview domain

关联前端文件：

- `../StarLight/src/domains/overview/pages/RealtimeMonitorPage.tsx`
- `../StarLight/src/views/homeWindow/monitor/realtime.tsx`

本轮联动结果：

- `real-time-monitor` 域页面不再直接依赖旧 realtime view 作为实现承载层
- 旧 `monitor/realtime.tsx` 入口反向变为兼容层，domain 页面成为真实实现承载层
- Milestone 3 在 realtime 路径上的页面归属进一步向 domain 结构收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/real-time-monitor` 路由可正常显示实时指标卡片、趋势图和系统状态区

状态：**已完成** 说明：Milestone 3 的 realtime 路由所有权已开始从 legacy realtime view 收敛到 overview domain 页面本身。

### 76. real-time-monitor 已切到新的 service.runtime / overview.incidents 合约

关联前端文件：

- `../StarLight/src/domains/overview/pages/RealtimeMonitorPage.tsx`

本轮联动结果：

- realtime 页面不再继续依赖旧的 `metrics.v1.realtime` 汇总返回来驱动图表与状态区
- 前端图表已切到 `metrics.v1.metrics.analysis`
- 状态区已切到 `metrics.v1.service.runtime` 与 `metrics.v1.overview.incidents` 的组合结果

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/real-time-monitor` 路由可显示基于新合约的 `实例运行 / Metrics 采集 / Logs 采集 / 活跃事件` 状态项与图表区

状态：**已完成** 说明：realtime 页面在 contract 层已从 legacy realtime 汇总进一步收敛到 service-first / overview read-model 组合。

### 56. alert-list 页面所有权开始从 legacy alert view 收敛到 alerts domain

关联前端文件：

- `../StarLight/src/views/homeWindow/alert/list.tsx`
- `../StarLight/src/domains/alerts/pages/AlertInboxPage.tsx`

本轮联动结果：

- `alert-list` 不再由 legacy alert list 文件承载真实实现
- 旧 `alert/list.tsx` 入口反向变为兼容层，alerts domain 页面成为真实实现承载层
- Milestone 3 在 alert-list 路径上的页面归属进一步向 alerts domain 结构收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/alert-list` 路由可正常显示筛选、表格与告警数据

状态：**已完成** 说明：Milestone 3 的 alert-list 路由所有权已开始从 legacy alert view 收敛到 alerts domain 页面本身。

### 66. alert-rules 与 alert-notifications 的实现模块已迁入 alerts domain

关联前端文件：

- `../StarLight/src/domains/alerts/pages/AlertRulesPage.tsx`
- `../StarLight/src/domains/alerts/pages/NotificationCenterPage.tsx`
- `../StarLight/src/views/homeWindow/alert/rules.tsx`
- `../StarLight/src/views/homeWindow/alert/notifications.tsx`

本轮联动结果：

- `alert-rules` 与 `alert-notifications` 域页面不再依赖旧 alert views 作为真实实现
- 旧 `alert/rules.tsx` 与 `alert/notifications.tsx` 入口反向变为兼容层，domain 页面成为真实实现承载层
- alerts 路径的页面归属进一步向 alerts domain 结构收敛，不再只有 alert-list 一条完成 owner 切换

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/alert-notifications` 路由可正常显示通知历史，`/home/alert-rules` 路由可正常显示规则页面结构

状态：**已完成** 说明：alerts 域页面在 rules / notifications 两条路径上也已从 legacy alert view 收敛到 domain-owned 实现。

### 92. alert-rules 已补齐批量启用/禁用与导入导出动作

已修改文件：

- `src/apps/starlight/metrics/actions/alerts.ts`

关联前端文件：

- `../StarLight/src/api/alerts.ts`
- `../StarLight/src/api/url.ts`
- `../StarLight/src/domains/alerts/pages/AlertRulesPage.tsx`

本轮实现内容：

- backend 新增 `v1.alert-rules/bulk-update`
- backend 新增 `v1.alert-rules/export`
- backend 新增 `v1.alert-rules/import`
- 前端 alert-rules 页面已接回这些动作，不再暴露无实现的批量/导入导出按钮

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：bulk update/export/import 三条动作均返回正确内容

状态：**已完成** 说明：alert-rules 的规则管理动作面已从“UI 存在、契约缺失”收敛到真实后端支持。

### 57. custom-dashboard 页面所有权开始从 legacy dashboard view 收敛到 overview domain

关联前端文件：

- `../StarLight/src/domains/overview/pages/CustomDashboardPage.tsx`
- `../StarLight/src/views/homeWindow/monitor/dashboard.tsx`

本轮联动结果：

- `custom-dashboard` 域页面不再直接依赖旧 dashboard view 作为实现承载层
- 旧 `monitor/dashboard.tsx` 入口反向变为兼容层，同时保留原有 props 透传能力
- Milestone 3 在 dashboard 路径上的页面归属进一步向 overview domain 结构收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/custom-dashboard` 路由可正常显示统计卡片、趋势图、分布图和最近告警区块

状态：**已完成** 说明：Milestone 3 的 custom-dashboard 路由所有权已开始从 legacy dashboard view 收敛到 overview domain 页面本身。

### 58. log-center 页面所有权开始从 legacy log center view 收敛到 logs domain

关联前端文件：

- `../StarLight/src/domains/logs/pages/LogCenterPage.tsx`
- `../StarLight/src/views/homeWindow/log/index.tsx`

本轮联动结果：

- `log-center` 域页面不再直接依赖旧 log center view 作为实现承载层
- 旧 `log/index.tsx` 入口反向变为兼容层，domain 页面成为真实实现承载层
- Milestone 3 在 log-center 路径上的页面归属进一步向 logs domain 结构收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/log-center` 路由可正常显示核心指标、Top 服务、级别分布和最近日志区块

状态：**已完成** 说明：Milestone 3 的 log-center 路由所有权已开始从 legacy log center view 收敛到 logs domain 页面本身。

### 59. billing 页面所有权开始从 legacy billing view 收敛到 admin domain

关联前端文件：

- `../StarLight/src/domains/admin/pages/BillingPage.tsx`
- `../StarLight/src/views/homeWindow/billing/index.tsx`

本轮联动结果：

- `BillingPage` 已补齐 `tab` query 同步逻辑，开始承载 legacy billing shell 的关键路由行为
- 旧 `billing/index.tsx` 入口反向变为兼容层，domain 页面成为真实实现承载层
- `/home/billing` 与 `/home/admin-billing-v2` 已开始共用同一份 domain-owned billing 实现

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/billing?tab=payment&orderId=o99` 可正常显示待处理支付订单，`/home/admin-billing-v2?tab=plans` 可正常显示套餐页与 `Growth` 计划

状态：**已完成** 说明：Milestone 3 的 billing 路由所有权已开始从 legacy billing view 收敛到 admin domain 页面本身。

### 67. billing usage / plans / payment 子实现已迁入 admin domain

关联前端文件：

- `../StarLight/src/domains/admin/pages/BillingPage.tsx`
- `../StarLight/src/domains/admin/components/billing/*`
- `../StarLight/src/views/homeWindow/billing/usage.tsx`
- `../StarLight/src/views/homeWindow/billing/plans.tsx`
- `../StarLight/src/views/homeWindow/billing/payment.tsx`

本轮联动结果：

- `BillingPage` 不再依赖 legacy `billing/usage|plans|payment` 作为真实实现
- 三个 billing 子页实现已迁入 admin domain 组件树，旧文件反向变为兼容层
- billing 的所有权从“页面 owner 已切换”推进到“子实现也完成迁移”

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/billing` 与 `/home/admin-billing-v2` 的 payment/plans 子页都可正常显示

状态：**已完成** 说明：billing 的实现模块也已从 legacy billing view 收敛到 admin domain 结构。

### 90. billing usage trend 已接回真实 quota.history 合约

关联前端文件：

- `../StarLight/src/api/subscription.ts`
- `../StarLight/src/domains/admin/components/billing/UsageTab.tsx`

本轮联动结果：

- frontend 已开始调用 `subscription.v1.quota.history`
- billing usage 页不再只显示空白 Usage Trend 图表，而会使用后端历史配额数据填充图表

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过

状态：**已完成** 说明：billing usage 页的趋势图已从占位态收敛到真实 quota history 合约。

### 91. subscription methods 已补齐 quota.history 所需运行时方法

已修改文件：

- `src/apps/starlight/subscription/methods/index.ts`

本轮实现内容：

- methods 层新增 `getQuotaUsageHistory()`
- methods 层新增 `generateQuotaStats()`
- `subscription.v1.quota.history` 与 `subscription.v1.quota.forecast` 不再依赖缺失方法

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：`v1.quota.history` 返回完整 `history/stats/timeRange/total/limit/offset/hasMore` 结构

状态：**已完成** 说明：quota.history 已从“前端接线完成但后端方法缺失”收敛到真正可执行的后端链路。

### 93. metrics.explorer 已作为新的读模型契约面落地

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`

关联前端文件：

- `../StarLight/src/api/metrics.ts`
- `../StarLight/src/domains/metrics/pages/MetricsExplorerPage.tsx`
- `../StarLight/src/domains/overview/pages/RealtimeMonitorPage.tsx`
- `../StarLight/src/domains/overview/pages/CustomDashboardPage.tsx`

本轮实现内容：

- metrics service 新增 `v1.metrics.explorer`
- 该动作复用现有 analysis 内容构造逻辑，但提供新的 explorer/read-model 契约面
- active frontend metrics 页面已切换到该新契约，而不再继续直接绑定 legacy `v1.metrics.analysis`

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过

状态：**已完成** 说明：metrics 页面在 contract 层已从 legacy analysis 端点进一步收敛到新的 explorer 读模型面。

### 75. instance-monitor 的假重启操作已收敛为诚实占位控件

关联前端文件：

- `../StarLight/src/domains/service/pages/InstanceMonitorPage.tsx`

本轮联动结果：

- active `instance-monitor` 页不再提供“确认后只弹假消息”的重启交互
- 在当前后端尚无真实实例重启契约的情况下，前端已改为禁用的“运维入口”占位控件
- 该路径的交互语义已与现有后端能力边界保持一致

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/instance-monitor` 页显示 `运维入口` 占位控件，不再显示可执行的“重启”动作

状态：**已完成** 说明：instance-monitor 的重启交互已从假操作收敛为诚实占位状态。

### 60. active 日志/告警入口已切到收敛后的域页面路由

关联前端文件：

- `../StarLight/src/layout/left/index.tsx`
- `../StarLight/src/domains/service/pages/ServiceDetailPage.tsx`

本轮联动结果：

- 当前侧边栏“日志中心”入口不再指向 `/home/logs-v2`，而是改为 `/home/log-center`
- 当前侧边栏“告警列表”入口不再指向 `/home/alerts-v2`，而是改为 `/home/alert-list`
- `service-detail-v2` 中的日志/告警快捷入口与“告警历史”入口也同步改为走已收敛的域页面路由

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/log-center`、`/home/alert-list` 与 `service-detail-v2` 对应入口均可正常显示

状态：**已完成** 说明：日志中心与告警列表的 active 导航入口已不再绕开已收敛的新 owner 页面。

### 61. admin-ingestion-v2 页面所有权开始从 legacy ingest view 收敛到 admin domain

关联前端文件：

- `../StarLight/src/views/homeWindow/log/ingest.tsx`
- `../StarLight/src/domains/admin/pages/IngestionPage.tsx`

本轮联动结果：

- `admin-ingestion-v2` 不再由 legacy log ingest view 承载真实实现
- 旧 `log/ingest.tsx` 入口反向变为兼容层，admin domain 页面成为真实实现承载层
- 管理侧接入管理路径的页面归属进一步向 admin domain 结构收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/admin-ingestion-v2` 路由可正常显示 AppKey 概览与列表

状态：**已完成** 说明：admin-ingestion-v2 的页面所有权已开始从 legacy ingest view 收敛到 admin domain 页面本身。

### 77. admin-ingestion-v2 已切到真实 AppKey / ingestion-status 合约

已修改文件：

- `src/apps/starlight/metrics/actions/appkey.ts`

关联前端文件：

- `../StarLight/src/domains/admin/pages/IngestionPage.tsx`
- `../StarLight/src/api/metrics.ts`
- `../StarLight/src/api/url.ts`

本轮实现内容：

- metrics service 新增 `v1.appkey.ingestionStatus`
- admin ingestion 页已停止使用 admin snapshot 伪装出的服务列表作为 AppKey 数据源
- 前端改为使用真实 `appkey.list / generate / verify / delete` 合约，并消费新的 ingestion status 汇总结果

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/admin-ingestion-v2` 显示真实 AppKey 列表与接入状态概览，点击“生成 AppKey”会命中 `/api/metrics/v1/appkey/generate`

状态：**已完成** 说明：admin-ingestion-v2 已从“语义错误的服务列表”收敛到真实的 AppKey / ingestion-status 管理合约。

### 78. appkey.verify 已校验真实 AppKey / AppSecret 配对关系

已修改文件：

- `src/db/mysql/apis/apiKey.ts`
- `src/apps/starlight/metrics/actions/appkey.ts`

联动前端文件：

- `../StarLight/src/domains/admin/pages/IngestionPage.tsx`

本轮实现内容：

- 新增 `findApiKeyByPair(keyHash, keyPrefix)` 数据库查询
- `v1.appkey.verify` 不再仅按 secret hash 查找，而是改为 secret hash + AppKey 前缀联合验证
- 管理页“验证凭证”现在可真实校验用户提交的 AppKey / AppSecret 是否匹配同一条凭证记录

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：匹配对返回 `200 / valid=true`，不匹配对返回 `401 / AppKey或AppSecret不匹配`

状态：**已完成** 说明：admin ingestion 的凭证验证已从“只验 secret”收敛到“验证完整 key/secret 对”。

### 79. admin-ingestion 生成后会保留完整 AppKey / Secret 供用户复制

关联前端文件：

- `../StarLight/src/domains/admin/pages/IngestionPage.tsx`

本轮联动结果：

- 生成 AppKey 成功后，前端不再只短暂依赖模态框上下文显示 Secret
- 页面会保留一块“最近生成的凭证”区域，展示完整 `AppKey` 和 `AppSecret`
- 这让新接入的真实 `appkey.generate` 契约在 UX 上也真正可用，而不只是后端动作可用

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/admin-ingestion-v2` 点击“生成 AppKey”后会命中 `/api/metrics/v1/appkey/generate`，并在页面中显示完整的 `AppKey`/`AppSecret` 对

状态：**已完成** 说明：admin-ingestion 的生成凭证体验已从“结果易丢失”收敛为可直接复制的页面持久展示。

### 80. payment handler 已停止返回伪造 provider 原生响应结构

已修改文件：

- `src/apps/starlight/subscription/utils/payment-handler.ts`

本轮实现内容：

- Stripe / PayPal / Alipay 三条支付处理分支不再返回伪造的 provider-native response 结构
- 当前无真实 SDK 会话时，统一返回本地 manual review 响应：`{ provider, mode: 'manual_review', supported: false, transactionCreated: false, amount, currency, reason }`
- 支付处理链路的 pending/manual review 语义已与当前真实能力边界保持一致

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：Stripe / PayPal / Alipay 三条路径均返回统一的 manual-review payload，且不再包含伪造的 provider-specific response 字段

状态：**已完成** 说明：subscription payment handler 的 provider 响应语义已从“仿真原生 payload”收敛为诚实的 local/manual-review 合约。

### 81. payment handler webhook 校验已改为真实签名验证

已修改文件：

- `src/apps/starlight/subscription/utils/payment-handler.ts`

本轮实现内容：

- `verifyWebhookSignature()` 不再只是检查 `signature + secret/key` 是否存在
- Stripe 改为基于 `STRIPE_WEBHOOK_SECRET` 和 payload 计算 HMAC
- PayPal 改为基于 `PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID` 和 payload 计算签名
- Alipay 改为基于 `ALIPAY_PUBLIC_KEY` 和 payload 摘要验证

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：Stripe / PayPal / Alipay 三条路径都满足“正确签名=true、错误签名=false”

状态：**已完成** 说明：payment-handler 的 webhook 入口已从“配置存在即通过”收敛为真实签名验证。

### 82. payment handler refund 路径已停止伪造 completed 结果

已修改文件：

- `src/apps/starlight/subscription/utils/payment-handler.ts`

本轮实现内容：

- `processRefund()` 不再在没有 provider refund 调用的情况下返回 `status: 'completed'`
- 当前退款路径统一改为诚实的 local/manual-review 合约：`status: 'manual_review'`, `supported: false`, `transactionCreated: false`

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：`processRefund(...)` 返回 `manual_review` 且包含 `supported=false / transactionCreated=false`

状态：**已完成** 说明：payment-handler 的退款语义已从“伪装已完成退款”收敛为诚实的 manual-review 状态。

### 83. appkey.list 已返回真实 usageCount 统计值

已修改文件：

- `src/apps/starlight/metrics/actions/appkey.ts`

关联前端文件：

- `../StarLight/src/domains/admin/pages/IngestionPage.tsx`

本轮实现内容：

- `v1.appkey.list` 不再为每个凭证固定返回 `usageCount: 0`
- 列表响应改为通过现有 `getApiKeyTotalStats()` 读取真实累计请求数并填充 `usageCount`

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：`v1.appkey.list` 返回条目中的 `usageCount` 已为真实聚合值（示例 `42`），不再固定为 `0`

状态：**已完成** 说明：admin-ingestion 的 AppKey 列表已从“usageCount 全为 0”收敛到真实统计值。

### 84. logs API key usage stats 已停止返回随机 dailyUsage 曲线

已修改文件：

- `src/apps/starlight/logs/methods/api-key-management.ts`

本轮实现内容：

- `getApiKeyDailyUsage()` 不再生成随机 usage 曲线
- 在当前缺少真实 usage-history 数据源时，接口返回空 `dailyUsage` 数组而不是伪造统计值

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：当 `ApiKeyStats` 有记录时，`getApiKeyUsageStats(...)` 返回真实 `dailyUsage` 数据；当源不可用时不再伪造随机曲线

状态：**已完成** 说明：logs API key usage stats 已从“随机模拟曲线”收敛为诚实的空结果语义。

### 85. logs 活跃 API key 校验路径已开始写入真实 usage 统计

已修改文件：

- `src/apps/starlight/logs/utils/api-key-manager.ts`

本轮实现内容：

- 活跃 logs API key 校验不再只更新内存中的 `lastUsedAt`
- DB-backed key 校验成功后，会调用 `updateApiKeyLastUsed()` 和 `updateApiKeyStats()`
- logs 运行时流量与 `getApiKeyUsageStats()` / `getApiKeyTotalStats()` 开始共享同一套统计来源

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：DB-backed `validateApiKey()` 调用会触发 `updateApiKeyLastUsed('key-1')` 与 `updateApiKeyStats('key-1', 1)`

状态：**已完成** 说明：logs API key 使用统计已从“不会被活跃请求更新”收敛到“活跃请求会真实驱动统计”。

### 86. logs methods 层的 validateApiKey 也已接回真实 usage 统计更新

已修改文件：

- `src/apps/starlight/logs/methods/api-key-management.ts`

本轮实现内容：

- `validateApiKey()` 不再错误地按 `findApiKeyById(hashedKey)` 查找
- 该方法改为使用正确的 DB-backed `findApiKeyByKey(hashedKey)`
- 校验成功后会同步写入 `updateApiKeyLastUsed()` 与 `updateApiKeyStats()`，与运行时校验路径保持一致

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：`validateApiKey(...)` 成功后会触发 `updateApiKeyLastUsed('key-1')` 和 `updateApiKeyStats('key-1', 1)`

状态：**已完成** 说明：logs API-key 的 methods 层验证面已不再绕开真实 usage 统计更新。

### 87. logs ApiKeyManager 已优先走 DB-backed 校验路径

已修改文件：

- `src/apps/starlight/logs/utils/api-key-manager.ts`

本轮实现内容：

- `ApiKeyManager.validateApiKey()` 不再优先命中 in-memory key 后立即返回
- 现在会先尝试 DB-backed `findApiKeyByKey()`，并在命中时执行 `updateApiKeyLastUsed()` 与 `updateApiKeyStats()`
- 只有不存在 DB 记录的内存开发 key 才会走本地 fallback 路径

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：DB-backed `validateApiKey('dk_live_secret_key')` 返回有效 key 信息并触发 `lastUsed/stats` 更新调用

状态：**已完成** 说明：logs API-key 的运行时校验路径已优先收敛到真实 DB-backed 使用统计链路。

### 88. API Key 底层存储已接回真实 tenantId / usageCount 语义

已修改文件：

- `src/db/mysql/models/api/apiKey.ts`
- `src/db/mysql/apis/apiKey.ts`
- `src/apps/starlight/metrics/actions/appkey.ts`
- `src/apps/starlight/logs/methods/api-key-management.ts`

本轮实现内容：

- `ApiKey` 模型新增并持久化 `tenantId`
- `countActiveApiKeysByTenantId()` 与 `findApiKeysByTenantId()` 不再忽略租户过滤
- metrics AppKey 创建路径开始写入 `tenantId`
- logs methods 层 `getApiKeys()` 不再返回 row 上的默认 `usageCount`，而是读取 `getApiKeyTotalStats()` 的真实聚合结果

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：
  - `v1.appkey.generate` 可带 tenant 上下文创建新 key
  - tenant-scoped `getApiKeys()` 返回的 `usageCount` 为真实聚合值（示例 `42`）

状态：**已完成** 说明：API Key 的 DB 层 tenant 语义和 usageCount 语义已收敛到真实存储/统计路径。

### 89. logs API key 管理面已补齐 tenant-scoped get/update/delete 行为

已修改文件：

- `src/apps/starlight/logs/methods/api-key-management.ts`

本轮实现内容：

- `getApiKeys()` 不再在 `userId` 分支绕开 tenant 过滤
- `updateApiKey()` / `deleteApiKey()` 不再只按 `id` 执行，而会同时校验 `tenantId` / `userId`
- logs API key 管理路径的 list/update/delete 现在与底层 tenantId 存储语义保持一致

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- 手动脚本验证：tenant-scoped `getApiKeys()` 仅返回目标 tenant 的 key；同 tenant update/delete 成功；跨 tenant update 被拒绝

状态：**已完成** 说明：logs API key 管理面已从“局部 tenant-aware”收敛到真正的 tenant-scoped 行为。

### 84. log-center 的实时流 tab 已改用真实服务目录筛选项

关联前端文件：

- `../StarLight/src/views/homeWindow/log/stream.tsx`

本轮联动结果：

- 实时流页不再使用硬编码服务名列表
- 前端已改为通过 `fetchCatalogServices()` 获取服务筛选项，与其它已收敛页面保持一致

验证结果：

- StarLight `npm run build` 通过
- 代码路径验证：实时流页的服务筛选会同步进入真实 SSE 请求参数，而不再只是本地列表过滤

### 85. log-stream 关键词过滤已接回真实后端 SSE 源头过滤

已修改文件：

- `src/apps/starlight/logs/actions/stream.ts`
- `src/apps/starlight/logs/utils/stream-manager.ts`
- `src/apps/starlight/logs/types/index.ts`

关联前端文件：

- `../StarLight/src/views/homeWindow/log/stream.tsx`

本轮实现内容：

- `LogStreamParams` 新增 `keywords`
- `v1.stream` 建连时会接受并注册关键字过滤条件
- `shouldForwardToStream()` 现在会在服务/级别之外对消息内容做关键字匹配
- 前端流过滤器同步后，关键词不再只是客户端事后筛选，而会在 SSE 源头生效

验证结果：

- `npm run build:fengyuServer` 通过
- `npx tsc --noEmit` 通过
- StarLight `npm run build` 通过
- 手动脚本验证：当 `keywords='error-keyword'` 时，SSE 响应只收到匹配该关键字的 `log` 事件

状态：**已完成** 说明：log-stream 的关键词过滤已从“前端假过滤”收敛到真实后端源头过滤。

状态：**已完成** 说明：log-center 实时流 tab 的服务筛选已从假目录收敛到真实服务目录源。

### 62. admin-onboarding-v2 页面所有权开始从 legacy onboarding view 收敛到 admin domain

关联前端文件：

- `../StarLight/src/domains/admin/pages/OnboardingPage.tsx`
- `../StarLight/src/views/homeWindow/onboarding/index.tsx`

本轮联动结果：

- `admin-onboarding-v2` 域页面不再只是旧 onboarding 页的壳层包装
- 旧 `onboarding/index.tsx` 入口反向变为兼容层，admin domain 页面成为真实实现承载层
- 管理侧接入向导路径的页面归属进一步向 admin domain 结构收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/admin-onboarding-v2` 路由可正常显示接入向导标题、五步流程和欢迎页内容

状态：**已完成** 说明：admin-onboarding-v2 的页面所有权已开始从 legacy onboarding view 收敛到 admin domain 页面本身。

### 63. admin-onboarding-v2 的实现模块已完全迁入 admin domain

关联前端文件：

- `../StarLight/src/domains/admin/pages/OnboardingPage.tsx`
- `../StarLight/src/domains/admin/pages/onboarding.scss`
- `../StarLight/src/domains/admin/components/onboarding/*`

本轮联动结果：

- onboarding step 组件与样式不再留在 legacy `views/homeWindow/onboarding` 树下
- `AdminOnboardingPage` 现在直接依赖 admin domain 内部实现模块，旧 onboarding view 仅保留兼容入口角色
- 管理侧接入向导路径的页面归属从路由层延伸到实现模块层，完成更彻底的 domain 收敛

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/home/admin-onboarding-v2` 路由可正常显示五步接入向导与欢迎页内容

状态：**已完成** 说明：admin-onboarding-v2 的实现模块也已从 legacy onboarding view 收敛到 admin domain 结构。

### 64. /onboarding 路由已直接指向 admin domain onboarding 页面

关联前端文件：

- `../StarLight/src/router/index.ts`

本轮联动结果：

- 根路由 `/onboarding` 不再经过 legacy onboarding wrapper
- 当前 onboarding 路由入口已直接指向 `AdminOnboardingPage`
- onboarding 的 route owner 与 implementation owner 现在在同一 domain 路径下闭合

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：`/onboarding` 路由可正常显示五步接入向导与欢迎页内容

状态：**已完成** 说明：onboarding 在路由层对 legacy wrapper 的最后一处主动依赖已去除。

### 65. service-overview 对 dashboard 的非路由依赖已收敛到 domain owner

关联前端文件：

- `../StarLight/src/views/homeWindow/service/overview.tsx`

本轮联动结果：

- `service-overview` 不再 import legacy `monitor/dashboard` wrapper
- 当前服务概览入口改为直接依赖 domain-owned `CustomDashboardPage`
- dashboard 在非路由调用链中的最后一处 legacy wrapper 直连依赖已去除

验证结果：

- StarLight `npm run build` 通过
- 手动浏览器 QA（Tauri bridge mock）验证：访问 `/home/service-overview` 仍正常进入当前系统概览主路径

状态：**已完成** 说明：dashboard 的非路由调用链也已进一步向 domain owner 收敛。

### 114. overview trends 契约补齐为真实 read-model 接口

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`
- `../StarLight/src/api/url.ts`
- `../StarLight/src/api/metrics.ts`

本轮接入内容：

- metrics 新增 `v1.overview.trends`，补齐 `GET /api/overview/v1/trends` 在当前 metrics 公共路径下的真实后端落点
- 输出结构与 contract 保持一致：`requests / errors / latency` 三组时间序列
- StarLight 同步补齐 `metricsOverviewTrends` URL 与 `fetchOverviewTrends()` API wrapper，供后续页面切换到新契约时直接复用

验证结果：

- `npm run build:fengyuServer` 通过
- `npm run build` 通过
- 手动 QA：使用 `node -r ts-node/register/transpile-only -r tsconfig-paths/register -e` 直接调用 `v1.overview.trends` 的底层构造逻辑，确认返回对象包含 `requests / errors / latency` 三组数组

状态：**已完成** 说明：Phase 2 的 overview 契约缺口已进一步补齐，overview 读模型现在除 summary/incidents 外也具备 trends 输出。

### 115. catalog service quick-view 契约补齐为真实 read-model 接口

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`
- `../StarLight/src/api/url.ts`
- `../StarLight/src/api/metrics.ts`

本轮接入内容：

- metrics 新增 `v1.catalog.service.quick-view`，补齐 `GET /api/catalog/v1/services/:serviceId/quick-view` 在当前 metrics 公共路径下的真实后端落点
- 输出结构与 contract 保持一致：`identity / redSummary / activeIncidentCount / instanceCount`
- StarLight 同步补齐 `metricsCatalogServiceQuickView` URL 与 `fetchCatalogServiceQuickView()` API wrapper，供后续服务目录/服务卡片快速摘要接入

验证结果：

- `npm run build:fengyuServer` 通过
- `npm run build` 通过
- 手动 QA：使用 `node -r ts-node/register/transpile-only -r tsconfig-paths/register -e` 直接调用 `v1.catalog.service.quick-view` 的 handler，确认返回对象包含 `identity / redSummary / activeIncidentCount / instanceCount`

状态：**已完成** 说明：Phase 2 的 catalog quick-view 契约缺口已补齐，目录路径现在除列表与详情外也具备轻量摘要输出。

### 116. catalog services summary 契约补齐为真实 read-model 接口

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`
- `../StarLight/src/api/url.ts`
- `../StarLight/src/api/metrics.ts`

本轮接入内容：

- metrics 新增 `v1.catalog.services.summary`，补齐 `GET /api/catalog/v1/services/summary` 在当前 metrics 公共路径下的真实后端落点
- 输出结构收敛到目录页当前所需的摘要数字：`total / healthy / degraded / critical / muted`
- StarLight 同步补齐 `metricsCatalogServicesSummary` URL 与 `fetchCatalogServicesSummary()` API wrapper，供服务目录页顶部摘要接入

验证结果：

- `npm run build:fengyuServer` 通过
- `npm run build` 通过
- 手动 QA：使用 `node -r ts-node/register/transpile-only -r tsconfig-paths/register -e` 直接调用 `v1.catalog.services.summary` 的 handler，确认返回对象包含 `total / healthy / degraded / critical / muted`

状态：**已完成** 说明：Phase 2 的 catalog services summary 契约缺口已补齐，服务目录页顶部摘要现在具备真实后端落点。

### 117. overview ingest-status 契约补齐为真实 read-model 接口

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`
- `../StarLight/src/api/url.ts`
- `../StarLight/src/api/metrics.ts`

本轮接入内容：

- metrics 新增 `v1.overview.ingest-status`，补齐 `GET /api/overview/v1/ingest-status` 在当前 metrics 公共路径下的真实后端落点
- 输出结构覆盖 overview 当前所需字段：`metrics / logs / traces / dropped / delayed / failed`
- StarLight 同步补齐 `metricsOverviewIngestStatus` URL 与 `fetchOverviewIngestStatus()` API wrapper，供 overview 页面接入采集状态区块

验证结果：

- `npm run build:fengyuServer` 通过
- `npm run build` 通过
- 手动 QA：使用 `node -r ts-node/register/transpile-only -r tsconfig-paths/register -e` 直接调用 `v1.overview.ingest-status` 的 handler，确认返回对象包含 `metrics / logs / traces / dropped / delayed / failed`

状态：**已完成** 说明：Phase 2 的 overview ingest-status 契约缺口已补齐，overview 页面现在具备接线入口。

### 118. overview risk-services 契约补齐为真实 read-model 接口

已修改文件：

- `src/apps/starlight/metrics/actions/realtime.ts`
- `../StarLight/src/api/url.ts`
- `../StarLight/src/api/metrics.ts`

本轮接入内容：

- metrics 新增 `v1.overview.risk-services`，补齐 `GET /api/overview/v1/risk-services` 在当前 metrics 公共路径下的真实后端落点
- 输出结构覆盖 overview 当前所需的高风险服务与最近退化服务两组列表
- StarLight 同步补齐 `metricsOverviewRiskServices` URL 与 `fetchOverviewRiskServices()` API wrapper，供 overview 页面替换本地近似排序逻辑

验证结果：

- `npm run build:fengyuServer` 通过
- `npm run build` 通过
- 手动 QA：使用 `node -r ts-node/register/transpile-only -r tsconfig-paths/register -e` 直接调用 `v1.overview.risk-services` 的 handler，确认返回对象包含 `highRiskServices / recentDegradedServices`

状态：**已完成** 说明：Phase 2 的 overview risk-services 契约缺口已补齐，overview 页面现在具备真实风险服务读模型入口。

## 当前未完成

- 后端主链路与前端 V2 新契约对接
- metrics / subscription / logs 之外更多 read-model 化能力扩展

## 下一步

1. 继续扩展后端 read-model 能力并让前端更多页面切到新契约
2. 在恢复的全量验证链路上持续要求 build + tsc 通过

## 完成标记规则

只有同时满足以下条件，任务才会标记为 **已完成**：

1. 功能已实现
2. 已完成测试或验证
3. 验证通过
