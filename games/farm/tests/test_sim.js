// Farm rules, driven through the same seams the game uses: the player's
// interactions, the market, speech channels, and the Foreman keeping the farm
// alive on its own across two days. The farm is stepped directly (no frames),
// so these checks are deterministic apart from the Foreman's line picks.
import { check, eq, near, frames } from "/lib/kit/test.js";

const F = window.__farm;
F.noVoices();
frames(2);
F.start();
frames(2);
F.shell.switchTo("pause");      // park the shell loop; the test steps the farm itself
const farm = F.farm, world = F.world;

function step(ms, dx, dy) {
    for (let t = 0; t < ms; t += 100) farm.step(100, dx || 0, dy || 0);
}

// ── Player: move, reach, interact ───────────────────────────────────────
{
    farm.auto = false;
    const trough = world.troughs["coop-water"];
    trough.fill = 20;
    F.movePlayerTo(trough.x, trough.y + 0.5);
    step(100);
    check(world.player.highlight && /water trough/i.test(world.player.highlight.label),
        "standing at the coop water trough highlights it: " + JSON.stringify(world.player.highlight));
    eq(world.player.targetHint, "water:coop", "the Foreman is told the player has this one");
    const water0 = world.resources.water;
    const res = F.interact();
    check(res.ok, "interact fills the trough");
    check(trough.fill > 99, "trough full: " + trough.fill);
    check(world.resources.water < water0, "water came out of the pool");
    check(world.dialog[0].speaker === "You" && /coop water/.test(world.dialog[0].text),
        "the player speaks the deed: " + JSON.stringify(world.dialog[0]));

    // Moving with the axes walks the avatar; the board clamps it.
    const x0 = world.player.x;
    step(1000, 1, 0);
    check(world.player.x > x0 + 3, "one second of right input walks ~4.6 tiles");
    step(20000, 1, 0);
    check(world.player.x <= world.cols, "the avatar stays on the board");

    // Nothing in reach: no action, a nope.
    F.movePlayerTo(1, 27);
    step(100);
    eq(world.player.highlight, null, "nothing to do in the far corner");
    check(!F.interact().ok, "interact with nothing in reach fails");
}

// ── Crops: plant, grow, harvest, sell ───────────────────────────────────
{
    const plot = world.crops.find((c) => c.stage === "empty");
    F.movePlayerTo(plot.x, plot.y);
    step(100);
    const gold0 = world.resources.gold;
    check(F.interact().ok, "plant an empty plot");
    eq(plot.stage, "seed", "plot sown");
    eq(world.resources.gold, gold0 - 3, "seed cost 3g");

    const ripe = world.crops.find((c) => c.stage === "ripe");
    const crops0 = world.resources.crops;
    check(world.actions.harvest(ripe.id).ok, "harvest a ripe crop");
    eq(world.resources.crops, crops0 + 1, "harvest banks a crop");
    const sale = world.actions.sell("crops");
    check(sale.ok && sale.gold > 0, "crops sell for gold: " + JSON.stringify(sale));
    check(!world.actions.sell("feed").ok, "feed is not sellable");
}

// ── Market: buying feed ─────────────────────────────────────────────────
{
    const barn0 = world.resources.barnFeed, gold0 = world.resources.gold;
    const res = F.buyFeed();
    check(res.ok && res.bought > 0, "buy feed: " + JSON.stringify(res));
    eq(world.resources.barnFeed, barn0 + res.bought, "feed lands in the barn");
    eq(world.resources.gold, gold0 - res.cost, "feed costs gold");
}

// ── Speech: per-speaker channels ────────────────────────────────────────
{
    const a = world.say("npc-tom", "First line from Tom.");
    const b = world.say("npc-tom", "Second line from Tom.");
    const dup = world.say("npc-tom", "second line   from tom.");
    check(dup === b, "a repeated line is not restacked");
    const c = world.say("npc-lily", "Lily talks over Tom.");
    step(100);
    const tom = world.npcs.find((n) => n.id === "npc-tom");
    const lily = world.npcs.find((n) => n.id === "npc-lily");
    check(tom.speech && tom.speech.text === a.text, "Tom's first line is live");
    check(lily.speech && lily.speech.text === c.text, "different speakers talk at once");
    check(!b.done && b.startedAt == null, "Tom's second line waits for his first");
    step(4000);
    check(a.done, "the first line finishes");
    check(b.startedAt != null, "then the second starts");
    step(6000);
    check(b.done && !tom.speech, "Tom falls silent after his queue drains");
}

// ── Self-running: two days with the Foreman in charge ───────────────────
{
    farm.auto = true;
    const day0 = world.clock.day;
    const alive0 = world.animals.filter((a) => a.alive).length;
    step(2 * world.dayLengthMs);
    eq(world.clock.day, day0 + 2, "two days pass");
    check(world.npcs.every((n) => n.station), "every worker owns a station");
    const stations = new Set(world.npcs.map((n) => n.station));
    eq(stations.size, 4, "the four stations are all manned");
    const alive = world.animals.filter((a) => a.alive).length;
    check(alive >= alive0, "no herd losses over two days (" + alive0 + " -> " + alive + ")");
    check(world.dialog.some((d) => d.speaker === "Foreman"), "the Foreman briefs and reports");
    const xp = world.npcs.reduce((s, n) => s + Object.values(n.stats).reduce((a, v) => a + v.level * 1000 + v.xp, 0), 0);
    check(xp > 0, "workers earn stat XP");
    const o = world.observe();
    check(o.npcs.every((n) => n.health >= 5), "worker health is floored, never lethal");
    near(o.objective.progress, world.resources.gold, 1, "objective tracks gold");
}

console.log("farm sim ok");
