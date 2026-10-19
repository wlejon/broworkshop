#!/usr/bin/env bash
# look-ratchet.sh — the flora look's ratchet: the capture numbers the look is
# tuned against, held to goldens.
#
# Runs a fixed suite of headless captures (demos/forest capture.js `tiers`
# and `dolly`, demos/grove capture.js `species ... sil`), parses the numbers they print,
# and compares each with its golden in scripts/look-goldens/<host>.json. A
# number fails when it moves from its golden, either way, by more than its
# metric's margin. Prints the metrics that moved, the auto-vs-leaves gaps of
# the views they moved in (matching the leaves tier is the look's goal), and
# PASS/FAIL (exit 1 on FAIL). The clock is virtual, so a build gives the same
# numbers run after run.
#
# usage: scripts/look-ratchet.sh [--update] [--only LIST] [--gaps]
#                                [--bin PATH] [--host NAME] [--work DIR]
#   --update     write this run's numbers as the goldens (groups the run
#                skipped keep theirs)
#   --only LIST  comma-separated subset of: broadleaf,needle,shrub,scale,grove,dolly
#                (dolly: each forest part dollied 10-300 m through its
#                handovers, its largest lasting step in Y, cover and dY in
#                each phase of its lod, keyed dolly.<part>.<sky>.<phase>;
#                about 5 of the run's 7 minutes)
#   --gaps       print every view's auto-vs-leaves gaps, not only the moved
#   --bin PATH   bro-headless (default: $BRO_HEADLESS, else the most recently
#                built ../bro/build*/Release/bro-headless.exe or
#                ../bro/build*/bro-headless)
#   --host NAME  the goldens' host key (default: windows / linux / macos)
#   --work DIR   where the run logs go (default: a fresh dir under $TMPDIR)
#   --shader-source  the scene shaders from bro's source tree
#                (BRO_SCENE_SHADER_SOURCE=1), so a .glsl edit needs no
#                rebuild; off by default, so the binary's own shaders are
#                measured and an edit in progress in the tree is not
# The GPU is bro's choice unless BRO_VK_DEVICE says (the Vulkan index).
set -u

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
UPDATE=0
GAPS=0
ONLY="broadleaf,needle,shrub,scale,grove,dolly"
BIN="${BRO_HEADLESS:-}"
HOST=""
WORK=""
SHADER_SOURCE=0
WIDTH=1600
HEIGHT=900
TIMEOUT=1800

while [ $# -gt 0 ]; do
  case "$1" in
    --update) UPDATE=1 ;;
    --gaps) GAPS=1 ;;
    --only) ONLY=$2; shift ;;
    --bin) BIN=$2; shift ;;
    --host) HOST=$2; shift ;;
    --work) WORK=$2; shift ;;
    --shader-source) SHADER_SOURCE=1 ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$HOST" ]; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) HOST=windows ;;
    Darwin) HOST=macos ;;
    *) HOST=linux ;;
  esac
fi
if [ -z "$BIN" ]; then
  BIN=$(ls -t "$ROOT"/../bro/build*/Release/bro-headless.exe "$ROOT"/../bro/build*/bro-headless 2>/dev/null | head -1)
fi
if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then echo "bro-headless not found (build it or pass --bin)" >&2; exit 2; fi
GOLDENS="$ROOT/scripts/look-goldens/$HOST.json"
if [ -z "$WORK" ]; then WORK=$(mktemp -d "${TMPDIR:-/tmp}/look-ratchet.XXXXXX"); fi
mkdir -p "$WORK"
RUN="$WORK/run.txt"
: > "$RUN"

wants() { case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

# ---------------------------------------------------------------------------
# The suite. A forest part is one boot, its commands joined with `+`; each
# command's label (rt-<variant>-<n>) names the variant its numbers are filed
# under. shadow=0 leaves the subject casting none, so it comes last.
# ---------------------------------------------------------------------------
forest_cmds() {
  local part=$1 sky n=0 out=""
  local -a sets variants
  case "$part" in
    broadleaf) sets=(45,75,120 200,264); variants=("noon" "golden") ;;
    needle) sets=(45,75,120); variants=("noon" "golden" "noon shadow=0") ;;
    shrub) sets=(10,20); variants=("noon" "golden") ;;
    scale) sets=(45,75,120); variants=("noon" "golden") ;;
  esac
  for v in "${variants[@]}"; do
    sky=${v%% *}
    local name=$sky extra=""
    case "$v" in *shadow=0*) name="$sky-noshadow"; extra="shadow=0" ;; esac
    for ds in "${sets[@]}"; do
      n=$((n + 1))
      [ -n "$out" ] && out="$out + "
      out="${out}tiers $ds rt-$name-$n still $sky part=$part $extra"
    done
  done
  echo "$out"
}
GROVE_SPECIES="willow,ivy,birch"

