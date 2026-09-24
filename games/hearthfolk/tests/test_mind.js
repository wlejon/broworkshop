// The mind protocol with a deterministic fake brain: a full think is applied
// exactly, the hearer of a line thinks next with the line in its prompt, the
// accepted goto is really walked, malformed output is discarded untouched,
// memories cap at 20, and the scheduler drives thinks on its own. Then the
// mind panel, opened by clicking the villager through the engine's mouse path.
import { check, eq, frames, simUntil, shot, q, text } from "/lib/kit/test.js";

const H = window.HEARTH;
H.noModels();
frames(2);
const game = H.start();
frames(4);
const world = H.world;
const { FLAG: F, MEMORY_CAP } = H.defs;
const M = game.mind;
const pump = (ms) => { for (let t = 0; t < ms; t += 100) advanceTime(100); };

const prompts = [];
let reply = "{}";
globalThis.__hearthmindGenerate = async (prompt) => { prompts.push(prompt); return reply; };
// Park the background scheduler while the sub-tests drive requestThink()
// directly (it shares the same serial one-in-flight queue).
M.thinkT = -1e9;

const rowan = game.villagerByName("Rowan");
const bryn = game.villagerByName("Bryn");
const hx = game.hearth.x, hy = game.hearth.y;
H.debug.teleport(rowan, hx - 1, hy);   // adjacent at the hearth
H.debug.teleport(bryn, hx, hy);
rowan.override = { until: game.time + 300, action: "idle", target: { x: hx - 1, y: hy } };
bryn.override = { until: game.time + 300, action: "idle", target: { x: hx, y: hy } };

// ── (a) A fully formed think is applied exactly ───────────────────────────
const gotoX = 20, gotoY = 24;
check(world.isWalkable(gotoX, gotoY, F.WATER), "test goto cell is walkable");
{
    const acc0 = M.accepted;
    reply = JSON.stringify({
        say: "The grain is nearly ripe, Bryn.",
        goto: { x: gotoX, y: gotoY },
        action: "work",
        goal: "bring in the harvest before the rain",
        remember: "Bryn was at the hearth this morning",
    });
    game.requestThink(rowan);
    advanceTime(50);
    eq(M.accepted, acc0 + 1, "valid think accepted");
    eq(rowan.goal, "bring in the harvest before the rain", "goal applied");
    eq(rowan.memories[rowan.memories.length - 1], "Bryn was at the hearth this morning", "memory appended");
    check(rowan.override && rowan.override.target.x === gotoX && rowan.override.target.y === gotoY,
        "goto override applied");
    eq(rowan.override.action, "work", "action applied");
    check(rowan.say && rowan.say.text.indexOf("nearly ripe") >= 0, "say line active");
    const said = game.chronicle.find((e) => e.kind === "say" && e.text.indexOf("nearly ripe") >= 0);
    check(said, "say entered the chronicle");
    eq(said.text, "Rowan: “The grain is nearly ripe, Bryn.”", "the chronicle quotes it with curly quotes");
    check(rowan.lastThink && !rowan.lastThink.discarded, "lastThink recorded");

    // Heard by adjacent Bryn, who is now the priority thinker.
    check(bryn.heard && bryn.heard.from === "Rowan" && bryn.heard.text.indexOf("nearly ripe") >= 0,
        "adjacent villager heard the line");
    check(game.pickNextThinker() === bryn, "hearer takes think priority");

    // Speech bubble over Rowan + feed line: the conversation.
    advanceTime(100);
    const bubble = document.querySelector("#bubbles .bubble");
    check(bubble && /nearly ripe/.test(bubble.textContent), "speech bubble shown");
    const head = H.villagerScreen(rowan);
    check(Math.abs(parseFloat(bubble.style.left) - head.x) <= 1 && Math.abs(parseFloat(bubble.style.top) - head.y) <= 1,
        "the bubble sits on Rowan's head: " + bubble.style.left + "," + bubble.style.top + " vs " + [head.x, head.y]);
    check(/^Rowan: The grain is nearly ripe/.test(text("#feed .feed-line")), "conversation feed line");
    shot("conversation");
}

// ── (b) The hearer's prompt carries the heard line ────────────────────────
reply = JSON.stringify({ say: "Then I will save my axe arm for the sheaves." });
game.requestThink(bryn);
advanceTime(50);
{
    const p = prompts[prompts.length - 1];
    check(p.indexOf("Rowan just said to you: “") >= 0 && p.indexOf("nearly ripe") >= 0,
        "heard line included in the prompt");
    eq(bryn.heard, null, "heard line consumed by the think");
    check(rowan.heard && rowan.heard.from === "Bryn", "reply heard back by Rowan");
}

