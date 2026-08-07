# 星迹 Trails 微服务架构

## 范围与当前阶段

`trails` 是星迹的业务边界，负责公开作品集、日记、个人资料/安全联系链接、访客簿与内容留言，以及私有移动端行程、装备、负重和财务台账的 API 合约。服务通过现有动态网关暴露 `trails.v1.*`（例如 `/api/trails/v1/overview`）；不会修改网关、认证、用户或文件服务。

当前实现是可运行的**开发基础**：`InMemoryTrailsRepository` 仅为本地进程内存适配器，重启即丢失数据，不可视为生产持久化方案。数据库迁移、对象存储凭据和生产部署配置明确不在本次范围内。

## 身份、租户与隐私安全

- 可信身份只能由 `ctx.meta.user` 和 `ctx.meta.tenantId` 解析；请求参数中的 `tenantId`、`ownerUserId` 永不参与授权或归属决定。
- 写入和工作台接口声明 `metadata: { auth: true }`。资源写入时强制使用当前 actor 的租户和用户；现存作品/日记发布仅允许同租户资源所有者，或 Darwin 粗粒度 `isAdmin` 角色。
- 公开作品集接口均为无认证只读，且查询条件固定为 `visibility=public` 与 `lifecycle=published`；即使按分类 slug 筛选也不能放宽这两个条件。公开分类还必须属于当前公开 owner，且为 `visibility=public`、`status=active`。公开地图永不返回私有轨迹，精确点位也会降至近似坐标。
- 作品分类是 owner-managed 持久化模型（`tenantId`、`ownerUserId`、`id`、`slug`、中文名称、描述、排序、可见性、状态与审计时间），而非动作分支中的标签。分类归属仅由 `ctx.meta` 的可信 actor 写入，调用方不能提供或变更归属。内存仓储仅为开发/演示预置山岳、海岸、旷野、星空、人与行旅摄影分类；生产 owner 创建和管理自己的分类。
- 分类归档使用 `status=archived` 而非删除，以保留既有作品的 `categoryId` 历史关联；归档分类不再出现在公开目录中，也不可分配给新草稿。未分类作品继续兼容。
- 可见性为 `public | private | unlisted`，生命周期为 `draft | published | archived`。发布只改变生命周期；公开条件始终同时检查两个状态。
- 财务没有公开端点。财务概览固定按当前 `tenantId + ownerUserId` 查询，即使管理员也不会通过该接口查看其他人的台账。收据只允许保存私有能力引用，不允许公开 URL。
- 公开个人资料仅包含展示名称、简介及服务端允许的安全联系链接；不能将私人邮箱、认证资料或所有者工作台字段投影到公开 API。联系链接必须由服务端受控配置，不接受访客提供的链接。
- 留言访客**不需要也不能创建 Darwin 账号**。提交必须包含显示名称、邮箱、受控预设 `avatarId` 和纯文本正文；邮箱只以最小化的规范化值保存在私有记录中，绝不作为 URL 标识符、公开字段或日志字段。任意头像 URL、HTML 正文及客户端指定归属/审核状态均被拒绝。
- 留言状态严格为 `pending-email-verification -> pending-approval -> approved | rejected`。邮箱提交不等于验证；公开列表只返回 `approved`，且再次验证父内容仍为 `visibility=public && lifecycle=published`。撤回、私有化或归档父内容时，其留言不可公开读取。
- 审核队列与审核动作仅允许当前所有者或同租户管理员。队列可含审核所必需的私有邮箱；不得将其复用为公开投影、通知日志或分析事件。
- 匿名提交必须经过 `CommentAntiAbuseService`。当前开发组合根故意 fail closed；生产实现必须连接可信限流/缓存、CAPTCHA 与反滥用策略，不能绕过此端口。

## API 边界

