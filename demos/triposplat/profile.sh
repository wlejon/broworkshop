#!/usr/bin/env bash
# Run the TripoSplat stage profile (profile.js) with per-stage timing enabled,
# streaming all output to demos/triposplat/profile.log (stderr is unbuffered,
# so stage lines land as they happen).
cd "$(dirname "$0")/../../../bro" || exit 1
BRO_TRIPOSPLAT_PROFILE=1 ./build/Release/bro-headless.exe \
    ../broworkshop/demos/example \
    ../broworkshop/demos/triposplat/profile.js \
    > ../broworkshop/demos/triposplat/profile.log 2>&1
echo "exit: $?" >> ../broworkshop/demos/triposplat/profile.log
