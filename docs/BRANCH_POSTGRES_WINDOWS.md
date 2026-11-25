# Windows branch server: SQLite + PostgreSQL billing replication

POS 2.11.0 / Branch Hub 0.2.0. One branch server and 1–5 independent POS terminals.

Each terminal keeps its existing company SQLite database. A terminal-local outbox
is installed when its branch Hub enrollment is activated. Invoice/header, item and
payment changes queue in the same SQLite transaction as the bill. The terminal
freezes complete snapshots before sending; retry sends exactly the same event.
The branch Hub acknowledges only after its own SQLite transaction commits. Its
background worker writes PostgreSQL and advances a separate durable checkpoint
only after PostgreSQL COMMIT. Restart or lost acknowledgement safely replays.
Only locally created checkout/installment/SmartBuy invoices are claimed by a
terminal. Cloud-downloaded invoices are not re-originated by every terminal.
Pre-enrollment history and spreadsheet imports are not automatically backfilled;
a separately reconciled authoritative historical export is required for those.
Updates made on another terminal reach the owning terminal through existing
cloud sync before that owner can replicate the updated snapshot.

PostgreSQL contains `branch_pos_events` (immutable delivery history),
`branch_pos_invoices` (current complete invoice/items/payments JSONB snapshots),
and `branch_pos_identity` (one branch per database). This is a branch billing
replica, **not a replacement for the cloud MySQL schema or a shared stock
reservation service**. Products, purchases, users and existing stock cloud sync
remain on their existing path. PostgreSQL does not authorize wallet/coupon spending
or prevent two disconnected cashiers selling the last stock unit. Those require
a separate stock/wallet authority rollout. Do not use this release to claim full
ERP PostgreSQL migration or guaranteed offline stock consistency.

## Install on the branch Windows server

1. Install supported Node.js (22 or later) and PostgreSQL from their official
   Windows installers. Run the Hub on the same server as PostgreSQL. Keep
   PostgreSQL bound to localhost; terminal PCs connect only to the Hub.
2. Create a dedicated PostgreSQL database and login for this branch using pgAdmin.
   Grant that login ownership of this database only. Never use the production
   cloud database or share one branch database across branches.
3. Extract the branch-server package into `C:\POSHubApp`, and run
   `npm.cmd ci --omit=dev` there. Put live data in `C:\POSHubData`, outside
   OneDrive, network drives and the Electron installation directory.
4. Use the existing ERP branch UUID to generate enrollment files:

```powershell
node scripts/create-branch-hub-config.cjs --branch-id "EXISTING-BRANCH-UUID" --hub-url "http://BRANCH-SERVER:4781" --output "C:\POSHubData" --terminals "T01,T02,T03,T04,T05"
```

`BRANCH-SERVER` is the Windows server's actual computer/DNS name. It must resolve
from all five terminals. DHCP can change its IP without editing the terminal URL
when Windows/DNS resolves the same computer name correctly. For a changing server
IP, set the generated `hub.json` host to the current LAN IP, or `0.0.0.0` when
listening on all interfaces is intended. Limit inbound TCP 4781 in Windows
Firewall to the branch's private LAN. Do not expose it publicly. TLS is supported
through the existing reverse-proxy deployment described in BRANCH_HUB_SETUP.md.

5. Create a private `C:\POSHubData\branch.env` using a local editor, with keys:
   `POS_HUB_CONFIG=C:/POSHubData/hub.json` and
   `POS_BRANCH_POSTGRES_URL=postgresql://BRANCH_LOGIN:ENCODED_PASSWORD@127.0.0.1:5432/BRANCH_DATABASE`.
   Replace placeholders locally; URL-encode reserved password characters. Restrict
   the file to the service account/Administrators. Never put it in email, sync,
   source control or screenshots. The cashier receives no PostgreSQL credentials.
6. Start the service:

```powershell
Set-Location C:\POSHubApp
node --env-file=C:\POSHubData\branch.env lib/cli.js
```

Use Windows Task Scheduler to run that command at startup under the account that
owns these files, with working directory `C:\POSHubApp` and restart-on-failure.
Store environment values in the private file, not in task arguments.

## Enroll terminals / change address

Back up each existing terminal with POS Backup first. Install POS 2.11.0. Copy
only its own generated `T01`–`T05\branch-hub-terminal.json` next to that terminal's
active `pos-erp.db`, then restart POS. Never copy a billing DB or terminal sidecar
from another cashier. Each terminal automatically uses its own ID in new invoice
numbers. Existing invoice numbers remain unchanged; pre-existing cross-terminal
number collisions are retained for operator repair instead of silently merged.

Admin → Sync Monitor shows LAN status, queued terminal snapshots, PostgreSQL
connection and PostgreSQL backlog. Change **Branch server address → Save address**,
then restart POS. Branch identity, terminal ID, credentials and queues are retained.
An address change does not grant access to a different branch: the target must
have the same branch and enrolled credential. A private configuration backup is
created before every change.

Without the app UI:

```powershell
node scripts/set-branch-hub-url.cjs "PATH-TO-ACTIVE-WORKSPACE\branch-hub-terminal.json" "http://NEW-SERVER:4781"
```

## Verification and rollout

Test one cashier before enrolling the other four. Use test invoices and a test
company, verify the complete snapshot in PostgreSQL, stop PostgreSQL and ensure
LAN billing continues with increasing PG backlog, then restart and verify drain.
Disconnect LAN, make a test sale, reconnect, and check one invoice identity in
both Hub SQLite and PostgreSQL. Verify cancellation and later payments replicate.
The automated suite exercises SQLite, authenticated LAN and an isolated PGlite
PostgreSQL engine; actual Windows PostgreSQL service/network/pg-driver validation
is still required on the intended branch machine before production activation.

Existing cloud synchronization stays enabled. Hub's `cloud: not_configured`
describes its separate future cloud forwarding path, not terminal cloud sync or
the branch PostgreSQL connection.

## Backup, retention and rollback

Use PostgreSQL backups (`pg_dump` through pgAdmin's saved connection) plus the
Hub's verified SQLite online backups and each terminal's regular POS backups.
Keep credentials separate. Monitor disk capacity: event history is intentionally
retained and no automatic deletion policy is enabled in this release.

To pause PostgreSQL delivery, stop Hub, remove its PostgreSQL environment key,
and restart; Hub/terminal SQLite queues remain. Restore the key to replay later.
To roll back the desktop, back up first, stop POS, keep all branch_* tables,
sidecars and config backups, and install the previous installer. Never DROP the
outbox or restore an older billing DB over newer bills. PostgreSQL tables are
additive and need no destructive down migration. Re-enable the newer desktop to
resume pending replication. For a complete disable, remove the terminal enrollment
file after backup and restart, retaining the outbox until reconciliation.

No branch server has been installed or production PostgreSQL migration executed
by the development checks. No real invoices are created by these tests.
