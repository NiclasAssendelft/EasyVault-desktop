#!/usr/bin/env bash
set -euo pipefail

DEST_DIR="${EASYVAULT_WATCH_DIR:-$HOME/Downloads/ToEasyVault}"
mkdir -p "$DEST_DIR"

if [ "$#" -eq 0 ]; then
  echo "No files provided."
  exit 1
fi

copied=0
for src in "$@"; do
  if [ ! -f "$src" ]; then
    continue
  fi

  base="$(basename "$src")"
  target="$DEST_DIR/$base"

  if [ -e "$target" ]; then
    name="${base%.*}"
    ext=""
    if [[ "$base" == *.* ]]; then
      ext=".${base##*.}"
    fi
    ts="$(date +%Y%m%d-%H%M%S)"
    target="$DEST_DIR/${name}-from-finder-${ts}${ext}"
  fi

  cp -f "$src" "$target"
  copied=$((copied + 1))
done

echo "Sent $copied file(s) to $DEST_DIR"
