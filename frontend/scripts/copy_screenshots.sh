#!/usr/bin/env bash
# copy screenshots into frontend public folder so the dev server can serve them
set -e
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_ROOT="$ROOT_DIR/backend/projects"
DST_ROOT="$ROOT_DIR/frontend/public/screenshots"

mkdir -p "$DST_ROOT"

for domain_dir in "$SRC_ROOT"/*; do
  [ -d "$domain_dir" ] || continue
  domain="$(basename "$domain_dir")"
  src="$domain_dir/screenshot"
  [ -d "$src" ] || continue
  dst="$DST_ROOT/$domain"
  mkdir -p "$dst"
  cp -v "$src"/*.png "$dst"/ || true
done

echo "Copied screenshots to $DST_ROOT"
