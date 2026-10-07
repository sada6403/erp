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

install -d -m 0755 "$updates_dir"
[[ -f "$updates_dir/index.html" ]] || fail "$updates_dir/index.html is missing"

stage_dir="$(mktemp -d "$updates_dir/.release-$expected_version.XXXXXX")"
cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

install -m 0644 "$artifact_dir/$installer" "$stage_dir/$installer"
install -m 0644 "$metadata_file" "$stage_dir/latest.yml"

# Publish the immutable installer first and switch clients by replacing metadata last.
mv -f "$stage_dir/$installer" "$updates_dir/$installer"
mv -f "$stage_dir/latest.yml" "$updates_dir/latest.yml"

echo "[release] Published $installer to $updates_dir"
