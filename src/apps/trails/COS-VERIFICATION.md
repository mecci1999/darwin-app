# Trails COS connectivity verification

`cos-verification.ts` is a server-only operational seam. It is not registered as a Trails action, does not accept request input, and is not a media, delivery, catalog, or commerce integration. It can issue exactly one `headObject` request for the configured fixed verification object and returns only `{ available, reason }`, where `reason` is one of `available`, `disabled`, `misconfigured`, or `unavailable`.

The feature is disabled unless `TRAILS_COS_ENABLED=true`. It accepts credentials only under local development or test (`NODE_ENV=development` or `test`). `static-env` requires `TRAILS_COS_SECRET_ID` and `TRAILS_COS_SECRET_KEY` and rejects `TRAILS_COS_SECURITY_TOKEN`. `sts-env` requires all three variables and passes its token only to the COS SDK as `SecurityToken`; the token must be short-lived. Neither is a production credential design: production enablement requires a separately reviewed server identity provider and implementation. Never put credential values in source control, logs, action responses, or browser configuration.

Run the local verification without starting Trails, the gateway, or infrastructure services:

```sh
pnpm run verify:trails:cos
```

It prints exactly one redacted JSON object and exits `0` only for `{"available":true,"reason":"available"}`. Every other state exits `1`. It never reads a dotenv file, accepts a bucket/key argument, or prints error details.

For local verification, set only the credential variables below in a protected server environment. The verifier has one reviewed fixed scope: `starlight-media-prod-1313219189` in `ap-guangzhou`, checking only `masters-private/cos-validation/master-test.jpg`. Bucket, region, and object key are intentionally not configurable. The bucket remains private; this module does not list, create, read, delete, sign, or change ACLs for any COS object.

```dotenv
TRAILS_COS_ENABLED=true
TRAILS_COS_CREDENTIAL_PROVIDER=static-env
TRAILS_COS_SECRET_ID=set-only-in-protected-local-env
TRAILS_COS_SECRET_KEY=set-only-in-protected-local-env
```

For Tencent STS temporary credentials, use `TRAILS_COS_CREDENTIAL_PROVIDER=sts-env` and set all three returned fields in the protected process environment. The token is required, must be short-lived, and is passed only to the SDK as `SecurityToken`:

```dotenv
TRAILS_COS_ENABLED=true
TRAILS_COS_CREDENTIAL_PROVIDER=sts-env
TRAILS_COS_SECRET_ID=set-to-TmpSecretId
TRAILS_COS_SECRET_KEY=set-to-TmpSecretKey
TRAILS_COS_SECURITY_TOKEN=set-to-Token
```

## Ingestion versioning readiness preflight

`cos-ingestion-versioning-preflight.ts` is a separate unregistered, server-only, read-only boundary. It is disabled unless `TRAILS_COS_INGESTION_VERSIONING_PREFLIGHT_ENABLED=true`, accepts the same local development/test-only `static-env` or `sts-env` credentials, and never reads `TRAILS_COS_INGESTION_MAPPING_SECRET`. It calls only `getBucketVersioning` for one fixed bucket and region through a narrow injected client. It does not enable or construct an ingestion writer, change bucket versioning, ACLs, bucket configuration, objects, or runtime feature registration.

The immutable-key ingestion policy approves the explicit COS `Enabled` and `Suspended` statuses, as well as the explicit `NoSuchVersioningConfiguration` error (never enabled), returning `{ "eligible": true, "reason": "ready" }`. Malformed or unknown responses and every other error are not eligible. The returned status is redacted and never includes provider, bucket, region, credential, raw response, or error details. This preflight remains disabled in production pending a separately reviewed server identity design.

## Object-prefix contract

The trusted Photoshop ingestion seam writes master JPEGs only below the fixed private `masters-private/` prefix. Its physical COS key is an HMAC over the approved object identity and durable fence-token digest: a retry of the same master grant selects the same key, while a different fence token selects a different immutable key. It HEADs before and after its single PUT and accepts only an exact metadata/content match for an existing retry. It does not rely on `x-cos-forbid-overwrite`, list, read, delete, or overwrite an object.

`public-derivatives/` is reserved for a separately reviewed future publication worker and has no writer, delivery client, or public exposure in this application. `downloads-private/` and `print-private/` have no assigned Trails mapping: this code does not read, write, list, delete, or otherwise infer a purpose for either prefix. Private COS keys, locators, URLs, bucket details, and credentials remain absent from actions and responses.

## Production media-delivery guard

The verification CLI is intentionally development-only: its package command pins `NODE_ENV=development`. Production startup rejects legacy COS enablement, `static-env`/`sts-env`, credentials, security tokens, mapping secrets, and `TRAILS_MEDIA_PUBLIC_DELIVERY_BASE`. The media-publication foundation is disabled unless `TRAILS_MEDIA_PUBLICATION_ENABLED=true`, the exact `TRAILS_MEDIA_SERVER_IDENTITY_MODE=workload-identity` is present, and non-secret CDN distribution, COS bucket/region, and immutable public-derivative namespace identifiers are supplied. That validation does not create a COS client or delivery worker. Cloud-console setup must retain a private COS origin and authorize the CDN only for the immutable approved derivative namespace; do not make a bucket public or put credentials in browser configuration.
