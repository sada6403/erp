# POS Branch Hub 0.2.0

This package provides shared numbered holds, exclusive recall, verified SQLite
backups and opt-in billing snapshot replication to branch PostgreSQL. Existing
cloud inventory synchronization retains its current path. Read
`../docs/BRANCH_POSTGRES_WINDOWS.md` for the PostgreSQL Windows deployment,
changeable server addresses and the scope/limits of the billing replica.

Requires Node.js 22 or later. Keep this installation and its data outside the
cashier Electron installation and outside live network/OneDrive folders.

For a prebuilt distribution extracted to `C:\POSHubApp`:

```powershell
Set-Location C:\POSHubApp
npm.cmd ci --omit=dev
node scripts/create-branch-hub-config.cjs --branch-id "YOUR-EXISTING-BRANCH-UUID" --hub-url "http://192.168.10.10:4781" --output "C:\POSHubData" --terminals "T01,T02"
$env:POS_HUB_CONFIG = 'C:\POSHubData\hub.json'
npm.cmd start
```

The reserved IP must belong to the Hub PC. Use the existing branch UUID and
different terminal IDs. The generator refuses to overwrite an existing output
directory. Copy each terminal's generated `branch-hub-terminal.json` to that
terminal's active POS company workspace, next to `pos-erp.db`, then restart it.
Never replace an existing POS database with the Hub database.

Read `BRANCH_HUB_SETUP.md` in the prebuilt distribution (or
`../docs/BRANCH_HUB_SETUP.md` in the source checkout) for network configuration,
credentials, startup scheduling, offline ambiguity and restore safeguards.

`npm run build` is for the full source checkout only; prebuilt distributions
already contain `lib/` and require only dependency installation and `npm start`.

Cashier flow: F4 -> type your hold number -> Enter; F5 -> type that same number -> Enter.
Numbers stay unchanged after sync. Duplicate active numbers are rejected, and
a number can be reused after the previous hold is resumed. Upgrade both the Hub
and terminal application together for the manual-number lookup protocol.