run_boot() { # run_boot <name> <app> <script> <args...>
  local name=$1 app=$2 script=$3; shift 3
  local log="$WORK/$name.log" t0=$(date +%s)
  local -a env=()
  [ "$SHADER_SOURCE" = 1 ] && env=(BRO_SCENE_SHADER_SOURCE=1)
  (cd "$ROOT" && env -u BRO_SCENE_SHADER_SOURCE "${env[@]}" timeout -s KILL "$TIMEOUT" \
     "$BIN" --width "$WIDTH" --height "$HEIGHT" "$app" "$script" -- "$@") > "$log" 2>&1
  local rc=$?
  echo "[$name] $(( $(date +%s) - t0 )) s, exit $rc (log $log)"
}

# Forest `tiers` lines, filed under the variant of the png line that ends
# their command:
#   tiers needle 45 m auto: Y 101.2 cover 12.3% diff 4.5 dY -0.12 (...)
#   .../rt-noon-1_tiers_needle.png
parse_forest() {
  awk '
    match($0, /tiers [a-z]+ [0-9.]+ m [a-z]+: Y [-0-9.]+ cover [-0-9.]+% diff [-0-9.]+ dY [-0-9.]+/) {
      split(substr($0, RSTART, RLENGTH), f, " ")
      sub(/:$/, "", f[5]); sub(/%$/, "", f[9])
      k = f[2] ".%V." f[3] "m." f[5]
      buf[++n] = k ".Y " f[7]; buf[++n] = k ".cover " f[9]
      buf[++n] = k ".diff " f[11]; buf[++n] = k ".dY " f[13]
      next
    }
    match($0, /rt-[a-z-]+-[0-9]+_tiers_[a-z]+\.png/) {
      v = substr($0, RSTART + 3, RLENGTH - 3); sub(/_tiers_.*/, "", v); sub(/-[0-9]+$/, "", v)
      for (i = 1; i <= n; i++) { s = buf[i]; sub(/%V/, v, s); print "forest." s }
      n = 0
    }
    END { if (n) print "parse: " n " tiers numbers without their png line" > "/dev/stderr" }
  ' "$1"
}

# Grove `species ... sil` lines (the silhouette is the first sky's only):
#   species willow 5 m auto: cover 1234 px (leaves 1300) iou 0.912 Y 87.3
# cover is filed as a percent of the pane (a quarter of the width, full height).
parse_grove() {
  awk -v px="$(( (WIDTH / 4) * HEIGHT ))" '
    match($0, /species [a-z]+ [0-9.]+ m [a-z]+: cover [0-9]+ px \(leaves [0-9]+\) iou [0-9.]+ Y [-0-9.]+/) {
      split(substr($0, RSTART, RLENGTH), f, " ")
      sub(/\)$/, "", f[10])
      k = "grove." f[2] ".noon." f[3] "m"
      printf "%s.cover %.2f\n%s.leaves_cover %.2f\n%s.iou %s\n%s.Y %s\n", k, 100 * f[7] / px, k, 100 * f[10] / px, k, f[12], k, f[14]
    }
    /species: no / { print "grove: " $0 > "/dev/stderr" }
  ' "$1"
}

# Forest `dolly` phase lines: the largest lasting step of each metric in
# each phase of the subject's lod as it recedes (capture.js dolly):
#   phase needle golden clumps-crowns: Y +8.756 cover +0.618 dY +1.177
parse_dolly() {
  awk '
    match($0, /phase [a-z]+ [a-z]+ [a-z-]+: Y [-+0-9.]+ cover [-+0-9.]+ dY [-+0-9.]+/) {
      split(substr($0, RSTART, RLENGTH), f, " ")
      sub(/:$/, "", f[4])
      k = "dolly." f[2] "." f[3] "." f[4]
      printf "%s.Y %s\n%s.cover %s\n%s.dY %s\n", k, f[6] + 0, k, f[8] + 0, k, f[10] + 0
    }
  ' "$1"
}

