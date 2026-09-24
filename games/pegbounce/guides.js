// Pegbounce guides — five characters, each with a green-peg ability.
// trigger(world, peg) runs when the ball strikes a green peg and changes the
// world directly (adds pegs, sets balls on fire, queues a pulse, ...).

import { Physics as P } from "/app/physics.js";

const GUIDES = [
    {
        id: "wingtip", name: "Wingtip", icon: "✲", color: "#67e1ff",
        blurb: "Scatters a ring of extra bonus pegs on each green trigger.",
        trigger(world, peg) {
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                const x = peg.x + Math.cos(a) * 60;
                const y = peg.y + Math.sin(a) * 60;
                if (x < 30 || x > P.FIELD_W - 30) continue;
                if (y < P.FIELD_TOP + 20 || y > P.FIELD_BOTTOM - 60) continue;
                if (world.pegs.some((q) => !q.removed && Math.hypot(q.x - x, q.y - y) < 22)) continue;
                P.addPeg(world, x, y, P.PEG.BLUE);
            }
        },
    },
    {
        id: "terraflame", name: "Terraflame", icon: "\u{1F525}", color: "#ff7a3d",
        blurb: "Ignites the ball so every peg within a glowing aura burns.",
        trigger(world) {
            for (const b of P.activeBalls(world)) b.onFire = true;
        },
    },
    {
        id: "pulsewave", name: "Pulsewave", icon: "◎", color: "#8fe07e",
        blurb: "Emits a shockwave that lights every peg in a wide radius.",
        trigger(world, peg) {
            const R = 160;
            const queue = [];
            for (const p of world.pegs) {
                if (p.removed || p.lit || p === peg) continue;
                const dist = Math.hypot(p.x - peg.x, p.y - peg.y);
                if (dist <= R) queue.push({ peg: p, dist });
            }
            queue.sort((a, b) => a.dist - b.dist);
            world.pulses.push({ cx: peg.x, cy: peg.y, R, age: 0, duration: 0.5, queue });
        },
    },
    {
        id: "orbital", name: "Orbital", icon: "∘", color: "#c48eff",
        blurb: "Splits the ball into a trio of echoes for a brief window.",
        trigger(world) {
            P.spawnSplitBalls(world);
        },
    },
    {
        id: "mirage", name: "Mirage", icon: "◇", color: "#ffd24a",
        blurb: "Reveals the projected ball path for the next shot.",
        trigger(world) {
            world.mirageNextShot = true;
        },
    },
];

function byId(id) {
    return GUIDES.find((g) => g.id === id) || GUIDES[0];
}

export const Guides = { GUIDES, byId };