| 分组 | 动作 | 访问规则 |
| --- | --- | --- |
| 公开展示 | `v1.overview`、`v1.profile.public`、`v1.categories.public`、`v1.portfolio.public`、`v1.stories.public`、`v1.map.public`、`v1.comments.public` | 无认证、只读；个人资料仅含安全投影；分类仅返回当前公开 owner 的公开活跃目录，作品仅返回其已发布公开资源；留言只返回已审核且父内容仍公开发布的纯文本投影 |
| 匿名留言 | `v1.comments.submit`、`v1.comments.verify` | 无账号；提交由反滥用端口允许后创建 `pending-email-verification`；验证只接受不透明能力引用，开发期不发送邮件且不在提交响应中返回引用 |
| 留言审核 | `v1.comments.moderation-queue`、`v1.comments.moderate` | 已认证；当前所有者或同租户管理员；仅已验证的 `pending-approval` 可变更为 `approved` 或 `rejected` |
| 创作工作台 | `v1.workspace`、`v1.categories.workspace`、`v1.categories.create`、`v1.categories.update`、`v1.categories.archive`、`v1.categories.reorder`、`v1.portfolio.draft`、`v1.portfolio.publish`、`v1.journal.draft`、`v1.journal.publish` | 已认证；分类操作严格当前 owner |
| 徒步与装备 | `v1.hikes`、`v1.gear.packing-summary` | 已认证；当前所有者及其租户数据 |
| 财务 | `v1.finance.overview` | 已认证；严格当前所有者，无公开读取 |
| 发布包（开发基础） | `v1.publishing-packages.workspace`、`v1.publishing-packages.create`、`v1.publishing-packages.transition`、`v1.publishing-packages.measure`、`v1.publishing-packages.learn` | 已认证；仅可信 creator-space owner/scoped editor；仅内部元数据和人工交接，不提供公开读取、OAuth、自动发布、真实排程或媒体处理 |
| 耐久发布包（v2） | `v2.publishing-packages.workspace`、`v2.publishing-packages.create`、`v2.publishing-packages.transition`、`v2.publishing-packages.measure`、`v2.publishing-packages.learn` | 已认证；仅可信 creator-space manager；仅生命周期组合的 MySQL store 可用，缺失即 503 且不回退 v1；无公开动作、URL、OAuth、平台调用、排程、媒体存储/交付 |

`v1.hikes` 接受路线提供方、外部路线编号和可选私有几何。`v1.gear.packing-summary` 使用稳定装备库存的重量与数量计算库存重量，并返回打包计划保存时的重量快照；这避免后续修改库存重量后篡改历史计划。

`v1.categories.workspace` 返回当前 actor 的全部分类。创建、更新均校验小写连字符 `slug` 在该 owner 范围内唯一，且更新只允许名称、描述、slug、可见性与排序；`v1.categories.reorder` 只接受当前 owner 的活跃分类 ID。`v1.categories.archive` 永不删除已关联分类，而是保留历史 `categoryId` 并阻止后续草稿分配。

`v1.categories.public` 按 `sortOrder` 返回公开活跃目录。公开端点使用可信 `ctx.meta` actor 决定公开 owner；无 actor 的开发环境固定使用 `development-demo` owner。`v1.portfolio.public` 可选接收格式为小写连字符的 `categorySlug`，仅在该 owner 下对应公开活跃分类时按其内部 `categoryId` 过滤；未提供时保持该 owner 的全部公开作品行为。

发布包只可关联已经 `public + published` 的作品集，并从可信 `ctx.meta` 派生 tenant、creator-space owner 与权限；请求中的角色、owner 或 tenant 声明一律不参与授权。状态严格为 `draft → prepared → reviewed → approved → ready_manual_publish/scheduled → published → measured → learned`。批准前必须完成文案、媒体选择、权利、地点隐私、事实声明五项人工勾选；隐藏地点时含 GPS/路线提示、受限权利未披露、或存在未核验事实声明均会阻止批准。`scheduled` 只保存人工交接时间意图，`published` 需人工确认，两者都不会调用平台或后台排程。

Xiaohongshu 发布包固定 `manual_handoff`。Instagram 可以记录 `official_api_candidate`，但在未来完成官方 OAuth/平台政策能力前被拒绝进入 ready、scheduled 或 published，因而不会自动或 API 发布。包内的 AI 文案仅是 `ai-draft-requires-review` 标记的待人工审阅文本；当前没有 AI 提供方调用。导出变体是 crop/use intent 元数据，不创建文件、裁剪、上传或对象存储访问；不保存平台 token、凭据、cookie、会话或浏览器自动化数据。

