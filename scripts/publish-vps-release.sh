#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:?Artifact directory is required}"
expected_version="${2:?Release version is required}"
updates_dir="${UPDATES_DIR:-/var/www/updates}"
metadata_file="$artifact_dir/latest.yml"

fail() {
  echo "[release] $*" >&2
  exit 1
}

[[ -f "$metadata_file" ]] || fail "latest.yml is missing"

version="$(sed -nE 's/^version:[[:space:]]*([^[:space:]]+).*/\1/p' "$metadata_file" | head -n 1)"
installer="$(sed -nE 's/^path:[[:space:]]*(.+)[[:space:]]*$/\1/p' "$metadata_file" | head -n 1)"
declared_size="$(sed -nE 's/^[[:space:]]*size:[[:space:]]*([0-9]+).*/\1/p' "$metadata_file" | head -n 1)"
declared_sha="$(sed -nE 's/^sha512:[[:space:]]*(.+)[[:space:]]*$/\1/p' "$metadata_file" | tail -n 1)"
expected_installer="Enterprise POS ERP Setup $expected_version.exe"

[[ "$version" == "$expected_version" ]] || fail "metadata version $version does not match $expected_version"
[[ "$installer" == "$expected_installer" ]] || fail "unexpected installer path: $installer"
[[ "$installer" != */* && "$installer" != *\\* ]] || fail "installer path must be a file name"
[[ -f "$artifact_dir/$installer" ]] || fail "installer is missing: $installer"
[[ "$declared_size" =~ ^[0-9]+$ ]] || fail "metadata size is invalid"
[[ -n "$declared_sha" ]] || fail "metadata sha512 is missing"

actual_size="$(stat -c '%s' "$artifact_dir/$installer")"
actual_sha="$(openssl dgst -sha512 -binary "$artifact_dir/$installer" | openssl base64 -A)"

[[ "$actual_size" == "$declared_size" ]] || fail "installer size does not match latest.yml"
[[ "$actual_sha" == "$declared_sha" ]] || fail "installer sha512 does not match latest.yml"

# Explicit UPDATES_DIR is useful for isolated tests. Production defaults cover
# both the HTTPS host and the legacy /updates URL used by installed desktops.
targets=("$updates_dir")
if [[ -n "${UPDATES_MIRROR_DIR:-}" ]]; then
  targets+=("$UPDATES_MIRROR_DIR")
elif [[ -z "${UPDATES_DIR+x}" ]]; then
  targets+=(/var/www/html/updates)
fi
stages=()
cleanup() {
  for stage in "${stages[@]}"; do rm -rf "$stage"; done
}
trap cleanup EXIT

# Stage and validate every destination before changing either feed.
for target in "${targets[@]}"; do
  install -d -m 0755 "$target"
  [[ -f "$target/index.html" || -f "$target/latest.yml" ]] || fail "$target is not an existing update feed"
  stage="$(mktemp -d "$target/.release-$expected_version.XXXXXX")"
  stages+=("$stage")
  install -m 0644 "$artifact_dir/$installer" "$stage/$installer"
  install -m 0644 "$metadata_file" "$stage/latest.yml"
  if [[ -f "$artifact_dir/$installer.blockmap" ]]; then
    install -m 0644 "$artifact_dir/$installer.blockmap" "$stage/$installer.blockmap"
  fi
done

# Make all immutable payloads available before advertising the new version.
for i in "${!targets[@]}"; do
  mv -f "${stages[$i]}/$installer" "${targets[$i]}/$installer"
  if [[ -f "${stages[$i]}/$installer.blockmap" ]]; then
    mv -f "${stages[$i]}/$installer.blockmap" "${targets[$i]}/$installer.blockmap"
  fi
done
for i in "${!targets[@]}"; do
  mv -f "${stages[$i]}/latest.yml" "${targets[$i]}/latest.yml"
  echo "[release] Published $installer to ${targets[$i]}"
done
