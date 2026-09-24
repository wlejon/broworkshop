// Fintank end to end through the real menus: slots, shop, a day of feeding /
// collecting / fighting (mouse + hotkeys), day clear, settings, game over,
// high scores. Run: scripts/validate.sh games/fintank
import { check, eq, frames, press, q, text, clickOn, simUntil, shot } from "/lib/kit/test.js";

for (const n of [1, 2, 3]) localStorage.removeItem("fintank:slot" + n);
frames(10);
const H = window.__fintank;
check(H, "__fintank exposed");
const save = H.shell.api.save;
save.set("hsDays", []);
save.set("highScore", 0);
save.set("difficulty", 1);          // .storage.json persists between runs
save.set("sfxVol", 80);

const visible = (id) => !document.getElementById(id).hidden;
const tank = () => H.tank;

// Canvas drawing coordinates -> client pixels (the canvas may be stretched).
function toClient(x, y) {
    const r = document.getElementById("view").getBoundingClientRect();
    const v = H.shell.api.view;
    return { x: r.left + x * r.width / v.width(), y: r.top + y * r.height / v.height() };
}
function clickTank(x, y) {
    const p = toClient(x, y);
    click(p.x, p.y);
    frames(1);
}

// --- Title -> slots -> shop -------------------------------------------------------

check(visible("screen-title"), "title up");
shot("title");
press("Enter");                                   // PLAY
frames(2);
eq(H.screen, "slots", "PLAY opens the slot picker");
eq(text('[data-action="slot-1"]'), "SLOT 1 - NEW", "unplayed slot reads NEW");
press("Enter");                                   // SLOT 1
frames(2);
eq(H.screen, "shop", "a slot opens the shop");
check(visible("hud"), "HUD shows over the shop");
eq(text("#shop-subtitle"), "DAY 1 - 200 COINS", "shop subtitle");
eq(q("#shop-items").children.length, 1 + 6 + 3 + 5 + 1, "pellet + 6 fish + 3 upgrades + 5 pets + start");
eq(text("#hud-time"), "—", "no clock in the shop");
eq(text("#hud-fish"), "2/10", "two starter fish");

clickOn('[data-action="shop-1"]');                // FISH: GLIMFIN 100C
frames(2);
eq(tank().slot.coins, 100, "fish bought for 100");
eq(tank().slot.fish.length, 3, "three fish owned");
eq(text("#shop-subtitle"), "DAY 1 - 100 COINS", "subtitle refreshed");
clickOn('[data-action="shop-6"]');                // PEARLSCALE 7000C: too dear
frames(2);
eq(tank().slot.coins, 100, "unaffordable fish refused");
shot("shop");

clickOn('[data-action="start-day"]');
frames(3);
eq(H.screen, "playing", "START DAY plays");
eq(tank().fish.length, 3, "tank stocked from the slot");
eq(text("#hud-fish"), "3/10", "HUD fish");
eq(text("#hud-time"), "120", "two-minute day");
check(localStorage.getItem("fintank:slot1"), "slot saved when the day starts");

// --- Feeding: mouse drops pellets, Space drops a row ---------------------------------

clickTank(600, 300);
eq(tank().pellets.length, 1, "click on water drops a pellet");
press(" ");
frames(1);
eq(tank().pellets.length, 6, "Space drops five more");

// A hungry fish eats, then drops a coin; clicking the coin banks it.
const f0 = tank().fish[0];
f0.hunger = 40;
check(simUntil(() => tank().fish.some((f) => f.hasFood), 8000, 100), "a fish ate a pellet");
H.feedFish(0);
check(simUntil(() => tank().coins.length > 0, 4000, 100), "a fed fish drops a coin");
const coin = tank().coins[0];
const before = tank().slot.coins;
clickTank(coin.x, coin.y);
check(tank().slot.coins === before + coin.value, "clicking a coin banks it (" + before + " -> " + tank().slot.coins + ")");
eq(tank().today.coins, coin.value, "day tally counts it");

// --- Intruders: clicks hurt them; a kill pays --------------------------------------

H.spawnIntruder("drifter");
const iu = tank().intruders[tank().intruders.length - 1];
check(simUntil(() => iu.entered, 8000, 50), "intruder swims in");
const hp0 = iu.hp, coins0 = tank().slot.coins;
for (let i = 0; i < 40 && !iu.dead; i++) clickTank(iu.x, iu.y);
check(iu.dead, "clicked to death (" + hp0 + " hp)");
eq(tank().slot.coins, coins0 + iu.def.reward, "kill reward paid");
eq(tank().today.kills, 1, "kill counted");
check(simUntil(() => !tank().intruders.includes(iu), 2000, 100), "corpse despawns");

