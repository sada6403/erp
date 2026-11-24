# Branch Hub: install, operation and recovery

Implemented on 2026-11-22; manual cashier numbering updated 2026-11-23. This release enables shared branch holds and provides
an event-transport foundation. Existing sale/stock cloud synchronization is still
the old path: **billing is not yet routed through this Hub**. The Hub accurately
reports cloud as `not_configured`; its persistent event outbox has no cloud
delivery worker yet.

## Runtime and files

- `electron/branchHub/store.ts`: isolated SQLite WAL database, daily hold
  sequences, atomic hold consumption, replay journal, immutable transport events,
  stock-delta projection and persistent cloud outbox.
- `server.ts`: per-terminal authenticated REST, WebSocket notifications/heartbeat,
  daily verified online backup while the service is running.
- `client.ts`: terminal-local SQLite sidecar, persistent hold publication and
  recall journal, reconnect/backoff and cached shared hold list.
- `services/branchHubRuntime.ts`: optional per-company-workspace activation.
- `branch-hub/`: standalone **normal Node.js** package. Its SQLite native driver
  is installed separately from the Electron application's driver.

No existing POS schema is changed. Both the Hub and sidecar refuse to initialize
inside a non-Hub database, to catch an accidentally configured billing DB path.
Do not repoint an existing Hub database at a different branch or clone one
terminal identity onto another PC.

## Build and install

From `erp/` on the development machine:

```powershell
npm.cmd --prefix branch-hub ci
npm.cmd --prefix branch-hub run build
node scripts/smoke-branch-hub-package.cjs
```

Build uses the existing root TypeScript dependency. For deployment, copy
`branch-hub/package.json`, `branch-hub/package-lock.json` and the generated
`branch-hub/lib/` directory to the Hub PC, for example `C:\POSHubApp`. Install
Node.js 22 or later on that PC, then run `npm.cmd ci --omit=dev` in that directory.
The package was smoke-tested here with Node 25.9.0. Do not reuse Electron's
`node_modules` for the standalone Node service.

Connect all terminals and Hub to one router/switch. Reserve the Hub LAN IP in
DHCP, e.g. `192.168.10.10`. Permit inbound TCP 4781 on the Hub only from the
branch LAN. Keep the Hub data on a local disk outside live OneDrive/SMB folders.

Create configuration files from `erp/`:

```powershell
node scripts/create-branch-hub-config.cjs --branch-id "YOUR-EXISTING-BRANCH-UUID" --hub-url "http://192.168.10.10:4781" --output "C:\POSHubData" --terminals "T01,T02"
```

Use the actual `branches.id` associated with the cashiers' login, not merely the
branch's display name/code. `C:\POSHubData` must not already exist; the generator
refuses to overwrite an existing deployment. It creates random, different
credentials for each terminal without printing them.

Files produced:

```text
C:\POSHubData\hub.json
C:\POSHubData\T01\branch-hub-terminal.json
C:\POSHubData\T02\branch-hub-terminal.json
```

Run the Hub on its PC:

```powershell
Set-Location C:\POSHubApp
$env:POS_HUB_CONFIG = 'C:\POSHubData\hub.json'
npm.cmd start
```

The configured `host` binds to the reserved IP. For a local-only test generate
the configuration with `http://127.0.0.1:4781`. HTTP is intended for a trusted,
isolated branch LAN. For encrypted transport place a TLS reverse proxy in front
of the service, forward `/v1/` and WebSocket upgrades, and use an `https://` Hub
URL. HTTPS-generated configurations bind the internal service to loopback 4781.

Install the updated Electron app on each cashier. Copy only that cashier's
`branch-hub-terminal.json` to its **active company workspace directory**, next to
its `pos-erp.db`; never replace `pos-erp.db`. The existing Backup/Open Folder
action opens the workspace's `backups` subdirectory, so its parent identifies
the correct workspace without guessing the Windows application-data path.
Restart the cashier app after provisioning or changing this configuration.
Without a Hub configuration, new cashier-numbered holds are stored locally in
`numbered-held-carts.db`. Existing legacy holds remain visible.

