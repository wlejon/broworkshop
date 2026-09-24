# Crater

Turn-based 2–6 player artillery on destructible terrain. An authoritative
server plus a thin rendering client over `bro.net`.

## Files

| File        | Runs on | What                                                              |
|-------------|---------|-------------------------------------------------------------------|
| `shared.js` | both    | constants, seeded heightmap, ballistics, crater carving, damage   |
| `match.js`  | server  | lobby, ready gate, turn order, shot resolution, bots, win, timeout |
| `server.js` | server  | `NetRoom.host` on port 27100 wired to `match.js`                  |
| `game.js`   | client  | arcade-shell plugin: connect, lobby flow, aim, shell animation     |
| `draw.js`   | client  | canvas rendering (sky, terrain, tanks, shell, blast, dust)        |
| `ui.js`     | client  | lobby roster, HUD player list, toast                              |

Shared plumbing comes from `/lib`: the arcade shell (screens, input, audio,
save), `lib/netroom.js` (hello/welcome handshake, JSON framing, host and
client), and `lib/arcade/netplay.js` (the name + server form).

## How it stays in sync

```
  client (game.js)                          server (server.js → match.js)
  ── hello {name} ───────────────────────▶  accept / deny ("Server full", "Match in progress")
  ◀─────────────────────────── welcome {id}
  ── ready / addBot / start ────────────▶   lobby rules
  ◀── state {phase:"lobby", ...} ──────────
  ◀── match {seed, hm, players, turn} ─────  heightmap + placement
  ── fire {angle, power, dir} ──────────▶   simulateShot, carveCrater, blastDamage
  ◀── shot {path params, craterCols, damages, dead, nextTurn}
  ◀── over {winnerId} ─── (after the shell lands; lobby returns 5 s later)
```

The client animates the shell from the same launch parameters and applies
the server's `craterCols` diff when it lands, so every client's terrain is
the server's terrain. Physics lives only in `shared.js`, which both sides
import.

## Running

From the launcher, the server starts automatically (`launcher/apps.json`).
Standalone:

```
bro-server games/crater games/crater/server.js
bro games/crater
```

## Controls

← / → face, ↑ / ↓ angle, Q / E power, Space fire, Esc menu.

## Tests

- `tests/test_match.js`: physics and the full rule set in-process, with a fake
  room and a fake clock.
- `tests/test_netplay.js`: the server in a Worker, the page connecting over
  loopback through the real menus, a bot, a shot each way, pause, leave.
