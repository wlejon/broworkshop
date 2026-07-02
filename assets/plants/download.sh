#!/usr/bin/env bash
# Fetch CC0 plant reference textures from ambientCG (Lennart Demes).
# Every ambientCG asset is Creative Commons CC0 1.0 (public domain) — free to
# copy, modify, redistribute and ship, no attribution required. See README.md.
#
# These are reference/showcase assets: leaf-card atlases (with opacity/alpha),
# bark, and grass PBR sets. The extracted texture files are .gitignored to keep
# the repo small — this script is the install path.
#
#   ./download.sh            # default: 1K PNG (~10 MB each, ~90 MB total)
#   RES=2K ./download.sh     # crisper  (~45 MB each)
#   RES=4K ./download.sh     # hero     (large)
#
# Re-running is a no-op for assets already extracted at the chosen resolution.

set -euo pipefail
RES="${RES:-1K}"
case "$RES" in 1K|2K|4K|8K) ;; *) echo "RES must be 1K/2K/4K/8K (got: $RES)" >&2; exit 2;; esac

cd "$(dirname "$0")"

# category:AssetID — leaf sets carry an Opacity (alpha) map for cut-out cards;
# bark and grass are opaque tiling PBR sets.
ASSETS=(
  "leaves:LeafSet002"
  "leaves:LeafSet004"
  "leaves:LeafSet013"
  "leaves:LeafSet016"
  "bark:Bark001"
  "bark:Bark006"
  "bark:Bark012"
  "grass:Grass004"
)

echo "Fetching ${#ASSETS[@]} CC0 plant assets at $RES into $(pwd)"
for entry in "${ASSETS[@]}"; do
  cat="${entry%%:*}"
  id="${entry##*:}"
  dest="${cat}/${id}"
  if [ -d "$dest" ] && [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then
    echo "  [skip] $dest"
    continue
  fi
  url="https://ambientcg.com/get?file=${id}_${RES}-PNG.zip"
  tmp="$(mktemp -t "${id}.XXXXXX.zip")"
  echo "  [get ] $id"
  if curl -fsSL -o "$tmp" "$url"; then
    mkdir -p "$dest"
    # ambientCG zips are flat (Color/Opacity/Normal/Roughness/AO/Displacement).
    if unzip -oq "$tmp" -d "$dest"; then
      :
    else
      echo "  [FAIL] unzip $id" >&2
      rm -rf "$dest"
    fi
  else
    echo "  [FAIL] download $id" >&2
  fi
  rm -f "$tmp"
done

echo
echo "Done. Layout:"
find leaves bark grass -maxdepth 2 -type d 2>/dev/null | sort | sed 's/^/  /' || true
