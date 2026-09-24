// Chomper rules — Chomper's movement, pellets, power pellets, ghost
// collisions, lives and levels. No DOM, audio or drawing.
//
// createChomper(rng) starts level 1. The plugin calls step(game, dt ms,
// turn) every frame, turn = a buffered direction index (DIRS) or -1.
// Events on game.events: chomp · power · eatghost {points} · die ·
// levelclear · gameover. After levelclear the plugin shows its screen and
// calls nextLevel(game).

import {
    COLS, PAC_SPAWN, createMaze, wrapCol, passableForPac, eatPelletAt,
} from "/app/maze.js";
import { DIRS, createGhosts, resetGhost, stepGhost, frighten, isLoose } from "/app/ghosts.js";

export { DIRS };
export const PAC_SPEED = 7;            // tiles/s
export const DIE_MS = 1400;
export const START_LIVES = 3;
export const PELLET_POINTS = 10;
export const POWER_POINTS = 50;
const FRIGHT_WARN_MS = 2000;
const FRIGHT_BLINK_MS = 200;
const HIT_R = 0.55;

export function createChomper(rng = Math.random) {
    const game = {
        rng,
        score: 0,
        lives: START_LIVES,
        level: 1,
        phase: "playing",      // "playing" | "dying" | "cleared" | "over"
        dieTimer: 0,
        chain: 0,              // ghosts eaten on this power pellet
        maze: null,
        ghosts: null,
        pac: { c: 0, r: 0, dir: 1, nextDir: -1, mouth: 0 },
        events: [],
    };
    startLevel(game);
    return game;
}

function startLevel(game) {
    game.maze = createMaze();
    game.ghosts = createGhosts();
    game.phase = "playing";
    game.chain = 0;
    resetPac(game);
}

/** After the level-clear screen. */
export function nextLevel(game) {
    game.level++;
    startLevel(game);
}

function resetPac(game) {
    Object.assign(game.pac, { c: PAC_SPAWN.c, r: PAC_SPAWN.r, dir: 1, nextDir: -1, mouth: 0 });
}

/** How long a power pellet lasts: 8 s, half a second less per level, never under 3. */
export function frightMs(level) {
    return Math.max(3000, 8000 - (level - 1) * 500);
}

/** Frightened ghosts flash white for their last two seconds. */
export function frightBlink(game) {
    let min = Infinity;
    for (const g of game.ghosts) if (g.mode === "frightened") min = Math.min(min, g.frightTimer);
    return min < FRIGHT_WARN_MS && Math.floor(min / FRIGHT_BLINK_MS) % 2 === 0;
}

export function step(game, dt, turn = -1) {
    if (game.phase === "dying") {
        game.dieTimer -= dt;
        if (game.dieTimer > 0) return;
        if (game.lives <= 0) {
            game.phase = "over";
            game.events.push({ type: "gameover" });
            return;
        }
        resetPac(game);
        game.ghosts.forEach(resetGhost);
        game.phase = "playing";
        return;
    }
    if (game.phase !== "playing") return;

    if (turn >= 0) game.pac.nextDir = turn;
    movePac(game, dt);
    for (const g of game.ghosts) stepGhost(game.maze, g, dt, game.pac, game.rng);
    collide(game);
    if (game.phase === "playing" && game.maze.pellets <= 0) {
        game.phase = "cleared";
        game.events.push({ type: "levelclear" });
    }
}

function canMove(m, c, r, dir) {
    return passableForPac(m, wrapCol(Math.round(c) + DIRS[dir].dx), Math.round(r) + DIRS[dir].dy);
}

// Turns take at a tile centre (buffered until then); walls stop him there.
function movePac(game, dt) {
    const pac = game.pac, m = game.maze;
    const stepLen = PAC_SPEED * dt / 1000;
    const ci = Math.round(pac.c), ri = Math.round(pac.r);
    const atCenter = Math.abs(pac.c - ci) < stepLen * 0.7 && Math.abs(pac.r - ri) < stepLen * 0.7;

    if (atCenter && pac.nextDir >= 0 && pac.nextDir !== pac.dir && canMove(m, ci, ri, pac.nextDir)) {
        pac.c = ci;
        pac.r = ri;
        pac.dir = pac.nextDir;
        pac.nextDir = -1;
    }
    if (atCenter && !canMove(m, pac.c, pac.r, pac.dir)) {
        pac.c = ci;
        pac.r = ri;
        return;
    }
    const d = DIRS[pac.dir];
    pac.c = wrapCol(pac.c + d.dx * stepLen);
    pac.r += d.dy * stepLen;
    if (pac.c < -0.5) pac.c = COLS - 0.5;
    if (pac.c > COLS - 0.5) pac.c = -0.5;
    pac.mouth += dt * 0.012;

    const eaten = eatPelletAt(m, Math.round(pac.c), Math.round(pac.r));
    if (eaten === ".") {
        game.score += PELLET_POINTS;
        game.events.push({ type: "chomp" });
    } else if (eaten === "o") {
        game.score += POWER_POINTS;
        game.chain = 0;
        for (const g of game.ghosts) frighten(g, frightMs(game.level));
        game.events.push({ type: "power" });
    }
}

// Frightened ghosts are worth 200, 400, 800, 1600 in a chain; others kill.
function collide(game) {
    const pac = game.pac;
    for (const g of game.ghosts) {
        if (!isLoose(g) || (g.c - pac.c) ** 2 + (g.r - pac.r) ** 2 >= HIT_R * HIT_R) continue;
        if (g.mode === "frightened") {
            game.chain++;
            const points = Math.min(1600, 200 * 2 ** (game.chain - 1));
            game.score += points;
            g.mode = "eaten";
            game.events.push({ type: "eatghost", points, c: g.c, r: g.r });
        } else {
            game.lives--;
            game.phase = "dying";
            game.dieTimer = DIE_MS;
            game.events.push({ type: "die" });
            return;
        }
    }
}

export function drainEvents(game) {
    const out = game.events;
    game.events = [];
    return out;
}
