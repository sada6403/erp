# Smart Buy Sync Diagnosis — 2026-09-29

## Result

The Smart Buy Manager account is not blocked from synchronization by its role. The desktop background sync service starts independently of the logged-in user, runs shortly after app startup, and repeats approximately every minute.

This device is uploading successfully, but a complete cloud pull cannot finish because the cloud contains child records whose required parent records are missing. SQLite correctly rejects those rows with foreign-key errors. Because at least one pull table fails, the app does not advance its full-success timestamp and the Smart Buy dashboard remains empty or stale.

## Evidence from this device

- Installed desktop version: `2.7.14`.
- Source checkout version at diagnosis time: `2.7.13` (`d6d3d59`).
- Cloud connection settings, API key, and device ID are present; the device is not locked.
- The app continued updating its sync-cycle state while no user was logged in, proving that role permissions are not required for background sync.
- Local outbound queue: `59 synced`, `0 pending`, `0 failed`.
- A new audit-log upload was acknowledged by the cloud at `2026-09-29 17:59:29 Asia/Colombo`.
- Last complete sync: `2026-09-29 08:13:01 Asia/Colombo`.
- Current incomplete pull tables include invoices, invoice items, payments, Smart Buy schemes, members, contributions, wallet records, and commission records.

The other screenshot displays `Online` and `Sync: 9h ago`. `Online` only confirms network availability; `Sync: 9h ago` means that system also has not recorded a recent complete synchronization.

For a non-admin user, the small yellow dot on the Wi-Fi icon is rendered when there is a pending item or `status.error`. In Sanjay's screenshot the network icon remains green, so the dot represents the incomplete cloud-sync error described here; it is not a role-warning indicator.

## Missing cloud parent records

The following parent IDs are referenced by cloud child rows but do not exist in the corresponding cloud tables:

### Agents

- `783c1dc4-0da1-4689-b090-e69564a2d15c`
- `ag_plant_karthik`
- `ag_plant_senthil`

### Scheme Master templates

- `tpl_plant_gold_5k`
- `tpl_plant_harvester_10k`

### Commission rule

- `crule_plant_gold_scheme`

### Customers

- `cust_misty_mountain`
- `cust_nature_basket_organics`

### Product

- `prod_tool_organic_processing_kit`

Cloud deletion history contains no tombstones for these IDs. This indicates that the parent rows were never uploaded, rather than intentionally deleted through the normal sync flow.

Repository history identifies these IDs as records from the old `seedNaturalPlantationSmartBuy.sql` demonstration dataset (introduced in commit `c2d56d4`). The live cloud therefore contains only part of that demo dataset: several child rows remain, while required demo products, customers, agents, templates, and commission rules are absent. This partial demo-data contamination is the immediate cause of the current pull failures.

## Broken dependency examples

- Invoice `84416dca-1542-4eeb-93ca-f32fef57d0b9` references a missing customer.
- Scheme `sch_plant_gold_01` references a missing Scheme Master template, agent, and product.
- Scheme `ea73db08-ca1f-4121-85eb-87db7a0e8f8f` references a missing Scheme Master template and agent.
- Smart Buy members and contributions reference missing customers, agents, and schemes.
- The Smart Buy wallet references a missing customer.
- Commission ledger rows reference missing agent, commission rule, member, and scheme records.

## Safe data-repair order

Recover the missing records from the older system that still contains the original data, then upload/import them in parent-first order:

1. Products, customers, and agents.
2. Scheme Master templates and commission rules.
3. Smart Buy schemes.
4. Smart Buy members.
5. Contributions, wallet records, commission records, invoices, invoice items, and payments.
6. Trigger sync again and confirm the full-success timestamp advances.

Because the broken rows originate from an old demonstration dataset, the preferred repair is to quarantine or remove the complete connected demo-data set after taking a database backup. Restoring the demo parents would make synchronization pass, but would also expose demonstration customers, schemes, invoices, and commission data in the production app. If any of these rows were converted into real business records, an administrator must identify them before cleanup. Removing cloud records without that decision risks permanent business-data loss.

## Product hardening recommended

- Validate parent existence before a child upload is accepted by the cloud API.
- Upload and pull dependency groups in a strict parent-first order.
- Quarantine a malformed cloud row with its exact missing dependency so one row cannot obscure the health of unrelated tables.
- Show separate timestamps for the latest sync attempt, latest successful upload, and latest complete pull. This prevents `Online` from being mistaken for successful synchronization.
- Add a repair report that lists missing table, parent ID, child table, and child ID.

## Production repair completed

Repair completed on 2026-09-29 after authorization:

- Created and verified VPS MySQL backup: `/var/backups/pos-erp-mysql/pos_erp_all_2026-09-29_130535.sql.gz`.
- Backup size: `220742` bytes.
- Backup SHA-256: `39b6670ecdc6d3012dbc54ea94c5b007c0c02c232534a069279c44cb2034114a`.
- Removed the 13 identified orphan demo/QA child records through the normal cloud sync API in child-first order.
- Verified all 13 records are absent from the cloud.
- Verified all 13 deletion tombstones were created for other devices.
- Verified the local outbound queue remains clear (`0 pending`, `0 failed`).
- Verified `sync_cycle_error` is cleared, `sync_pull_errors` is empty, and the complete-sync timestamp advanced to `2026-09-29T13:05:10.150Z`.

The Smart Buy Manager role and account were not changed during this repair.

## Follow-up: scheme synchronization fix — 2026-09-30

A later device update republished historical demo scheme `sch_plant_harvester_02`. The cloud accepted it even though its required template (`tpl_plant_harvester_10k`), agent (`ag_plant_karthik`), and product (`prod_tool_weeder_harvester`) were absent. The receiving desktop correctly rejected the orphan with `FOREIGN KEY constraint failed`.

The cloud audit also explained the two expected scheme records:

- `fe207a65-c534-4603-a5b1-77991b3cde96` (`new scheme`) was created at `2026-09-29T13:26:24Z`, cancelled at `16:10:58Z`, and purged by the Company Admin account at `16:11:32Z`. Its absence is therefore the recorded delete result.
- `ea73db08-ca1f-4121-85eb-87db7a0e8f8f` was created by the Smart Buy Manager account using missing historical demo parents and was part of the invalid demo-linked graph removed in the earlier cleanup.

Code fix `63793f2` is deployed on the VPS:

- The backend now validates Smart Buy scheme template, product, agent, branch, and creator parents before accepting a cloud write.
- Product, customer, agent, and Scheme Master parent validation activates the desktop v2.7.14 parent-repair path.
- Partial scheme updates can now recover the parent ID from the complete local row before uploading that parent and retrying.
- Verification passed: desktop/backend typechecks, 3 unit tests, 16 sync-recovery integration tests, and the backend production build.
- Production probe confirmed a missing-template scheme is rejected with HTTP `400`, and its transaction creates no cloud row.

Fresh pre-cleanup backup: `/var/backups/pos-erp-mysql/pos_erp_all_2026-09-30_021836.sql.gz` (`231628` bytes, SHA-256 `e6d36a651ca26dcb8f497db3057f346425a7421b3f71a75bd64a6baa8845132f`). The stale demo scheme was removed through the sync API, its tombstone was verified, and the local client subsequently reported `sync_cycle_error: null`, an empty pull-error map, and a successful sync at `2026-09-30T02:19:54.169Z`.