echo "flora look ratchet: host $HOST, groups $ONLY"
echo "binary: $BIN ($(date -r "$BIN" '+%Y-%m-%d %H:%M' 2>/dev/null))"
for r in bro broflora broworkshop; do
  d="$ROOT/../$r"; [ "$r" = broworkshop ] && d=$ROOT
  echo "$r: $(git -C "$d" rev-parse --short HEAD 2>/dev/null)$(git -C "$d" diff --quiet 2>/dev/null || echo -dirty)"
done
if [ "$SHADER_SOURCE" = 1 ]; then
  echo "scene shaders: bro's source tree$(git -C "$ROOT/../bro" diff --quiet -- src/scene 2>/dev/null || echo ', with uncommitted edits')"
else
  echo "scene shaders: the binary's own"
fi
echo "goldens: $GOLDENS"
echo "logs: $WORK"

START=$(date +%s)
RAN=""
for part in broadleaf needle shrub scale; do
  wants $part || continue
  # shellcheck disable=SC2046
  run_boot "forest-$part" demos/forest demos/forest/capture.js $(forest_cmds $part)
  parse_forest "$WORK/forest-$part.log" >> "$RUN"
  RAN="$RAN forest.$part."
done
if wants grove; then
  run_boot grove demos/grove demos/grove/capture.js species "$GROVE_SPECIES" rt noon auto sil
  parse_grove "$WORK/grove.log" >> "$RUN"
  RAN="$RAN grove."
fi
if wants dolly; then
  for part in broadleaf needle scale shrub; do
    # A ridge hides the shrub's line at 22-32 m from the tiers' pitch.
    x=""; [ "$part" = shrub ] && x="pitch=-0.3"
    # shellcheck disable=SC2086
    run_boot "dolly-$part" demos/forest demos/forest/capture.js dolly $part rt noon $x + dolly $part rt golden $x
    parse_dolly "$WORK/dolly-$part.log" >> "$RUN"
  done
  RAN="$RAN dolly."
fi
echo "captures took $(( $(date +%s) - START )) s, $(wc -l < "$RUN") numbers"

# ---------------------------------------------------------------------------
# Verdict. Margins are per metric, in the metric's own units: Y and diff in
# levels, cover in points of the pane, dY in levels, IoU as a fraction.
# ---------------------------------------------------------------------------
GOLD="$WORK/goldens.txt"
if [ -f "$GOLDENS" ]; then
  sed -nE 's/^ *"([^"]+)": *([-0-9.]+).*/\1 \2/p' "$GOLDENS" > "$GOLD"
else
  : > "$GOLD"
fi

