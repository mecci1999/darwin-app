# Trails public-derivative publication worker

## Status and deployment boundary

This is an unregistered, one-shot foundation. It has no Node-Universe service, action, Gateway route, Docker Compose entry, scheduler, or default command. `TRAILS_MEDIA_PUBLICATION_ENABLED=false` remains the production-template default. Do not deploy or start it until workload identity, an authenticated private-locator resolver, a job source, a public COS object store, and the registry approver are independently reviewed and composed.

## Bounded operation

`runOneTrailsPublicDerivativePublicationJob` takes at most one job and returns `idle`, `published`, or `failed`; callers own any future schedule and must preserve maximum concurrency **one**. It retains no artifact array contents or image buffer: each required JPEG is opened once for streamed hash/metadata validation and once for a single streamed upload. COS PUT and HEAD calls have an abortable per-operation timeout (15 seconds by default); no unbounded polling or retry loop is included, which is appropriate for a 160 MB / 0.08 CPU worker allocation.

## Required production composition

The job source must return registry-derived opaque job IDs, asset IDs, approval IDs, private locators, and immutable public references. The resolver alone may map an opaque locator to private COS internally; it must reject URLs, paths, prefixes, traversal, and locator injection. The worker only asks it for JPEG streams and neither logs nor emits private locators, COS keys, bucket names, master/download/print prefixes, or URLs.

The credential provider must return only `{ mode: 'workload-identity' }` from the platform identity facility. This foundation deliberately supplies no static-environment, STS-environment, browser, or source-code credential implementation. The public object store must enforce the exact `public-derivatives/<opaque-reference>.jpg` key, private bucket access, no public ACL, `Content-Type: image/jpeg`, and `Cache-Control: public, max-age=31536000, immutable`.

## Safety and health signals

An `idle` result is healthy when no job is available. A `published` result means all three registry-required JPEGs passed private stream hash/metadata validation, were written and verified with the immutable metadata, and only then were submitted to `approvePublicDerivatives`. A `failed` result means approval was not attempted; operators should inspect only the redacted job/asset identifiers supplied to the logger, correct the dependency/configuration issue, and submit a new bounded run. Do not retry an ambiguous COS write automatically: immutable object-store and job-source implementations must provide their own reviewed recovery/idempotency behavior.
