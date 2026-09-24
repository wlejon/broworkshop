// Click-to-inspect through the engine's mouse path: clicking a worker where
// they are drawn opens their stat sheet, the Foreman has his own sheet, an
// empty patch of ground and the × both close it.
import { check, eq, frames, q, text, shot, clickOn } from "/lib/kit/test.js";

const F = window.__farm;
F.noVoices();
frames(2);
F.start();
frames(4);
F.setAuto(false);      // hold everyone still so the click lands where they stand
F.world.briefing.line.length = 0;
for (const n of F.world.npcs) {   // spread out at home, clear of the Foreman
    n.task = null;
    n.x = n.tx = n.home.x;
    n.y = n.ty = n.home.y;
}
// The player's name-tag billboard (an HtmlNode) takes clicks over its whole
// surface, so keep the avatar out from in front of the Foreman (ENGINE-ISSUES.md).
F.movePlayerTo(12, 14);
frames(2);

// The kit/arcade projection agrees with the engine's own view * projection.
{
    const scene = F.stage.scene, r = F.stage.canvas.getBoundingClientRect();
    const V = scene.viewMatrix, P = scene.projectionMatrix;
    const mul = (m, v) => [0, 1, 2, 3].map((i) => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i] * v[3]);
    for (const p of [[0, 0, 0], [40, 0, 28], [22, 1.5, 12]]) {
        const c = mul(P, mul(V, [p[0], p[1], p[2], 1]));
        const ex = r.left + (c[0] / c[3] * 0.5 + 0.5) * r.width;
        const ey = r.top + (1 - (c[1] / c[3] * 0.5 + 0.5)) * r.height;
        const s = F.stage.toScreen(p[0], p[1], p[2]);
        check(Math.abs(s.x - ex) < 1.5 && Math.abs(s.y - ey) < 1.5,
            "toScreen matches the engine at " + p + ": " + [s.x, s.y] + " vs " + [ex, ey]);
    }
}

const worker = F.world.npcs.find((n) => n.id === "npc-lily");
const p = F.personScreen(worker.id);
check(p, "Lily is on screen");
click(p.x, p.y, 0);
frames(2);
check(!q("#statsheet").hidden, "clicking Lily opens the stat sheet");
eq(F.inspector.selectedId(), "npc-lily", "Lily is selected");
eq(text("#ss-name"), "Lily", "sheet names her");
eq(text("#ss-role"), "Gardener", "sheet shows her role");
eq(q("#ss-needs").querySelectorAll(".ss-need-row").length, 4, "four needs");
eq(q("#ss-stats").querySelectorAll(".ss-stat-row").length, 6, "six attributes");
check(/Station/.test(text("#ss-station")), "station line: " + text("#ss-station"));
shot("inspect-lily");

const fp = F.personScreen("Foreman");
click(fp.x, fp.y, 0);
frames(2);
eq(F.inspector.selectedId(), "Foreman", "clicking the Foreman switches the sheet");
eq(text("#ss-role"), "Foreman", "the Foreman's role");
check(/always on duty/.test(text("#ss-needs")), "the Foreman has no vitals");

// Empty ground closes the sheet.
const corner = F.stage.toScreen(1, 0, 27);
click(corner.x, corner.y, 0);
frames(2);
check(q("#statsheet").hidden, "clicking empty ground closes the sheet");

// The × closes it too.
click(p.x, p.y, 0);
frames(2);
check(!q("#statsheet").hidden, "reopened on Lily");
clickOn("#ss-close");
frames(2);
check(q("#statsheet").hidden, "the close button closes the sheet");

// Pausing closes an open sheet.
click(p.x, p.y, 0);
frames(2);
F.shell.switchTo("pause");
frames(1);
check(q("#statsheet").hidden, "pause closes the sheet");

console.log("farm inspect ok");