UTM 只能由配置的精确 HTTPS origin 生成，source 只能为 `instagram` 或 `xiaohongshu`，medium 固定为 `social`。非 HTTPS、未配置 origin、带用户信息、重定向端点及 `next`/`redirect` 等重定向参数均拒绝，避免开放重定向。已人工发布后才可手工录入测量事件，后续学习结论必须标注 `low`、`medium` 或 `high` confidence。

v2 耐久发布包与上述 v1 合约隔离。它只保存不透明 `sourceWorkId`、媒体 ID 与人工交接元数据，状态严格为 `draft → prepared → reviewed → approved → ready_manual_handoff → manually_published → measured → learned`，没有 scheduled 状态。`reviewed → approved` 必须通过隐藏地点、受限权利披露、事实声明和五项批准检查；`manually_published` 需要显式人工确认，记录的 actor/time 仅为内部证明。每个写入以 `(tenant, actor, mutationId)` 重放保护、规范十进制 resourceVersion CAS 和同事务最小审计保护；审计不含文案、媒体、隐私/权利声明、请求原文、URL 或凭据。

## 媒体与存储演进

### 耐久媒体资产注册表（feature-gated）

私有 durable slice 可建立独立的资产注册表：主文件定位符仅作为服务器拥有的部署工件元数据保存，且永不出现在动作响应、事件、错误、日志或公开目录中。资产只接受 `grid-800`、`cover-1600` 与 `preview-2048` 三个已验证 `ready` 衍生物；三个安全不透明引用及正尺寸均存在后，owner 才能显式发布。所有 register/variant/publish 写入都使用独立的 `(tenant, trusted actor, mutationId)` ledger，在同一事务中保存输入指纹与安全结果投影；相同请求重放原结果，变更后的 mutationId 重用被拒绝。公开作品集最多保留不透明 `coverMediaId`；在单独审查的公共交付组合完成前，不存在公开目录 lookup，也不解析或暴露媒体图片、衍生物、URL、尺寸、定位符、对象键或能力。

注册表**仅保存元数据**：它不会联系 COS，不上传、派生、转码、扫描、提取 EXIF，亦不会配置 CDN、bucket 或 ACL，或签发下载/签名 URL。现有作用域公开分类/catalog 元数据保持可用；公共媒体交付明确延期且不受支持：没有 resolver、`TRAILS_MEDIA_PUBLIC_DELIVERY_BASE` 配置或 public media catalog，也不生成公共媒体 URL 或封面图片投影。未启用 durable registry 或其私有连接不可用时动作必须以 503 fail closed；不允许内存或本地存储回退。commerce 继续只保存不透明衍生物引用，公开 commerce DTO 不返回 URL。

### 可信 JPEG 衍生物处理器（未接入注册表或存储）

`utils/trusted-jpeg-processor.ts` 是一个纯服务端、纯内存的窄处理器。它只接受已由上游可信边界取得的 JPEG `Buffer`，先限制输入像素/通道并验证 JPEG、单页和正尺寸，再生成 `grid-800`、`cover-1600`、`preview-2048` 三种逻辑尺寸的 AVIF、WebP、JPEG 衍生物。每个衍生物都会独立解码、按 EXIF 方向旋转、转换到 sRGB，并以 `fit: inside` 和 `withoutEnlargement` 保持比例、不裁剪、不放大。重新编码不会调用 `withMetadata()`，因此不保留 EXIF、XMP 或嵌入 ICC 元数据；像素已转换为 sRGB，但输出不携带源 profile。

该处理器不读取或写入文件，不调用 COS/CDN/注册表/动作，也不返回原始 buffer、文件名、定位符、对象键、URL 或任何公开引用。它在九个编码全部成功后才返回；任一失败只会产生脱敏领域错误，绝不返回部分结果。未来存储或注册表阶段必须在这个处理器之外显式消费其内存结果，不能把它视为上传、投递或注册能力。

### 受信 Photoshop 网站发布包导入器（未接入处理或发布）

