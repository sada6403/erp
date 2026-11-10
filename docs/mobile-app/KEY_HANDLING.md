# Play upload key handling

No password, key or fingerprint secret is stored in this repo. Only public certificate fingerprints may be written down.

## Where the key lives
- Keystore: `C:\secure\nf-keys\nf-release-key.jks` (PKCS12, alias `nf-farming`), outside every repo.
- It is the Play **upload key** (Play holds the app signing key). Never copy it into the repo, `mobile/`, `C:\np` or chat.
- Git blocks it: `.gitignore` covers `*.jks *.keystore *.p12 *.pem key.properties credentials.json google-services.json .env*`, and `.githooks/pre-commit` refuses to commit them (enabled with `git config core.hooksPath .githooks` on each clone).

## Backup
- Two copies: a private Google Drive folder (not shared, 2-step verification on) and an offline copy (USB).
- Passwords (keystore and key) go in a password manager, never in a file next to the key.
- Test the backup once: run keytool against the copy.

## How EAS uses it
- `eas.json` preview and production builds use `credentialsSource: remote`: EAS stores the keystore encrypted and signs the build in the cloud.
- Uploaded once with `eas credentials` (interactive; you type the passwords). No `credentials.json` in the repo.

## If it is lost or leaked
- Lost: Play Console, Test and release, App integrity, App signing, **Request upload key reset**. Generate a new upload key, export `upload_certificate.pem`, submit it. Play enables it after review. Users are unaffected.
- Leaked: reset it the same way straight away, then remove the old key from EAS.