awk -v ran="$RAN" -v gaps="$GAPS" -v update="$UPDATE" -v verdict="$WORK/verdict.txt" '
  function margin(k) {
    if (k ~ /\.iou$/) return 0.02
    if (k ~ /\.dY$/) return 0.15
    if (k ~ /cover$/) return 0.3
    return 1.0                     # Y, diff: levels
  }
  function inrun(k,   n, i, p) {   # the key belongs to a group this run measured
    n = split(ran, p, " ")
    for (i = 1; i <= n; i++) if (index(k, p[i]) == 1) return 1
    return 0
  }
  function view(k) { sub(/\.[^.]+\.[^.]+$/, "", k); return k }   # forest: drop .<tier>.<metric>
  FILENAME == ARGV[1] { gold[$1] = $2; next }
  { now[$1] = $2; order[++nk] = $1 }
  END {
    fails = 0; news = 0; moved = 0
    printf "\n%-48s %9s %9s %8s %7s  %s\n", "Moved", "Golden", "Now", "Delta", "Margin", "Status"
    print "------------------------------------------------------------------------------------------"
    for (i = 1; i <= nk; i++) {
      k = order[i]
      if (!(k in gold)) { news++; continue }
      d = now[k] - gold[k]
      if (d == 0) continue
      moved++
      st = (d > margin(k) + 1e-9 || -d > margin(k) + 1e-9) ? "[FAIL]" : "[ok]"
      if (st == "[FAIL]") fails++
      printf "%-48s %9s %9s %+8.3g %7s  %s\n", k, gold[k], now[k], d, margin(k), st
      if (k ~ /^forest\./) touched[view(k)] = 1
      else { g = k; sub(/\.[^.]+$/, "", g); touched[g] = 1 }
    }
    for (k in gold) if (inrun(k) && !(k in now)) { printf "%-48s %9s %9s %8s %7s  %s\n", k, gold[k], "-", "-", "", "[FAIL] missing"; fails++ }
    if (!moved) print "(nothing moved)"
    print "------------------------------------------------------------------------------------------"

    # Auto against leaves: the gap now, and the golden gap.
    printf "\n%-34s %18s %18s %18s\n", "Auto - leaves (now / golden)", "Y", "cover", "dY"
    for (i = 1; i <= nk; i++) {
      k = order[i]
      if (k !~ /^forest\..*\.auto\.Y$/) continue
      v = view(k)
      if (!gaps && !(v in touched)) continue
      line = sprintf("%-34s", v)
      split("Y cover dY", ms, " ")
      for (j = 1; j <= 3; j++) {
        a = v ".auto." ms[j]; l = v ".leaves." ms[j]
        gn = now[a] - now[l]
        gg = (a in gold && l in gold) ? sprintf("%+.2f", gold[a] - gold[l]) : "-"
        line = line sprintf(" %8s / %7s", sprintf("%+.2f", gn), gg)
      }
      print line; shown = 1
    }
    for (i = 1; i <= nk; i++) {
      k = order[i]
      if (k !~ /^grove\..*\.iou$/) continue
      v = k; sub(/\.iou$/, "", v)
      if (!gaps && !(v in touched)) continue
      c = v ".cover"; l = v ".leaves_cover"
      gc = (c in gold && l in gold) ? sprintf("%+.2f", gold[c] - gold[l]) : "-"
      printf "%-34s %18s %8s / %7s %18s\n", v, "iou " now[k] " / " ((k in gold) ? gold[k] : "-"), sprintf("%+.2f", now[c] - now[l]), gc, ""
      shown = 1
    }
    if (!shown) print "(no view moved; --gaps prints them all)"

    printf "%d %d %d %d\n", nk, moved, fails, news > verdict
  }
' "$GOLD" "$RUN"

read -r NK MOVED FAILS NEWS < "$WORK/verdict.txt"

if [ "$UPDATE" = 1 ]; then
  if [ "$NK" -eq 0 ]; then echo "[LOOK] no numbers parsed; goldens left alone (see $WORK)." >&2; exit 1; fi
  mkdir -p "$(dirname "$GOLDENS")"
  # Goldens of groups this run skipped stay; the rest are this run's.
  awk -v ran="$RAN" '
    function inrun(k,   n, i, p) { n = split(ran, p, " "); for (i = 1; i <= n; i++) if (index(k, p[i]) == 1) return 1; return 0 }
    FILENAME == ARGV[1] { if (!inrun($1)) v[$1] = $2; next }
    { v[$1] = $2 }
    END { for (k in v) print k, v[k] }
  ' "$GOLD" "$RUN" | sort |
    awk '{ l[NR] = "  \"" $1 "\": " $2 } END { print "{"; for (i = 1; i <= NR; i++) print l[i] (i < NR ? "," : ""); print "}" }' \
    > "$GOLDENS.tmp" && mv "$GOLDENS.tmp" "$GOLDENS"
  echo "[LOOK] wrote $NK goldens for:$RAN to $GOLDENS"
  exit 0
fi

[ "$NEWS" -gt 0 ] && echo "[LOOK] $NEWS number(s) have no golden yet; --update records them."
if [ "$FAILS" -gt 0 ]; then
  echo "[LOOK] FAIL: $FAILS number(s) moved past their margin ($MOVED moved, $NK measured)."
  exit 1
fi
if [ "$NK" -eq 0 ]; then echo "[LOOK] FAIL: no numbers parsed (see $WORK)."; exit 1; fi
echo "[LOOK] PASS: $MOVED of $NK numbers moved, none past its margin."
exit 0
