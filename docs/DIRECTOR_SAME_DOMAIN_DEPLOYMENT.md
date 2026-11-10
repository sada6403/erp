# Director login on the existing POS download domain

Authorized target: TK Fresh Choice. Public origin: `https://updates.nfplantation.com`.

The existing download homepage retains its installer/version/update links and now includes a Director login form. The form uses the existing management login API with Director cookie authentication and redirects to `/director` on the same origin. Users may enter their company name or slug/ID; ambiguous matches are denied. No Director credentials are embedded or seeded into the public page.

Director accounts continue to be created and controlled by Company Admin through POS Management Control. The Director website is reporting-only. No employee mobile UI/APK or new admin website is included.

## Server rollout

`scripts/deploy-vps.sh` invokes `scripts/enable-director-vps.cjs` through the existing authorized root deployment service. Before the first rollout, it:

1. Selects only the confirmed active TK Fresh Choice tenant without emitting tenant metadata into logs.
2. Saves the SaaS registry database, target tenant database, backend environment file, existing updates Nginx configuration and existing download homepage under root-only `/var/backups/pos-director`.
3. Restores the tenant backup into a temporary VPS-local test schema, applies the additive management migration there, checks invoice/customer counts, and drops that generated restore-test schema.
4. Applies the management migration to the confirmed tenant only; enables management there without changing company industry, sales, stock, investments or salary rules.
5. Configures the exact public management origin. Automatic legacy SaaS migrations remain disabled during the build/new server startup.
6. Builds/restarts the backend and adds same-domain Nginx routes for `/director`, `/api/management/` and Next assets. It preserves static installer/update routes.
7. Validates Nginx, switches the homepage atomically and checks the public unauthenticated management endpoint returns 401 JSON. On publication failure, homepage/Nginx files are restored from the private publication backup.

Backups and restore-test data remain on the VPS and are not uploaded as GitHub artifacts or printed in workflow logs. No password, environment contents, full Nginx configuration or production tenant records are logged. A diagnostic that would have printed configuration/metadata was rejected by automatic approval review; it was replaced with private server-side validation returning a generic status only.

The first-time setup state is stored root-only under `/var/lib/pos-director`. Future ordinary deploys do not rerun the target migration once this setup is marked installed. Future schema changes require their own reviewed migration version and backup process.

No installer version bump is part of this website rollout. Development POS users must restart their app to load the Management Control bridge/menu; installed older clients need a subsequent desktop release before that menu is available.

## Verification

Before publishing: management MySQL suite 15 passed; backend TypeScript passed; existing backend/POS builds and broader tests are recorded in `MANAGEMENT_TEST_RESULTS.md`. Local browser QA checks the homepage download link, invalid-password error/password clearing, successful same-origin dashboard redirect, and mobile overflow using intercepted fixtures.

After rollout, verify the public homepage, `/director`, `/api/management/me` (401), malformed login rejection and unchanged `latest.yml`. Actual Director access requires a Company Admin-created Director account; no default credentials are invented.