// The accepted think is EXECUTED: Rowan walks to the goto cell and, since it
// is a crop cell, works it.
check(simUntil(() => { const c = game.cellOf(rowan); return c.x === gotoX && c.y === gotoY; }, 20000, 100),
    "Rowan reaches his goto cell");
check(simUntil(() => rowan.activity === "working", 10000, 100), "Rowan works the crop cell he walked to");

// ── (c) Malformed output is DISCARDED; tier 0 carries on untouched ─────────
{
    const disB = M.discarded, accB = M.accepted;
    const goalB = rowan.goal, memB = rowan.memories.length;
    const water = game.riverCells[0];
    const bad = [
        "I think I shall go to the fields now.",            // no JSON at all
        '{"say": "unterminated',                             // broken JSON
        '{"say": 123}',                                      // wrong type
        '{"action": "fly"}',                                 // unknown action
        '{"goto": {"x": 9999, "y": 2}}',                     // out of bounds
        '{"goto": {"x": ' + water.x + ', "y": ' + water.y + "}}",   // water
        '{"goto": {"x": 1.5, "y": 2}}',                      // non-integer
    ];
    for (const b of bad) {
        reply = b;
        game.requestThink(rowan);
        advanceTime(50);
    }
    eq(M.discarded - disB, bad.length, "all malformed thinks discarded");
    eq(M.accepted, accB, "no malformed think accepted");
    check(rowan.goal === goalB && rowan.memories.length === memB, "discards left the villager untouched");
    const t0 = game.time;
    advanceTime(300);
    check(game.time > t0, "tier 0 keeps running after discards");
}

// ── (d) Memory cap: oldest out first ─────────────────────────────────────
rowan.memories.length = 0;
for (let i = 1; i <= 25; i++) {
    reply = JSON.stringify({ remember: "m" + i });
    game.requestThink(rowan);
    advanceTime(30);
}
eq(rowan.memories.length, MEMORY_CAP, "memory capped at " + MEMORY_CAP);
check(rowan.memories[0] === "m6" && rowan.memories[19] === "m25", "oldest memories evicted first");

// ── (e) The scheduler drives thinks through the same serial queue ─────────
{
    const n0 = M.accepted + M.discarded;
    reply = '{"goal":"scheduled thought"}';
    M.thinkT = 0;
    pump(8000);     // > THINK_INTERVAL sim s at 1x
    check(M.accepted + M.discarded > n0, "scheduler dispatched a think");
}
delete globalThis.__hearthmindGenerate;
rowan.override = null; bryn.override = null;

// ── Mind panel: click Rowan where he is drawn ─────────────────────────────
check(simUntil(() => !rowan.path, 15000, 100), "Rowan stops walking");
{
    const p = H.villagerScreen(rowan);
    click(p.x, p.y + 6);
    frames(2);
    check(H.selected === rowan, "villager selected by click");
    check(q("#mind-panel").style.display !== "none", "mind panel opened");
    eq(text("#mp-name"), "Rowan", "panel names the villager");
    check(/farmer · /.test(text("#mp-sub")), "panel shows the role: " + text("#mp-sub"));
    check(/%$/.test(q("#bar-hunger").style.width), "needs bar rendered (" + q("#bar-hunger").style.width + ")");
    check(text("#mp-goal").length > 0, "goal shown");
    check(document.querySelectorAll("#mp-memories li").length >= 1, "memories listed");
    check(text("#mp-think").length > 0, "last think shown");
    const home = rowan.home;
    const t = world.getTint(home.x, home.y);
    check(t.r < 0.75 && t.b > 0.95, "Rowan's home is tinted blue: " + JSON.stringify(t));
    const c = game.cellOf(rowan), under = world.getTint(c.x, c.y);
    check(under.b < 0.65 && under.r > 0.95, "the cell under Rowan is tinted gold: " + JSON.stringify(under));
    shot("mind");

    // Clicking him again closes the panel and clears the tints.
    click(p.x, p.y + 6);
    frames(2);
    eq(H.selected, null, "second click deselects");
    eq(q("#mind-panel").style.display, "none", "mind panel closed");
    check(world.getTint(home.x, home.y).r > 0.99, "home tint cleared");
}

console.log("hearthfolk mind ok");
