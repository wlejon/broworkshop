#!/usr/bin/env bash
# validate.sh — boot-smoke and test runner for every broworkshop app.
#
#   scripts/validate.sh [options] [glob ...]
#
# Modes (default: both):
#   --smoke          boot each app headless, advance frames, fail on uncaught
#                    JS errors or a failed boot (non-zero bro-headless exit)
#   --tests          run each app's test scripts: <app>/tests/test_*.js and
#                    <app>/test*.js (plus lib/**/test_*.js under lib-tests)
#
# Selection:
#   glob ...         app dirs (demos/*-lab, games/snake) or test scripts
#                    (tools/scene-editor/tests/test_arc.js). Default: all.
#   --ml             also run targets tagged `ml` (weights + GPU, slow)
#   --only-ml        run only `ml` targets
#   --net            also run targets tagged `net` (network / API keys)
#   --list           print the selected targets with their tags and exit
#
# Options:
#   --timeout N      per-run timeout in seconds (overrides tags/defaults)
#   --frames N       frames the smoke advances (default 60, 16 ms each)
#   --shots          smoke saves tests/out/shots/<app>.png
#   --out DIR        output dir for logs + summary (default tests/out)
#   --compare FILE   mark REGRESSED / FIXED against a baseline (default: the
#                    first of tests/baseline-<os>-<arch>-<profile>.txt and
#                    tests/baseline.txt that exists; --no-compare)
#   --write-baseline FILE   write this run's results in baseline form
#   --regressions    exit 1 only for REGRESSED rows (pre-existing failures pass)
#   -q               only print failures and the summary
#
# Tags live in tests/app-tags.txt; a `needs=bro.x.y` tag skips the target when
# the engine lacks that namespace (compiled out: `{ available: false }`).
# Engine binary: $BRO_HEADLESS, else the most recently built of
# ../bro/build*/Release/bro-headless.exe, ../bro/build*/bro-headless[.exe].
# <os>-<arch>-<profile> is e.g. windows-x64-full or macos-arm64-app; the
# profile is probed from the engine (bro.tensor => full, bro.net => app, else
# minimal). Runs with CWD = repo root (the convention every test script's
# relative paths assume). Exit 1 when anything failed. Works on bash 3.2.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

ONLY_REG=0 DO_SMOKE=0 DO_TESTS=0 WANT_ML=0 ONLY_ML=0 WANT_NET=0 LIST=0 QUIET=0 SHOTS=0
FRAMES=60 TIMEOUT_OVERRIDE="" OUT="tests/out" COMPARE="" NO_COMPARE=0 WRITE_BASELINE=""
GLOBS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --smoke) DO_SMOKE=1 ;;
        --tests) DO_TESTS=1 ;;
        --ml) WANT_ML=1 ;;
        --only-ml) WANT_ML=1; ONLY_ML=1 ;;
        --net) WANT_NET=1 ;;
        --list) LIST=1 ;;
        --shots) SHOTS=1 ;;
        -q) QUIET=1 ;;
        --timeout) TIMEOUT_OVERRIDE="$2"; shift ;;
        --frames) FRAMES="$2"; shift ;;
        --out) OUT="$2"; shift ;;
        --compare) COMPARE="$2"; shift ;;
        --no-compare) NO_COMPARE=1 ;;
        --write-baseline) WRITE_BASELINE="$2"; shift ;;
        --regressions) ONLY_REG=1 ;;
        -h|--help) sed -n '2,39p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -*) echo "validate.sh: unknown option $1" >&2; exit 2 ;;
        *) GLOBS+=("${1%/}") ;;
    esac
    shift
done
[ $DO_SMOKE = 0 ] && [ $DO_TESTS = 0 ] && { DO_SMOKE=1; DO_TESTS=1; }

# --- engine binary ----------------------------------------------------------
# The newest build wins, so a fresh build-<whatever>/ is picked up without
# BRO_HEADLESS. A multi-config build's Debug/ is never picked; a single-config
# debug or sanitizer build dir is, when it is the newest (set BRO_HEADLESS).
HEADLESS="${BRO_HEADLESS:-}"
if [ -z "$HEADLESS" ]; then
    for c in ../bro/build*/Release/bro-headless.exe ../bro/build*/bro-headless.exe ../bro/build*/bro-headless; do
        { [ -f "$c" ] && [ -x "$c" ]; } || continue
        if [ -z "$HEADLESS" ] || [ "$c" -nt "$HEADLESS" ]; then HEADLESS="$c"; fi
    done
fi
if [ $LIST = 0 ] && { [ -z "$HEADLESS" ] || [ ! -x "$HEADLESS" ]; }; then
    echo "validate.sh: no bro-headless found; set BRO_HEADLESS" >&2; exit 2
