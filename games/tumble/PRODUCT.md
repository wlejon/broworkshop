# Tumble — small full game

**Player fantasy:** Tabletop engineer. Build a short marble run under a tight piece budget, drop the marble, beat the clock into the cup.

**Session goal:** Clear all 8 levels in one sitting (~15–30 minutes). Earn any medal on each; chase gold later.

## Campaign arc

| # | Level | Teaches |
|---|--------|---------|
| 1 | Drop-In | Space / build / run (free-fall tutorial) |
| 2 | Plank Walk | Lateral path — boosters & ramps |
| 3 | Bank Shot | Walls + cornering |
| 4 | Springboard | Bumpers |
| 5 | Funnel Vision | Chutes |
| 6 | Long Haul | Boosters over distance |
| 7 | Helicopters | Spinners |
| 8 | Grand Tour | Full kit finale |

## Product pillars

1. **Readable first minute** — coach + free Drop-In, then a real puzzle.
2. **Fair fail** — empty runs return to BUILD; no soft-lock on ground marbles.
3. **Snappy pieces** — slick ramps, conveyor boosters, open cup lips (lateral entry works).
4. **Clear progression** — title resume, medals, next-level copy, tour complete.
5. **Self-contained** — solo, offline, no netplay or models.

## Headless verification

```bash
bro-headless games/tumble games/tumble/tests/test_smoke.js
bro-headless games/tumble games/tumble/tests/test_gameplay.js
bro-headless games/tumble games/tumble/tests/test_campaign.js
```

Verified solution layouts live in `solutions.js` (also `window.__tumble.applySolution(i)`).

## Known design notes

- **Booster rot 0** faces +X (follow the arrow). **Ramp rot 2** drains downhill +X (slope low-end). R to cycle.
- Drop-In is intentionally free with Space; Plank Walk is the first skill check (coach teaches booster aim).
- Funnel Vision free-falls; other mid/late levels have a fair booster runway that still leaves room for clever routes.
- Goal uses a low lip (not tall walls) so runways can roll into the cup.

## Out of scope (later)

- Level editor, user levels, music bed, online leaderboards, ghost replays
