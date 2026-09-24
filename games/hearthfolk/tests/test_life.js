// Tier-0 life through a full day and night: needs decay, every villager
// eats, sleeps and works, and the work shows in the world (harvests, felled
// trees, cut stone, meals, a tended fire, crop decals that follow their stage).
import { check, frames, simUntil } from "/lib/kit/test.js";

const H = window.HEARTH;
H.noModels();
frames(2);
const game = H.start();
frames(4);
const world = H.world;
const { TILE: T, L_OVER } = H.defs;
const CROP_IDS = [T.CROP_A, T.CROP_B, T.CROP_C];
const pump = (ms) => { for (let t = 0; t < ms; t += 100) advanceTime(100); };

// Needs decay while nobody is eating yet.
{
    const h0 = game.villagers.map((v) => v.needs.hunger);
    const ate0 = game.villagers.map((v) => v.counts.ate);
    pump(3000);
    game.villagers.forEach((v, i) => {
        if (v.activity !== "eating" && v.counts.ate === ate0[i])
            check(v.needs.hunger > h0[i], v.name + " hunger decays (" +
                h0[i].toFixed(2) + " -> " + v.needs.hunger.toFixed(2) + ")");
    });
}

// A full day and night at 4x: 120 sim s.
const cropSnap = game.crops.map((c) => c.stage).join(",");
H.setSpeed(4);
check(simUntil(() => game.day() >= 2 && game.tod() > 0.02, 60000, 100), "day 2 dawns");
H.setSpeed(1);

for (const v of game.villagers) {
    check(v.counts.ate >= 1, v.name + " ate (" + v.counts.ate + "x)");
    check(v.counts.slept >= 1, v.name + " slept (" + v.counts.slept + "x)");
    check(v.counts.worked >= 1, v.name + " worked (" + v.counts.worked + " ticks)");
}
const s = game.stats;
check(s.harvests >= 1, "crops were harvested (" + s.harvests + ")");
check(s.treesChopped >= 1, "trees were felled (" + s.treesChopped + ")");
check(s.stoneMined >= 1, "stone was cut (" + s.stoneMined + ")");
check(s.mealsCooked >= 1, "meals were cooked (" + s.mealsCooked + ")");
check(s.fireTends >= 1, "the elder tended the hearth (" + s.fireTends + ")");
check(game.crops.map((c) => c.stage).join(",") !== cropSnap, "crop stages advanced");
for (const c of game.crops)
    check(world.getTile(c.x, c.y, L_OVER) === CROP_IDS[c.stage], "crop decal tracks its stage");
check(game.chronicle.some((e) => e.kind === "day" && e.text.indexOf("Day 2") >= 0),
    "chronicle recorded the new day");
check(document.querySelectorAll("#chronicle-list .chron-entry").length >= 5, "chronicle panel has entries");

// The HUD reads the clock, the think tally and the stores, with real glyphs.
{
    const txt = (id) => document.getElementById(id).textContent;
    check(/^Day 2$/.test(txt("hud-day")), "day readout: " + txt("hud-day"));
    check(/^✓ \d+  ✕ \d+$/.test(txt("hud-thinks")), "think tally: " + txt("hud-thinks"));
    check(/^food \d+ · wood \d+ · stone \d+ · meals \d+$/.test(txt("hud-res")),
        "stores readout: " + txt("hud-res"));
    check(/^minds: off/.test(txt("mind-chip")), "minds are off without models: " + txt("mind-chip"));
}

console.log("hearthfolk life ok");
