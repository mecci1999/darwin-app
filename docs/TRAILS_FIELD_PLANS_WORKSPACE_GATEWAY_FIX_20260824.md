# Trails Field-Plan Workspace Gateway Fix

**Release time:** 2026-08-24 15:27 Asia/Shanghai

## Issue and Scope

The Gateway forwarded its internal route fields (`routeService`, `service`,
`version`, `action`) and fallback `userId` to Trails. The `v5.field-plans`
workspace request correctly accepts only `{}`, so authenticated Today-page
reads failed with `拍摄安排请求包含不允许字段`.

Only Gateway was replaced. No Trails container, database schema, migration,
user data, or infrastructure service changed.

## Release

- Previous Gateway image:
  `darwin-app:gateway-trails-shooting-workbench-amd64-20260822.3`
- First repair image:
  `darwin-app:gateway-field-plans-workspace-fix-amd64-20260824.1`
- Second repair image:
  `darwin-app:gateway-field-plans-workspace-fix-amd64-20260824.2`
- Third repair image:
  `darwin-app:gateway-field-records-workspace-fix-amd64-20260824.3`
- Fourth repair image:
  `darwin-app:gateway-trails-workspace-contracts-fix-amd64-20260824.4`
- Active Gateway image:
  `darwin-app:gateway-trails-native-contracts-fix-amd64-20260824.5`
- Image ID:
  `sha256:e7c3c38b4c421949af39a7260f795ebc27459b956e70abb51abfc26ec2727aed`
- Platform: `linux/amd64`
- Rollback: restore the previous `GATEWAY_IMAGE` value and recreate only
  `gateway` with `--no-deps --force-recreate`.

## Validation

- Gateway regression tests, Trails field-plan action tests, TypeScript check,
  and production build passed before release.
- The minimal image was built on the production host from the already-running
  Gateway image and verified to strip every internal route and fallback
  identity field from a workspace request.
- Gateway `/api/health`, `/api/ready`, and public HTTPS health checks returned
  HTTP 200 after recreation; restart count was zero.
- Registry inspection found all 23 expected services, including
  `trails-durable-field-plans`.
- The post-release Gateway log observation window contained no registration,
  startup, uncaught, or unhandled errors.

The first repair removed known route fields, but production traffic showed that
an additional Gateway transport field could still reach the action envelope.
The active image applies the protocol boundary instead: every v2-v5
Every native Trails route now has an explicit Gateway request-body allow-list:
weather and night-sky reads; photography knowledge, scenes and locations;
field plans, field records and field events. Parameterless workspace reads are
dispatched as `{}`; paged photography knowledge retains only `kind` and
`cursor`; field events retain only their documented fields. Identity remains in
trusted Gateway metadata.

The final acceptance step is an authenticated read from the installed iOS app:
open Today and use `重新读取` for shooting arrangements. It must return the
account-private workspace rather than the rejected-field error.