`utils/trusted-photoshop-publication-package-importer.ts` 是另一个独立的纯服务端、纯内存校验边界。它只接受四个字面量内存条目：`manifest.json` 和三个 `website/*.v1.jpg` 网站尺寸；额外、缺失、重复或经过路径/编码伪装的名称都会失败。它将完整 manifest 限制为窄 claims 投影，并以 Sharp 重新验证每张 JPEG 的类型、页数、通道、像素上限、方向后的尺寸、字节数和 SHA-256，按 grid/cover/preview 顺序返回原始内存 JPEG。

该导入器不读取文件、处理 ZIP/流或请求，不选择源图、不调用衍生物处理器，也不接触动作、注册表、COS、存储、上传、投递或发布。manifest claims 只是上游声明而非授权或完整性证明；任何失败均返回同一脱敏领域错误。

### 受信发布包衍生物编排（仅内存组合）

`utils/trusted-photoshop-package-derivative-orchestrator.ts` 仅在本地内存中组合上述两个既有可信边界：先完整导入并验证四个发布包条目，再按已验证结果中 `logicalRendition === 'preview-2048'` 精确选择 JPEG，而非依赖 manifest 声明、源资产身份或条目顺序。它只把该已验证 buffer 交给 JPEG 处理器，并返回窄 package claims（不含 source asset identity）、不含 buffer 的 preview 审计事实（逻辑尺寸、宽高、字节数、SHA-256）和处理器原样给出的九个衍生物。

编排器不是注册、存储、上传、COS/CDN、动作、HTTP、文件系统或公开发布能力；不会创建 URL、对象键、定位符或公开引用。导入、选择或处理任一步失败都会收敛为一个脱敏错误，并且绝不返回部分结果。

### 受信 Photoshop 衍生物暂存计划（存储前、未注册、未发布）

`utils/trusted-photoshop-derivative-staging-plan.ts` 消费已经完成验证和编码的 `TrustedPhotoshopPackageDerivatives`，并只在服务器内存中构造固定合约 `trusted-photoshop-derivative-staging-plan/v1`。它严格保留 rendition-first、codec-second 的九个槽位：`grid-800`、`cover-1600`、`preview-2048` 各自的 AVIF、WebP、JPEG；不会折叠 codec。每个暂存 artifact 只包含槽位、逻辑尺寸、codec、规范 MIME、尺寸、字节数、服务器重新计算并与处理器审计值核对的 SHA-256 和同一内存 buffer 引用。它验证九项均存在且无重复/未知项、buffer 非空、MIME/尺寸/字节数/哈希正确；任何失败都收敛为一个脱敏暂存错误且绝不产生部分计划。

暂存计划是**存储前、未注册、未发布且服务器私有**的数据，不能序列化、记录日志或作为 action/HTTP 响应返回。它仅投影已经收窄的 package claims 和不含原始 buffer 的 source 审计事实；不携带 asset、tenant、owner、mutation、状态、存储定位符、对象键、能力、URL、公开引用、derivative key 或 source asset ID。该模块不调用文件系统、流、COS/CDN、存储、注册表、动作、投递或 Sequelize；未来阶段必须在此边界之外显式、安全地消费暂存 artifact，且当前耐久注册表每个逻辑尺寸只表示一个引用，不能连接到此九 codec 计划。

## 多设备同步合约（开发基础）

同一个 Darwin 账号可同时在 iOS 与 Android 登录。每个安装实例生成并本地保存非秘密、稳定的 `deviceId`，它只用于变更诊断和幂等记录的来源标签，**不参与认证、租户或所有权判定**；服务端始终仅从 `ctx.meta.user` 与 `ctx.meta.tenantId` 取得可信 actor。