For automatic Hub start, configure Windows Task Scheduler (or your service
manager) to launch the normal Node process at system startup with:

- Program: the full installed `node.exe` path.
- Arguments: `C:\POSHubApp\lib\cli.js`.
- Working directory: `C:\POSHubApp`.
- `POS_HUB_CONFIG=C:\POSHubData\hub.json` in the service account environment.
- Run without an interactive desktop; restart after failure.

Provision firewall, service account and scheduler on the actual Hub PC. This
patch does not register a service or alter this computer's network settings.
Keep the Hub configuration private: it contains all branch terminal credentials.

## Cashier behavior

1. F4 opens a number-entry field. The cashier types a number, e.g. `25`,
   then Enter saves the hold locally. Cancel/Escape keeps the current cart.
   Numbers contain 1?12 digits; leading zeros are preserved (`007` stays `007`).
2. With a configured Hub, the background client publishes that hold using its
   stable UUID. The displayed cashier number **does not change** after sync.
   Older automatically numbered holds remain readable for compatibility.
3. F5 opens the resume field. Type exactly the same number (`25`) and Enter to
   restore the bill, or select the hold using arrows. The number becomes
   available for another bill after the previous hold is resumed.
4. An active duplicate number is rejected on the terminal or atomically at the
   Hub. Across disconnected terminals a collision cannot be known in advance;
   after reconnect the rejected local cart is retained and flagged. Its owner
   can resume that local cart and hold it with another number. It never
   overwrites the other cashier's cart. Old holds are flagged rather than deleted.
5. Shared recall remains an atomic Hub consume operation. Exactly one terminal
   wins. The winning terminal saves the response in its local recall journal
   before returning it. A lost response can be recovered under F5; delivery is
   acknowledged after restoring the cart. A numeric lookup resolves the current
   active UUID first, so reusing a number does not replay an older bill.
6. Without a Hub, the separate local numbered-hold database provides the same
   number-entry/resume flow and duplicate protection on that PC. These local
   holds are not automatically transferred when a Hub is subsequently enabled.
   Existing legacy holds remain visible and are not automatically published.

The status strip distinguishes Hub Online/Offline, Hub cloud Not configured,
pending hold operations and recoverable recalls. This count is **not** the old
cloud billing queue count. The existing app cloud sync indicator is unchanged.

## Partition and recovery rules

A hold saved while the Hub is already unreachable remains local and can be
resumed locally. Its claim and local recall journal commit together.

There is an unavoidable ambiguity if the Hub committed publication but its
response was lost. That hold stays `publishing` and cannot be independently
resumed offline: another terminal could already have claimed it at the Hub.
Reconnect the original terminal; it resends the same UUID and reconciles with
the Hub. Never delete the sidecar or force the hold back to local to bypass this
protection. The UI labels this state "Awaiting Hub confirmation". A definite number-conflict
rejection is different: the Hub did not accept that cart, so its owner can
resume the preserved local copy and choose another number.

The same rule applies to a lost shared-recall response. A durable request UUID
lets the winning terminal retrieve its original cart after restart. A different
terminal receives a conflict, never another copy of that recalled hold.

After the renderer has acknowledged restoration, the active cart still uses the
existing in-memory cart store. Crash-safe persistence of the **active billing
cart** is separate remaining work; the recall journal does not claim to solve
crashes after that acknowledgement or after a later successful payment.

Terminals poll REST every three seconds while connected; failed connections use
exponential backoff capped around 15 seconds plus jitter. WebSocket change
notifications trigger earlier refreshes. The server sends ping heartbeat every
10 seconds and terminates unresponsive connections; clients reconnect. Product
search, add-item and payment do not use these network requests.

## Backup and restore

The CLI takes a verified SQLite online backup at startup. While running it checks
once per minute and takes another backup when the local business date changes.
Files go to `backupDirectory` from `hub.json` (relative to the config directory).
The database is first written as `.partial`, opened read-only and verified with
`PRAGMA integrity_check`; only an `ok` backup is renamed to `.db`. Failed partial
files must not be treated as valid backups. No automatic retention deletion is
performed. Arrange a daily copy of verified `.db` files to a second disk.

