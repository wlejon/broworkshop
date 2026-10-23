// Provably Zero-Desync Cross-Play Rollback Netcode Verification Suite (#132)
//
// Tests `bro.net.createRollbackSession` (and `/lib/kit/rollback.js` +
// `/lib/arcade/netplay.js`):
//   1. Compile-time determinism proof gate (`deterministic === true`,
//      `certificateHash`, rejection of `Math.random()` / `Date.now()`).
//   2. Two simulated peers advancing 10 frames with input prediction,
//      receiving delayed/divergent remote inputs from 6 frames ago, rolling
//      back and re-simulating 6 frames, and converging to bit-identical
//      64-bit FNV-1a state checksums (`verifyPeerChecksum === true`,
//      `desyncDetected === false`).
//   3. Intentional state tampering detection (`verifyPeerChecksum === false`,
//      `desyncDetected === true`).
//
// Run with bro-headless:
//   bro-headless lib-tests lib-tests/test_rollback_netcode.js
// Run with bronze static prover:
//   bronze check --deterministic lib-tests/test_rollback_netcode.js

import { createRollbackSession } from "../lib/kit/rollback.js";
import { createRollbackNetplay } from "../lib/arcade/netplay.js";

let tests = 0;
let failed = 0;

function t(name, fn) {
    tests++;
    try {
        fn();
        console.log("  ok   " + name);
    } catch (e) {
        failed++;
        console.log("  FAIL " + name + ": " + (e && e.message ? e.message : e));
        if (e && e.stack) console.log(e.stack);
    }
}

function truthy(v, msg) {
    if (!v) throw new Error(msg || "expected truthy");
}

function eq(a, b, msg) {
    if (a !== b) throw new Error((msg || "eq") + ": " + a + " !== " + b);
}

// Prover-clean deterministic 2-player integer physics tick
function deterministicArenaTick(state, inputs, frame) {
    const in0 = inputs[0] | 0;
    const in1 = inputs[1] | 0;
    const f = frame | 0;
    state[1] = (state[1] + in0) | 0;
    state[0] = (state[0] + state[1] + (f & 3)) | 0;
    state[3] = (state[3] + in1) | 0;
    state[2] = (state[2] + state[3] - (f & 1)) | 0;
}

// 1. Determinism proof gate: accepts clean tick, rejects Math.random() and Date.now()
t("RollbackSession determinism proof gate certifies clean tick and rejects non-deterministic hazards", () => {
    const session = createRollbackSession({
        tick: deterministicArenaTick,
        initialState: new Int32Array([0, 0, 0, 0]),
        playerCount: 2,
        maxRollbackFrames: 64,
    });
    truthy(session.deterministic === true, "clean tick must be certified deterministic");
    truthy(typeof session.certificateHash === "string" && session.certificateHash.length >= 16,
        "certificateHash must be a non-empty hex string");
    truthy(Array.isArray(session.hazards) && session.hazards.length === 0, "clean tick has 0 hazards");

    let rejectedRandom = false;
    try {
        createRollbackSession({
            tick: "(state, inputs) => { state[0] += Math.random() > 0.5 ? 1 : 0; }",
        });
    } catch (e) {
        rejectedRandom = String(e).includes("unseeded-prng");
    }
    truthy(rejectedRandom, "Math.random() tick must be rejected with unseeded-prng");

    let rejectedDate = false;
    try {
        createRollbackSession({
            tick: "(state, inputs) => { state[0] = Date.now() | 0; }",
        });
    } catch (e) {
        rejectedDate = String(e).includes("wall-clock-time");
    }
    truthy(rejectedDate, "Date.now() tick must be rejected with wall-clock-time");
});

