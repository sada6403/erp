# VPS Desktop Release Design

## Goal

Publish the tested Enterprise POS ERP Windows release to the existing VPS without requiring a developer workstation to have direct SSH access. A successful release must update both the public download endpoint and the generic Electron auto-update feed to version 2.7.26.

## Considered Approaches

1. Direct SCP from the developer workstation. This is simple, but the workstation has no VPS SSH key and it makes releases depend on one machine.
2. Commit installers to Git. This avoids SSH setup, but permanently adds roughly 91 MB per release to repository history and is not suitable for binary distribution.
3. GitHub Actions build and publish. A Windows runner builds the installer, then the existing self-hosted VPS runner downloads the workflow artifact and publishes it. This is the selected approach because it is repeatable and uses the deployment trust already configured on the VPS.

## Workflow

The `Deploy VPS` workflow will have two jobs:

1. `build-desktop` runs on `windows-latest`, checks out the exact pushed commit, installs dependencies with `npm ci`, runs the existing `npm run build:win`, and uploads only the installer, blockmap, and `latest.yml` as a short-lived Actions artifact.
2. `deploy` runs on the existing self-hosted VPS runner after the build succeeds. It downloads the artifact, validates that `latest.yml` names the expected installer and that all three files exist, runs the existing `/usr/local/bin/pos-deploy`, then publishes the files into `/var/www/updates` with elevated permissions.

The deployment job writes files under temporary names and renames them only after validation, so clients do not observe a partially uploaded release. Existing installers remain available for rollback and direct historical downloads.

## Trigger And Versioning

Pushes to `main` keep deploying the backend and superadmin. Desktop packaging runs only when the root `package.json` version differs from the version currently published by the VPS, or when the workflow is manually dispatched. For the first implementation, the pushed package version is passed explicitly between jobs and the VPS validation rejects an artifact whose metadata does not match it.

## Failure Handling

- A Windows build failure prevents the VPS deployment job from starting.
- Missing or mismatched release files fail validation before any production file is replaced.
- Backend deployment failure prevents installer publication.
- Temporary files are removed on failure; the previously published release remains intact.
- The workflow output reports the version and final filenames without printing credentials.

## Verification

After publication, verify:

- `https://posadmin.nfplantation.com/api/download` reports `Enterprise POS ERP Setup 2.7.26.exe`.
- `http://72.61.115.222/updates/latest.yml` reports version `2.7.26`.
- The installer content length matches the built artifact.
- The production backend responds through its public endpoint; an unauthenticated `401` from the protected health route is accepted as proof that the service is reachable, while release metadata must return `200`.

## Security

No VPS password, SSH key, API key, or GitHub token is stored in the repository. Publication relies only on the existing GitHub self-hosted runner and its established `sudo` deployment permission.