Back up `hub.json` separately and securely. Keep each terminal's sidecar and
configuration when recovering that terminal; losing its recall journal also
loses the durable request key needed to replay an ambiguous shared recall.

Restore procedure (owner approval required before replacing production files):

1. Fence/stop the old Hub; keep the failed DB, WAL and SHM files untouched.
2. Copy a verified backup to a **new directory** and use a copy of `hub.json`
   with `database` pointing there. Preserve the same branch ID and terminal keys.
3. Run integrity checks and compare hold/event cursors with your incident notes.
4. Bring up one writer only at the reserved Hub address. Terminals retry their
   unpublished/unacknowledged operations using stable IDs.
5. Reconcile consumed holds before reopening cross-terminal recall. A backup can
   predate a successful consume whose terminal has already acknowledged delivery;
   replay alone cannot reconstruct an acknowledged operation missing from the
   restored Hub. Restore to a new branch/number epoch or manually reconcile those
   tombstones; do not blindly treat every restored available hold as current.

There is no automatic secondary-Hub promotion. Safe failover requires fencing
and replicated acknowledged state; simply starting a second Hub would allow
split brain. Historical paid-bill numbering has not been migrated in this stage.

## REST/event protocol

All requests require `Authorization: Bearer <device-token>`, `X-POS-Terminal` and
`X-POS-Branch`. A Hub serves one fixed branch; other credentials are rejected.

| Endpoint | Behavior |
| --- | --- |
| `GET /v1/status` | Authenticated Hub identity, cloud configuration, pending event count and business date. |
| `GET /v1/holds/resolve?number=25` | Resolves the current active cashier number to its stable UUID before recall. |
| `GET /v1/holds` | Up to 500 available hold summaries; full carts only returned on successful recall. |
| `POST /v1/holds` | `{id, local_number?, payload}` with cashier number in `payload.hold_number`; same terminal/ID/payload returns the original assigned hold. |
| `POST /v1/holds/consume` | `{request_id, hold}`; hold is UUID, today's short number or stable terminal alias. Replay returns the original response to the winning terminal. |
| `GET /v1/changes?after=N` | Up to 500 append-only transport events in integer cursor order. |
| `POST /v1/events` | `{events:[{event_id,kind,payload}]}`; supported kinds `stock.delta` and `bill.paid`; whole batch commits or rolls back. |
| `GET /v1/ws` upgrade | Authenticated `hub.ready`/`hub.changed` notifications, ping/pong heartbeat. |

Event application, duplicate detection, stock projection and cloud outbox commit
in one SQLite transaction. Reusing an event ID with different content is rejected.
Paid event bill UUID/number are unique. `stock.delta` uses signed quantities and
up to six decimal places. These endpoints are a tested foundation: existing
invoice/purchase/return handlers do not publish into them yet. Hub balances start
at zero until an audited opening-stock import/cutover is implemented; never use
them as the current production inventory balance in this release.

The actual schema is in `store.ts` and `client.ts`. Terminal Hub state lives in
`branch-terminal.db`; unconfigured terminals use `numbered-held-carts.db`; Hub state lives in its separately configured `branch-hub.db`.

## Tests

```powershell
npm.cmd run test:hub -- --reporter=dot
npm.cmd run test:unit -- --reporter=dot
npm.cmd run typecheck
npm.cmd --prefix branch-hub run build
node scripts/smoke-branch-hub-package.cjs
```

Hub integration tests use temporary, separate SQLite databases and real loopback
HTTP/WebSockets for two terminals. They cover offline local recall, publication,
stable aliases, simultaneous recall, lost responses, restart, Hub down/up,
duplicate events, concurrent stock deltas, batch rollback, paid identity conflicts,
branch authentication, backup verification, timezone rollover, database safety
guards and live terminal connections. They do not certify real branch wiring,
cloud delivery or full Electron keyboard billing end-to-end.
