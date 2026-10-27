# Agent session directory v1

The directory lists explicitly connected, real Claude/Codex sessions and explicitly managed ACP sessions. It does not
discover, create, resume, or execute a session. Question-CLI `join` registrations
are not directory entries. Existing task/question endpoints keep their previous
authorization rules; the native connector checks its exact session and workspace
again before executing an incoming task.

`GET /v1/identity` advertises `agent_session_directory_v1`. All directory endpoints
use the existing bearer credential, strict JSON, and no query parameters. POST/PUT
bodies are limited to 8 KiB. Unknown or missing fields are rejected.

## Identity and immutable binding

Publishing requires both `tasks:update` and `receipts:agent`, plus a non-revoked
paired device whose role is `agent`. An ordinary minted token is insufficient.
The server derives owner, producer and device ID from authentication, never the
body. Refreshing the paired credential retains all three identities.

`route` contains exactly `computer_id`, `agent_id`, `project_id`, `session_id`.
The first three use `[A-Za-z0-9_.-]{1,128}`. The session ID and all other UUIDs are
canonical lower-case UUID strings. The owner plus complete route identifies one
entry. The first publication permanently binds owner/computer ID to that device
and producer; another device cannot claim it, even after expiry or revocation.
The entry's producer, device, host kind and canonical workspace are immutable.
There is no implicit transfer or rename; a future explicit migration is separate.

`workspace` is a canonical absolute POSIX or Windows directory path, no control
characters, at most 2,048 UTF-8 bytes. The server validates path syntax; only the
authenticated native connector can verify it against the actual host cwd.
`label` is trimmed, contains no control characters, and is at most 64 characters
and 256 UTF-8 bytes. A new lease may update the label. At most 128 entries exist
per owner, including offline entries, so the directory remains bounded.

## POST /v1/agent-sessions

Every body has `action`, `request_id`, `instance_id`, and `route`. A connector
creates a fresh instance UUID for each process lifetime. UUIDs are identifiers,
not credentials. The additional fields depend on the action:

| Action | Required additional fields |
| --- | --- |
| `acquire` | `expected_generation`, `host_kind`, `workspace`, `label`, `observation` |
| `heartbeat` | `generation`, `lease_id`, `sequence`, `observation` |
| `release` | `generation`, `lease_id`, `sequence` |

`host_kind` is `claude`, `codex`, or `acp`. The `acp` kind uses an explicit managed route; its native session ID is held by the local connector. `expected_generation` is zero for the first
publication, otherwise the generation seen in GET. Acquire requires a successful
fresh native observation (`ready: true`). An existing lease must have expired or
been released. Matching the generation alone never permits a live takeover.
Acquisition creates a server UUID `lease_id`, increments generation, resets the
sequence to zero, and sets expiry to server time plus 60 seconds.

Heartbeat every 15 seconds. Heartbeat and release require the exact current
generation, instance and lease ID. Their positive safe-integer sequence must be
greater than the last accepted sequence; gaps are allowed, old values are not.
Heartbeat extends the lease to server time plus 60 seconds. Once expired, even
the same instance must acquire a new generation after a fresh native check.
Release immediately marks the lease offline. Neither operation removes the
route/computer binding or changes the user's default selection.

`observation` has exactly these fields:

```json
{
  "ready": true,
  "busy": false,
  "can_execute": true,
  "exact_turn_interrupt": true,
  "descendants_proof": false,
  "atomic_queue_append": true,
  "native_queue_expiry": false,
  "reason": null
}
```

Ready means that the connector just verified the actual native session and cwd.
It is not inferred from an adapter's static capabilities. Ready can be true while
`can_execute` is false, for example an unsupported native session; provide a
reason. Ready observations may use `busy: null` when the host has verified the
session but cannot yet determine whether a turn is active. In that case
`can_execute: true` requires `atomic_queue_append: true`; unknown busy must not
be advertised as idle. A non-ready heartbeat uses `busy: null`, false for all
capabilities, and a reason. All unavailable observations require a
reason; `reason` is null or `[a-z][a-z0-9_]{0,63}`, never free-form text.
`descendants_proof` and `native_queue_expiry` must remain false in v1.