// --- Mid-day hotkeys and the pet -----------------------------------------------------

H.addCoins(5000);
const nFish = tank().fish.length;
press("2");                                       // fish tier 1
frames(1);
eq(tank().fish.length, nFish + 1, "hotkey 2 buys a glimfin into the tank");
press("1");                                       // pellet upgrade
frames(1);
eq(tank().slot.pelletTier, 2, "hotkey 1 upgrades pellets");
const pet = H.buy("pet_bubbler");
check(pet.ok && tank().pet && tank().pet.id === "bubbler", "pet egg hatches a bubbler");
frames(1);
eq(text("#hud-pet"), "BUBBLER", "HUD pet");
H.feed(400); H.feed(800);
H.spawnIntruder("snatcher");
frames(30);
shot("play");

// --- Day clear -> shop -> day 2 -----------------------------------------------------

H.endDay();
frames(2);
eq(H.screen, "dayclear", "day clear screen");
const stats = text("#dayclear-stats");
check(/^DAY 1 SURVIVED\nFISH REMAINING: \d+\nCOINS COLLECTED: \d+\nINTRUDERS DEFEATED: 1\nBONUS: \+\d+C\nBALANCE: \d+C$/.test(stats),
    "day stats: " + stats);
press("Enter");                                   // VISIT SHOP
frames(2);
eq(H.screen, "shop", "on to the shop");
eq(tank().slot.day, 2, "day 2");
check(/^DAY 2 - \d+ COINS$/.test(text("#shop-subtitle")), "shop for day 2");
clickOn('[data-action="start-day"]');
frames(2);
eq(H.screen, "playing", "day 2 under way");
eq(text("#hud-day"), "2", "HUD day");

// --- Settings through the menu; stored in the shell save ---------------------------------

press("Escape");
frames(2);
eq(H.screen, "pause", "Esc pauses");
H.shell.switchTo("settings");
frames(2);
eq(text("#opt-difficulty"), "NORMAL", "difficulty NORMAL");
eq(text("#opt-sfxVol"), "80", "sfx 80");
clickOn('[data-action="cycle-difficulty"]');
clickOn('[data-action="cycle-sfx"]');
frames(1);
eq(text("#opt-difficulty"), "HARD", "difficulty cycles to HARD");
eq(text("#opt-sfxVol"), "90", "sfx cycles to 90");
const stored = JSON.parse(localStorage.getItem("fintank:settings"));
check(stored.difficulty === 2 && stored.sfxVol === 90 && stored.activeSlot === 1 && "highScore" in stored,
    "settings share one save without clobbering: " + JSON.stringify(stored));
clickOn('[data-action="cycle-difficulty"]');
clickOn('[data-action="cycle-difficulty"]');     // EASY -> NORMAL
frames(1);
eq(text("#opt-difficulty"), "NORMAL", "back to NORMAL");

// --- Game over, high scores, retry ------------------------------------------------------

H.shell.switchTo("playing");
frames(1);
for (const f of tank().fish) f.dead = true;
frames(3);
eq(H.screen, "gameover", "losing every fish ends the run");
const over = text("#gameover-stats");
// Best day = the best day survived (day 1 cleared, day 2 lost).
check(/ALL YOUR FISH WERE LOST/.test(over) && /Best Day {5}1  ·  NEW BEST/.test(over), "game over text: " + over);
eq(save.highScore(), 1, "best day is the high score");
eq((save.get("hsDays") || []).length, 1, "run recorded in the high-score list");
shot("gameover");

press("ArrowDown");                               // TRY AGAIN -> HIGH SCORES
press("Enter");
frames(2);
eq(H.screen, "highscores", "high scores screen");
check(/^1\. DAY 1 {2}COINS \d+ {2}SLOT 1$/.test(text("#hs-list")), "score row: " + text("#hs-list"));
press("Enter");                                   // BACK
frames(2);
eq(H.screen, "title", "back to the title");

press("Enter");                                   // PLAY -> slots
frames(2);
check(/^SLOT 1 - DAY 2 - \d+C - 0 FISH$/.test(text('[data-action="slot-1"]')), "played slot label: " + text('[data-action="slot-1"]'));
H.shell.switchTo("gameover");
frames(1);
clickOn('#screen-gameover [data-action="tryagain"]');
frames(2);
eq(H.screen, "shop", "TRY AGAIN returns to the shop");
eq(tank().slot.day, 1, "retry restarts at day 1");
eq(tank().slot.fish.length, 2, "retry restocks two fish");
check(tank().slot.coins >= 150, "retry keeps at least 150 coins");

console.log("FINTANK: all assertions passed");
