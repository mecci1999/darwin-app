# Trails privacy, ownership, and retention policy

## Classification and ownership

All Trails records are tenant-scoped and owner-controlled. The service derives `tenantId`, `ownerUserId`, and administrator status only from `ctx.meta`; request parameters never establish identity. Same-tenant owners and administrators may perform workspace actions. Other users and tenants have no session access.

`ShootSession` is the private operating relation between existing Works, Hikes, Gear, and Finance records. It does not replace or embed those domains. Its hike, gear, work, and ledger links are format-validated opaque IDs in the development repository; durable foreign keys and referential migration work are explicitly deferred. Manually recorded current-balance snapshots are a distinct owner-private finance resource, never a ledger-derived value and never linked to sessions.

| Classification | Examples | Access and exposure |
| --- | --- | --- |
| Public, opt-in | Existing published portfolio and journal projections | Only explicit, whitelisted action projections may expose it. |
| Owner workspace | Session title, status, field observations, checklist, shot intent, generalized label | Owner or same-tenant admin only. No generic public projection exists. |
| Restricted owner-private | Exact latitude/longitude, future `plannedFor`, access notes, gear serials if later added, ledger links and all finance | Owner or same-tenant admin only; excluded from all public projections and generic sync. |

`publicLabel` is an owner-controlled generalized place name, not a coordinate substitute. It remains in the private session record in this foundation; no action publishes a `ShootSession`. A `published` session status means its internal work is complete, not that any session data is public.

## Lifecycle and authorization

The only allowed lifecycle transitions are table-driven: `planned -> in_field -> processing -> published -> archived`. `archived` is terminal and cannot reopen. Session creation starts private in `planned`; callers cannot choose ownership, visibility, or initial status. Creation, listing, and transitions are owner/admin workspace actions.

## Durable private publishing packages (v2)

`v2.publishing-packages.*` is a private creator-space, MySQL-backed manual-handoff workflow. It is available only when the durable lifecycle composes its store; it never falls back to the development in-memory repository. The effective owner is derived from trusted actor membership, never from request data, and scoped editors operate only in their assigned owner space.

Packages contain opaque source-work and media identifiers plus manual publishing metadata. They do not contain destination, UTM, public, or post URLs; OAuth, tokens, accounts, or platform IDs; scheduled work or side effects; media locators, keys, or buffers; or download/delivery configuration. `manually_published` is an internal human attestation only, requiring explicit confirmation and recording actor/time. The durable audit retains only actor, effective owner, mutation, operation, state transition, version, and time.

## Retention and sync

The in-memory development adapter has no durability or retention guarantee. Durable finance v2 entries and manually recorded balance snapshots are retained until ten years after the end of their server-observed calendar financial year: their immutable expiry is `January 1 UTC` of year `+11` (for example, a 2026 record expires at `2037-01-01T00:00:00.000Z`). The owner-only disposal action irreversibly redacts finance and snapshot payload fields in one private transaction, retaining only a non-reconstructive scope digest, fixed event type, policy version, timestamps, event ID, and outcome audit record. The audit excludes entry and snapshot IDs, financial values, currencies, descriptions, receipts, session IDs, and resource counts.

Sessions are excluded from public APIs, generic owner sync, and finance sync. The mobile boundary may persist local drafts/outbox states but makes no automatic network-sync claim. Finance entries and balance snapshots remain owner-only (including against same-tenant administrators and creator-space users) and separate from generic synchronization.
