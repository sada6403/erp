#!/usr/bin/env bash
set -euo pipefail
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/artifact" "$root/https" "$root/legacy"
for target in https legacy; do
  printf 'index' > "$root/$target/index.html"
  printf 'version: 1.0.0\n' > "$root/$target/latest.yml"
done
name='Enterprise POS ERP Setup 2.10.0.exe'
printf 'release fixture' > "$root/artifact/$name"
printf 'block map fixture' > "$root/artifact/$name.blockmap"
size="$(stat -c '%s' "$root/artifact/$name")"
sha="$(openssl dgst -sha512 -binary "$root/artifact/$name" | openssl base64 -A)"
printf 'version: 2.10.0\npath: %s\nsize: %s\nsha512: %s\n' "$name" "$size" "$sha" > "$root/artifact/latest.yml"
for target in https legacy; do
  UPDATES_DIR="$root/$target" bash scripts/publish-vps-release.sh "$root/artifact" 2.10.0
  cmp "$root/artifact/$name" "$root/$target/$name"
  cmp "$root/artifact/$name.blockmap" "$root/$target/$name.blockmap"
  cmp "$root/artifact/latest.yml" "$root/$target/latest.yml"
done
printf 'tampered' >> "$root/artifact/$name"
if UPDATES_DIR="$root/https" bash scripts/publish-vps-release.sh "$root/artifact" 2.10.0; then
  echo 'ERROR: accepted corrupted installer' >&2
  exit 1
fi
cmp "$root/artifact/latest.yml" "$root/https/latest.yml"
printf 'Both update feeds and blockmaps verified; corrupted artifacts rejected.\n'
