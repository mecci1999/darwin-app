# Trails Shooting Location Version Fix

**Release time:** 2026-08-25 Asia/Shanghai

## Issue

The private shooting-location workspace could return an outer Gateway HTTP
`200` with an inner Trails failure. The affected MySQL `BIGINT`
`resource_version` value was deserialized as a JavaScript number, while the
location repository accepted only a decimal string. Creating a location worked,
but reading the same location failed during persistence normalization.

## Change

- `mysqlShootingLocation` now accepts lossless non-negative safe integers and
  `bigint` values in addition to canonical decimal strings, then continues to
  expose the public string version contract.
- Added repository coverage for numeric and bigint persisted versions.
- The iOS client now keeps validated API errors visible and aligns its native
  response limit with the 3 MiB location contract. Raw bridge and transport
  errors remain hidden behind a generic user-safe message.

## Data Safety

- No schema, migration, seed, or user-data operation occurred.
- Only `trails` was recreated. Gateway, infrastructure services, and all other
  application containers remained running.
- Previous Trails image retained for rollback:
  `darwin-app:trails-qweather-moon-phase-amd64-20260824.1`.

## Release

- Active Trails image:
  `darwin-app:trails-shooting-locations-version-fix-amd64-20260825.1`
- Image ID:
  `sha256:1f5d079b5be57afc79409057a5ac5548c3fb6aa8f8b0cadcc0dacee0ca9ca75d`
- Platform: `linux/amd64`
- Overlay input SHA-256:
  `72ec2f790bc29a9bae5a415b472608e176a7b9264b934a01b755bf02f03d08e4`

## Validation

- Focused Trails repository and action tests: 5/5 passed.
- TypeScript check and production server build passed.
- Trails container became healthy with restart count 0.
- Gateway health passed; unauthenticated private location route correctly
  returned `401` rather than an availability failure.
- Registry inspector found all 23 required services.
- Post-release Gateway and Trails log window contained no registration,
  startup, unhandled, or shooting-location version errors.

## Rollback

Restore `TRAILS_IMAGE` to
`darwin-app:trails-qweather-moon-phase-amd64-20260824.1`, then recreate only
`trails` with `docker compose ... up -d --no-deps --force-recreate trails` and
repeat the registry and route checks.