Exact-turn interruption describes target selection, not proof that every child
process has stopped. Task `stopped` still requires the task-control evidence.
`can_execute` means the native input channel is available; it never overrides a
native Stop gate, permission check, model failure, or a later disconnection.

The response is HTTP 200:

```json
{
  "schema_version": "1.0",
  "server_id": "<server UUID>",
  "owner_id": "<authenticated owner>",
  "server_time": "<RFC3339>",
  "session": {
    "route": {"computer_id":"mac", "agent_id":"codex", "project_id":"project", "session_id":"<UUID>"},
    "producer_id": "<authenticated producer>",
    "device_id": "<paired device UUID>",
    "host_kind": "codex",
    "workspace": "/absolute/workspace",
    "label": "Codex",
    "generation": 1,
    "instance_id": "<connector UUID>",
    "lease_id": "<server lease UUID>",
    "lease_expires_at": "<RFC3339>",
    "online": true,
    "busy": false,
    "capabilities": {"can_execute":true,"exact_turn_interrupt":true,"descendants_proof":false,"atomic_queue_append":true,"native_queue_expiry":false},
    "reason": null
  }
}
```

## GET /v1/agent-sessions

Requires `tasks:read`; returns only the authenticated owner's entries:
`{schema_version, server_id, owner_id, server_time, sessions: [entry], default}`.
Entries are ordered by the canonical route, not by guessed recency or preference.
There is no automatic default or fallback.

Online is computed at read time: the device is not revoked, the lease is neither
released nor expired, and the last observation is ready. Offline entries have
`busy: null` and all effective capabilities false. Server offline reasons take
precedence: `device_revoked`, `lease_released`, `lease_expired`; otherwise the
connector's stable reason is retained. Reads do not renew leases.

## PUT /v1/agent-default

Requires `tasks:update` plus any non-revoked paired device (phone or agent).
The selection belongs to the owner, independent of the requesting phone's
producer. Body: `{request_id, expected_revision, route}`. Route is null to clear,
or an exact existing directory route which is online and can execute at the time
of selection. The first revision is zero with null route and null updated_at.
Each successful write increments revision. Concurrent changes use explicit CAS;
there is no last-writer overwrite.

Returns HTTP 200 `{schema_version, server_id, owner_id, server_time, default}`,
where default is `{revision, route, updated_at}`. Lease expiry, release and device
revocation do not clear a selection. A default may be offline and the client must
say so instead of silently routing to another session.

## Replay, persistence, and errors

Within one owner and paired device, `request_id` is durable for seven days across
token refresh and process/server restart, shared by POST and PUT. The server stores the method
and canonical-body digest with the committed original response. An identical
retry returns that exact response before checking current CAS/lease state and
does not renew a lease or reapply a selection. Reusing the ID with different
content returns `409 IDEMPOTENCY_CONFLICT`. An old ACK is historical, not a fresh
online observation; GET supplies current state. Authorization is always checked
before looking up a cached response.

Replay ACKs are pruned in bounded batches after seven days so periodic heartbeats
do not accumulate forever. Route bindings, generations, sequences and default
revisions are never pruned or reset. An old accepted request whose ACK has expired
still cannot replay: its expected generation/sequence/default revision is stale.
Original ACK retrieval and request-ID conflict detection are not promised beyond
that retention window. This registry never performs a native execution action.

Other errors: `400 INVALID_AGENT_SESSION` / `INVALID_AGENT_DEFAULT` for malformed
bodies; `403 FORBIDDEN` / `DEVICE_REQUIRED` for unauthorized callers;
`409 COMPUTER_BINDING_CONFLICT`, `SESSION_BINDING_CONFLICT`,
`SESSION_GENERATION_CONFLICT`, `SESSION_LEASE_ACTIVE`, `SESSION_LEASE_STALE`,
`SESSION_SEQUENCE_STALE`, `DEFAULT_REVISION_CONFLICT`, `DEFAULT_SESSION_UNAVAILABLE`;
`410 SESSION_LEASE_EXPIRED`; `404 AGENT_SESSION_NOT_FOUND`; and
`409 AGENT_SESSION_LIMIT` at 128 entries. All mutations and their replay records
commit in the same SQLite transaction. Unknown UUIDs never target another or the
latest session.