fi

# --- timeout(1) ---------------------------------------------------------------
# GNU coreutils timeout (Linux, Git Bash), Homebrew's gtimeout, else a perl
# watchdog with the same contract: `run_timeout SIG SECS cmd...`, exit 124 on
# TERM / 137 on KILL when the deadline hits, the command's own status otherwise.
TIMEOUT_BIN=""
for c in timeout gtimeout; do
    if command -v "$c" > /dev/null 2>&1 && "$c" --version 2>/dev/null | grep -qi coreutils; then
        TIMEOUT_BIN="$c"; break
    fi
done
run_timeout() {   # run_timeout <signal> <secs> cmd args...
    if [ -n "$TIMEOUT_BIN" ]; then "$TIMEOUT_BIN" -s "$1" "$2" "${@:3}"; return; fi
    perl -e '
        use POSIX ();
        my ($sig, $secs, @cmd) = @ARGV;
        my $pid = fork();
        die "fork: $!" unless defined $pid;
        if ($pid == 0) { setpgrp(0, 0); exec { $cmd[0] } @cmd; exit 127; }
        my $timed = 0;
        local $SIG{ALRM} = sub { $timed = 1; kill $sig, -$pid; };
        alarm $secs;
        while (waitpid($pid, 0) != $pid) {}
        my $st = $?;
        alarm 0;
        exit(128 + 9) if $timed && ($st & 127) == 9;
        exit 124 if $timed;
        exit(128 + ($st & 127)) if $st & 127;
        exit($st >> 8);
    ' "$1" "$2" "${@:3}"
}

# --- tags -------------------------------------------------------------------
TAG_GLOBS=() TAG_VALS=()
while read -r g rest; do
    case "$g" in ''|'#'*) continue ;; esac
    TAG_GLOBS+=("$g"); TAG_VALS+=("$rest")
done < tests/app-tags.txt

# --- engine probe: platform, profile, features named by needs= tags ------------
case "$(uname -s)" in
    Darwin) OS=macos ;; Linux) OS=linux ;; MINGW*|MSYS*|CYGWIN*|Windows*) OS=windows ;;
    *) OS="$(uname -s | tr '[:upper:]' '[:lower:]')" ;;
esac
case "$(uname -m)" in
    arm64|aarch64) ARCH=arm64 ;; x86_64|amd64|AMD64) ARCH=x64 ;; *) ARCH="$(uname -m)" ;;
esac
NEEDS=""   # " bro.tensor bro.ai.game.nn ..."
for v in ${TAG_VALS[*]:-}; do
    case "$v" in needs=*) [[ " $NEEDS " == *" ${v#needs=} "* ]] || NEEDS="$NEEDS ${v#needs=}" ;; esac
done
PROFILE="" FEATURES=""   # FEATURES: " bro.tensor=0 bro.ai.game.nn=1 "
if [ -n "$HEADLESS" ] && [ -x "$HEADLESS" ]; then
    has() { echo "(o => !!o && o.available !== false)(typeof bro === 'undefined' ? undefined : ${1//./?.})"; }
    probe="console.log('BROPROBE profile=' + ($(has bro.tensor) ? 'full' : $(has bro.net) ? 'app' : 'minimal'));"
    for f in $NEEDS; do probe="$probe console.log('BROPROBE $f=' + ($(has "$f") ? 1 : 0));"; done
    while read -r kv; do
        case "$kv" in profile=*) PROFILE="${kv#profile=}" ;; *=*) FEATURES="$FEATURES $kv" ;; esac
    done < <(run_timeout KILL 60 "$HEADLESS" launcher -e "$probe" 2>&1 | tr -d '\r' | sed -n 's/.*BROPROBE //p')
    FEATURES="$FEATURES "
fi
PLATFORM="$OS-$ARCH${PROFILE:+-$PROFILE}"

if [ -z "$COMPARE" ] && [ $NO_COMPARE = 0 ]; then
    for c in "tests/baseline-$PLATFORM.txt" tests/baseline.txt; do
        [ -f "$c" ] && { COMPARE="$c"; break; }
    done
fi

