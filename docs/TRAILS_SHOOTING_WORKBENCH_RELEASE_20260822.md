# Trails Shooting Workbench Production Release

**Release window:** 2026-08-22 23:01-23:30 Asia/Shanghai

## Scope

- Shooting plan API `v5`, structured field records, append-only field-record events, shooting guides, and custom shooting scenes.
- Database migrations `048-trails-shooting-knowledge-v1` through `051-trails-field-record-audit-owner-version-index-v1`.
- Trails action sharding and Gateway route/readiness updates for the added shooting-workbench endpoints.

## Data Safety

- MySQL backup completed before migration:
  `/opt/darwin-app/shared/releases/trails-shooting-workbench-amd64-20260822.1/mysql-before-048-051-trails-shooting-workbench.sql.gz`
- Backup SHA-256:
  `0bd0e0abbaca9d7ce2b5834ad304ee94bb0f1f873d366fbea260dd33bec0f166`
- Migrations are expand-only. Schema verification confirmed the seven new workbench tables, `TrailsShootingKnowledge.scenes_json`, and the expected indexes.

## Deployment

- Final Trails image: `darwin-app:trails-shooting-workbench-amd64-20260822.3`
- Final Gateway image: `darwin-app:gateway-trails-shooting-workbench-amd64-20260822.3`
- Shared image ID: `sha256:9237d78ad244aba3b57ad30f13b6d0b857755def04eb7b1540b8f554aa818017`
- Platform: `linux/amd64`
- Only `trails` and `gateway` were recreated. MySQL, Kafka, Zookeeper, Redis, InfluxDB, Elasticsearch, other applications, and volumes were not restarted or modified.

The initial candidate was rejected because `trails-durable-sales` exceeded the Node-Universe 29-action limit. Trails was immediately restored to the previous healthy image. The final release moves plan actions to `trails-durable-field-plans` and shooting records, timeline, guides, and scenes to `trails-durable-shooting`; all nine Trails shards now remain within the limit.

## Validation

- Gateway `/api/health` and `/api/ready`: HTTP 200.
- Trails and Gateway: healthy, restart count 0.
- Registry inspector: 23/23 expected services, including both new Trails shards.
- Unauthenticated public-route probes for plans, records, events, guides, and scenes returned 401 rather than 503 or a service-registration error.
- 90-second Gateway and Trails log window contained no service-registration, start, uncaught, or unhandled errors.

Authenticated read-only workspace probes remain an operational follow-up because no isolated production test token and plan ID were provided during this release.

## Rollback

- Trails: `darwin-app:trails-today-field-record-amd64-20260822.3`
- Gateway: `darwin-app:gateway-today-field-record-routing-amd64-20260822.3`
- Protected pre-release environment copy and database backup remain in the release directory above.