// 2. Two simulated peers: 10 frames with prediction, 6-frame rollback, FNV-1a checksum convergence
t("Two peers advance 10 frames, roll back 6 frames on delayed input, and converge to bit-identical FNV-1a checksums", () => {
    const peerA = createRollbackSession({
        tick: deterministicArenaTick,
        initialState: new Int32Array([50, 0, -50, 0]),
        playerCount: 2,
        localPlayerId: 0,
        maxRollbackFrames: 64,
    });

    const peerB = createRollbackSession({
        tick: deterministicArenaTick,
        initialState: new Int32Array([50, 0, -50, 0]),
        playerCount: 2,
        localPlayerId: 1,
        maxRollbackFrames: 64,
    });

    eq(peerA.certificateHash, peerB.certificateHash, "identical certificateHash across peers");

    // Frames 0..3: synchronized inputs (p0 = 3, p1 = -2)
    for (let f = 0; f < 4; f++) {
        peerA.receiveRemoteInput(f, 1, -2);
        peerB.receiveRemoteInput(f, 0, 3);
        peerA.advanceFrame(3);
        peerB.advanceFrame(-2);
    }
    eq(peerA.currentFrame, 4, "frame 4 reached");
    eq(peerA.checksumHex, peerB.checksumHex, "identical checksum at frame 4");

    // Frames 4..9 (6 frames):
    // Player 0 keeps input 3; Player 1 switches to +7 at frame 4.
    // Peer A has not yet received Player 1's input for frame 4..9, so it predicts -2.
    for (let f = 4; f < 10; f++) {
        peerA.advanceFrame(3);
        peerB.advanceFrame(7);
    }
    eq(peerA.currentFrame, 10, "peerA at frame 10");
    eq(peerB.currentFrame, 10, "peerB at frame 10");
    truthy(peerA.checksumHex !== peerB.checksumHex, "peers diverge before delayed packet arrives");

    // Delayed input from 6 frames ago (frame 4, player 1, actualInput = +7) arrives at Peer A
    const rb = peerA.receiveRemoteInput(4, 1, 7, peerB.getSnapshot(5).checksumHex);
    truthy(rb.rolledBack === true, "peerA must roll back");
    eq(rb.framesResimulated, 6, "peerA must re-simulate 6 frames (4..9)");
    truthy(rb.desyncDetected === false, "desyncDetected must be false after rollback");

    // Verify bit-exact 64-bit FNV-1a checksum convergence at frame 10
    const snapB10 = peerB.getSnapshot(10);
    truthy(peerA.verifyPeerChecksum(10, snapB10.checksumHex) === true,
        "verifyPeerChecksum must return true after rollback convergence");
    eq(peerA.checksumHex, peerB.checksumHex, "currentChecksumHex matches across peers");
    eq(peerA.getStats().rollbackCount, 1, "rollbackCount === 1");
    eq(peerA.getStats().totalFramesResimulated, 6, "totalFramesResimulated === 6");
    truthy(peerA.desyncDetected === false, "desyncDetected remains false");
});

// 3. Intentional state tampering detection
t("Intentional state tampering is detected by verifyPeerChecksum and sets desyncDetected = true", () => {
    const peer0 = createRollbackNetplay({
        tick: deterministicArenaTick,
        initialState: new Int32Array([10, 1, 20, -1]),
        playerCount: 2,
        localPlayerId: 0,
    });
    const peer1 = createRollbackNetplay({
        tick: deterministicArenaTick,
        initialState: new Int32Array([10, 1, 20, -1]),
        playerCount: 2,
        localPlayerId: 1,
    });

    peer0.session.receiveRemoteInput(0, 1, 5);
    peer1.session.receiveRemoteInput(0, 0, 2);
    peer0.stepLocal(2);
    peer1.stepLocal(5);

    truthy(peer0.session.verifyPeerChecksum(1, peer1.checksumHex) === true, "peers in sync at frame 1");
    truthy(peer0.desyncDetected === false, "no desync before tampering");

    // Tamper with peer0's state
    peer0.state[0] = 777777;
    truthy(peer0.session.verifyPeerChecksum(1, peer1.checksumHex) === false,
        "verifyPeerChecksum must return false after state tampering");
    truthy(peer0.desyncDetected === true, "desyncDetected must be true after state tampering");
});

console.log(tests + " tests, " + failed + " failed");
if (typeof window !== "undefined" && typeof window.close === "function") {
    window.close();
}
if (failed > 0) {
    throw new Error(failed + " rollback netcode test(s) failed");
}
