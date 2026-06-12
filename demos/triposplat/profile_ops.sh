#!/usr/bin/env bash
# Per-op flow-DiT profile (2 steps, eager). Streams to profile_ops.log.
cd "$(dirname "$0")/../../../bro" || exit 1
BRO_TRIPOSPLAT_PROFILE=1 BRODIFFUSION_FLOW_PROFILE=1 \
    ./build/Release/bro-headless.exe \
    ../broworkshop/demos/example \
    ../broworkshop/demos/triposplat/profile_ops.js \
    > ../broworkshop/demos/triposplat/profile_ops.log 2>&1
echo "exit: $?" >> ../broworkshop/demos/triposplat/profile_ops.log