- `v1.sync.pull` 是认证后的拉取式变更流，接收可选 `cursor` 与 `scope`，返回稳定的 `nextCursor`、`updatedAt`、`resourceVersion` 和资源内容。普通 `scope=owner` 只返回当前 actor 的私有资源及可同步的公开资源变更，不返回任何财务；`scope=owner-finance` 是明确的本人专用财务范围，仍固定为当前 `tenantId + userId`。
- `v1.sync.push` 接收请求体中的 `mutationId`（重试时不变）、`deviceId`、资源 ID、`baseVersion` 和载荷。仓储按可信 actor 加 `mutationId` 缓存已完成结果，因此重复上传返回首次结果而不会重复写入。当前 JSON API 不要求也不强制执行通用 `Idempotency-Key` 请求头；调用方无法提供 `tenantId` 或 `ownerUserId`。
- 服务端以 `baseVersion` 做乐观并发检查。另一台设备已修改资源时，返回 `409`、`STALE_VERSION`、客户端的 `baseVersion` 与当前资源/版本；绝不静默覆盖，也不自动合并。客户端必须保留本地变更并让用户决定如何处理。
- 当前开发期仅实现作品分类的 push 验证路径；变更流为 pull cursor 合约，预留未来 push/WebSocket 仅作“数据可能已变更”的失效通知，不能取代重新 pull。

`InMemoryTrailsRepository` 的变更游标、资源版本和幂等结果缓存均随进程重启丢失，只用于开发契约联调。生产实现必须以事务持久化资源、变更日志、幂等记录和游标推进，且保证同一 owner 的过滤与版本检查原子执行。

当前媒体边界只保留私有元数据和不透明 ID/引用：原始照片或财务收据的私有对象键与能力引用不得出现在公开响应。公共媒体 catalog、封面图片投影、媒体 URL 和 CDN 交付均未实现；当前不签发真实 URL、不连接云凭据，也不复用现有公开文件服务来存放私有原件或收据。

建议按阶段演进：

1. **开发期（当前）**：仅持有媒体元数据/能力合约，使用内存仓储，H5 与未来 Tauri 客户端可先对接 API 模型。
2. **持久化期**：实现同一 `TrailsRepository` 接口的事务型数据库适配器，并在独立迁移中建立 `trails_portfolio_categories`、`trails_portfolios`、`trails_journals`、`trails_guest_comments`、`trails_media_assets`、`trails_map_places`、`trails_hikes`、`trails_gear_items`、`trails_packing_plans`、`trails_packing_plan_items`、`trails_finance_entries` 与 `trails_finance_receipts`。留言表须保存邮箱验证令牌的**耐久哈希**与 TTL，不保存可重放明文令牌；以 `(tenant_id, owner_user_id, subject_type, subject_id, status, created_at)` 建索引。作品集保存可选 `category_id` 外键；分类表保存 owner 范围、slug 唯一约束、`status` 和审计时间，归档行不得删除；业务资源表含 `tenant_id`、`owner_user_id`、可见性/生命周期（适用时）及相应索引。
3. **对象存储期**：引入独立存储端口，私有原件/收据写入私有前缀，并通过短时、资源绑定、审计过的下载能力发放。能力不能由客户端直接构造或复用。任何未来公共媒体交付必须经过独立审查；当前不定义或启用公共 catalog、媒体 URL 或 CDN 交付。
4. **运营期**：增加异步派生图任务、审计事件、软删除/保留策略、财务导出审批与密钥轮换。所有跨服务扩展以事件和 repository/storage 接口实现，避免耦合现有文件服务。

## 部署扩展点

服务入口沿用 Node-Universe 的 Kafka、Redis、日志转发和动作指标包装。`start:trails` 与 `start:trails:prod` 可独立运行；本次不改 Docker 或生产环境文件。生产化时应先替换内存仓储、配置独立缓存命名空间与数据库连接，再将服务纳入编排和健康检查；不得在未完成这些前提时宣称其具备持久化或私有文件生产能力。

## 留言生产门禁

当前 `developmentVerificationTokenReference` 仅是测试/开发用的不透明引用：不发送邮件、不记录到日志、不在 API 响应回显，且不能替代真实验证能力。公开开启留言前，必须完成：耐久哈希令牌与单次消费/TTL、缓存或边缘限流、SMTP/通知服务发送与失败处理、CAPTCHA/反自动化政策、审核操作审计、邮箱同意与保留/删除规则、内容举报/事件响应，以及覆盖邮箱泄漏、跨 owner 审核和父内容撤回的回归测试。
