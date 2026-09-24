// tools/eval_common.js — config + reporting shared by the evaluators.

/** Read EVAL_* from the environment. */
export function evalConfig(defaults) {
    const env = process.env;
    return {
        matches: +(env.EVAL_MATCHES || defaults.matches),
        seconds: +(env.EVAL_SECONDS || 45),
        red: env.EVAL_RED || "scripted",
        blue: env.EVAL_BLUE || "scripted",
    };
}

const WHO = { 0: "RED", 1: "BLUE", [-1]: "DRAW" };

export const report = {
    /** One line per match: { scenario, winner, redAlive, redHp, blueAlive, blueHp, elapsed, wallMs }. */
    match(i, n, r) {
        console.log("[" + (i + 1) + "/" + n + "] " + r.scenario + "  winner=" + WHO[r.winner] +
            "  red=" + r.redAlive + "(" + r.redHp.toFixed(0) + "hp)" +
            "  blue=" + r.blueAlive + "(" + r.blueHp.toFixed(0) + "hp)" +
            "  t=" + r.elapsed.toFixed(1) + "s  wall=" + r.wallMs + "ms");
    },

    summary(cfg, results) {
        const n = results.length;
        const count = (w) => results.filter((r) => r.winner === w).length;
        const pct = (k) => (100 * k / Math.max(1, n)).toFixed(1) + "%";
        const wall = results.reduce((s, r) => s + r.wallMs, 0) / 1000;
        const sim = results.reduce((s, r) => s + r.elapsed, 0);
        console.log("==== summary ====");
        console.log("BLUE (" + cfg.blue + "): " + count(1) + "/" + n + "   (" + pct(count(1)) + ")");
        console.log("RED  (" + cfg.red + "): " + count(0) + "/" + n + "   (" + pct(count(0)) + ")");
        console.log("DRAW: " + count(-1) + "/" + n);
        console.log("speed: " + (sim / Math.max(1e-3, wall)).toFixed(1) + "x real time  (wall=" +
                    wall.toFixed(1) + "s  sim=" + sim.toFixed(1) + "s)");
    },
};