tags_for() {   # tags_for <app> [script] -> space-separated tags
    local out="" i
    for i in "${!TAG_GLOBS[@]}"; do
        # shellcheck disable=SC2053
        if [[ "$1" == ${TAG_GLOBS[$i]} ]] || { [ -n "${2:-}" ] && [[ "$2" == ${TAG_GLOBS[$i]} ]]; }; then
            out="$out ${TAG_VALS[$i]}"
        fi
    done
    echo "$out"
}
has_tag() { [[ " $1 " == *" $2 "* ]]; }
timeout_for() {   # timeout_for <tags> <kind>
    [ -n "$TIMEOUT_OVERRIDE" ] && { echo "$TIMEOUT_OVERRIDE"; return; }
    local t w
    for w in $1; do case "$w" in timeout=*) t="${w#timeout=}" ;; esac; done
    [ -n "${t:-}" ] && { echo "$t"; return; }
    if has_tag "$1" ml; then echo 900; elif [ "$2" = smoke ]; then echo 60; else echo 300; fi
}

# --- discovery --------------------------------------------------------------
APPS=()
for d in launcher lib-tests games/* demos/* tools/* ai/* templates/*; do
    [ -f "$d/index.html" ] && APPS+=("$d")
done

selected() {   # selected <app> [script]
    [ ${#GLOBS[@]} = 0 ] && return 0
    local g
    for g in "${GLOBS[@]}"; do
        # shellcheck disable=SC2053
        if [[ "$g" == *.js ]]; then
            [ -n "${2:-}" ] && [[ "$2" == $g ]] && return 0
        elif [[ "$1" == $g ]]; then
            return 0
        fi
    done
    return 1
}

tests_of() {   # tests_of <app> -> script paths, one per line
    local f
    for f in "$1"/tests/test_*.js "$1"/test*.js; do [ -f "$f" ] && echo "$f"; done
    if [ "$1" = lib-tests ]; then
        find lib -name 'test_*.js' -not -path '*/node_modules/*' | sort
    fi
}

# kind|app|script|tags
TARGETS=()
for app in "${APPS[@]}"; do
    if [ $DO_SMOKE = 1 ] && selected "$app"; then
        TARGETS+=("smoke|$app||$(tags_for "$app")")
    fi
    if [ $DO_TESTS = 1 ]; then
        while read -r s; do
            [ -n "$s" ] || continue
            selected "$app" "$s" || continue
            # an app glob selects its scripts; a .js glob selects just that one
            TARGETS+=("test|$app|$s|$(tags_for "$app" "$s")")
        done < <(tests_of "$app")
    fi
done
# (also keeps bash 3.2, where "${empty[@]}" trips set -u, off the empty arrays below)
[ ${#TARGETS[@]} = 0 ] && { echo "validate.sh: no targets selected" >&2; exit 2; }

skip_reason() {   # skip_reason <tags> -> reason or empty
    has_tag "$1" skip && { echo "tagged skip"; return; }
    if has_tag "$1" ml; then [ $WANT_ML = 0 ] && { echo "ml (use --ml)"; return; }
    elif [ $ONLY_ML = 1 ]; then echo "not ml"; return; fi
    has_tag "$1" net && [ $WANT_NET = 0 ] && { echo "net (use --net)"; return; }
    local w
    for w in $1; do
        case "$w" in needs=*)
            [[ "$FEATURES" == *" ${w#needs=}=0 "* ]] && { echo "${w#needs=} not in this build"; return; } ;;
        esac
    done
    echo ""
}

if [ $LIST = 1 ]; then
    for t in "${TARGETS[@]}"; do
        IFS='|' read -r kind app script tags <<< "$t"
        r="$(skip_reason "$tags")"
        printf '%-5s %-60s %s%s\n' "$kind" "${script:-$app}" "$tags" "${r:+  [skip: $r]}"
    done
    exit 0
fi

# --- baseline ---------------------------------------------------------------
# One "\n<kind> <target>=<STATUS>\n" string rather than an associative array,
# which bash 3.2 (macOS /bin/bash) does not have.
NL=$'\n' BASE="$NL"
if [ -n "$COMPARE" ] && [ -f "$COMPARE" ]; then
    while read -r st kind tgt _; do
        case "$st" in PASS|FAIL|TIMEOUT) BASE="$BASE$kind $tgt=$st$NL" ;; esac
    done < "$COMPARE"
fi
base_of() {   # base_of <kind> <target> -> STATUS or empty
    local rest="${BASE#*"$NL$1 $2="}"
    [ "$rest" != "$BASE" ] && echo "${rest%%"$NL"*}"
}

# --- run --------------------------------------------------------------------
mkdir -p "$OUT/logs"
[ $SHOTS = 1 ] && mkdir -p "$OUT/shots"
[ $QUIET = 0 ] && echo "engine: $HEADLESS ($PLATFORM)  baseline: ${COMPARE:-none}"
RESULTS=()          # "STATUS kind target note"
NPASS=0 NFAIL=0 NSKIP=0 NREG=0

reason_of() {   # first engine error, else console.error, else last line
    local log="$1" r
    r="$(grep -m1 -E '^\[[0-9:.]+\] \[ERROR\]' "$log" | sed -E 's/^\[[0-9:.]+\] \[ERROR\] //')"
    [ -z "$r" ] && r="$(grep -m1 -E '^\[ERROR\]' "$log" | sed -E 's/^\[ERROR\] +//')"
    [ -z "$r" ] && r="$(grep -v -E '^\[[0-9:.]+\] \[INFO\]' "$log" | tail -n1)"
    r="${r//$'\r'/}"
    echo "${r:0:180}"
}

safe_name() { local s="${1//\//_}"; echo "${s%.js}"; }

smoke_expr() {   # smoke_expr <app>
    local e="for (let i = 0; i < $FRAMES; i++) advanceTime(16); flush();"
    [ $SHOTS = 1 ] && e="$e screenshot('$OUT/shots/$(safe_name "$1").png');"
    e="$e if (!document.body || !document.body.firstElementChild) assert(false, 'empty document after boot');"
    echo "$e"
}

for t in "${TARGETS[@]}"; do
    IFS='|' read -r kind app script tags <<< "$t"
    target="${script:-$app}"
    r="$(skip_reason "$tags")"
    if [ -n "$r" ]; then
        RESULTS+=("SKIP $kind $target $r"); NSKIP=$((NSKIP + 1))
        [ $QUIET = 0 ] && printf 'SKIP     %-5s %-58s %s\n' "$kind" "$target" "$r"
        continue
    fi
    log="$OUT/logs/$kind-$(safe_name "$target").log"
    to="$(timeout_for "$tags" "$kind")"
    start=$(date +%s)
    if [ "$kind" = smoke ]; then
        run_timeout KILL "$to" "$HEADLESS" "$app" -e "$(smoke_expr "$app")" > "$log" 2>&1
    else
        run_timeout KILL "$to" "$HEADLESS" "$app" "$script" > "$log" 2>&1
    fi
    rc=$?
    secs=$(( $(date +%s) - start ))
    if [ $rc = 0 ]; then st=PASS; note=""
    elif [ $rc = 137 ] || [ $rc = 124 ]; then st=TIMEOUT; note="killed after ${to}s"
    else st=FAIL; note="rc=$rc: $(reason_of "$log")"
    fi
    mark=""
    prev="$(base_of "$kind" "$target")"
    if [ -n "$COMPARE" ]; then
        if [ $st != PASS ] && [ "$prev" = PASS ]; then mark="REGRESSED "; NREG=$((NREG + 1))
        elif [ $st = PASS ] && [ -n "$prev" ] && [ "$prev" != PASS ]; then mark="FIXED "
        elif [ $st != PASS ] && [ -n "$prev" ]; then mark="(baseline $prev) "
        fi
    fi
    if [ $st = PASS ]; then NPASS=$((NPASS + 1)); else NFAIL=$((NFAIL + 1)); fi
    RESULTS+=("$st $kind $target $mark$note")
    if [ $QUIET = 0 ] || [ $st != PASS ] || [ -n "$mark" ]; then
        printf '%-8s %-5s %-58s %4ss  %s\n' "$st" "$kind" "$target" "$secs" "$mark$note"
    fi
done

# --- summary ----------------------------------------------------------------
{
    echo "# validate.sh $(date '+%Y-%m-%d %H:%M')  engine: $HEADLESS ($PLATFORM)"
    echo "# pass $NPASS  fail $NFAIL  skip $NSKIP${COMPARE:+  regressed $NREG (vs $COMPARE)}"
    printf '%s\n' "${RESULTS[@]}"
} > "$OUT/summary.txt"

if [ -n "$WRITE_BASELINE" ]; then
    {
        echo "# broworkshop validation baseline — scripts/validate.sh --write-baseline"
        echo "# $(date '+%Y-%m-%d')  engine: $HEADLESS ($PLATFORM)"
        echo "# STATUS KIND TARGET [note]. SKIP rows were not run in this baseline."
        printf '%s\n' "${RESULTS[@]}" | sed -E 's/ (REGRESSED|FIXED|\(baseline [A-Z]+\)) / /' | sort -k3,3 -k2,2
    } > "$WRITE_BASELINE"
fi

echo
echo "pass $NPASS  fail $NFAIL  skip $NSKIP${COMPARE:+  regressed $NREG vs $COMPARE}   (logs: $OUT/logs, summary: $OUT/summary.txt)"
if [ $ONLY_REG = 1 ]; then [ $NREG = 0 ]; else [ $NFAIL = 0 ]; fi
