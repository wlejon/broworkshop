# Tumble — product brief

**Player fantasy:** You’re a tabletop engineer. Build a short marble run with a tight piece budget, drop the marble, and beat the clock into the cup.

**Success in 15 minutes:** Finish levels 1–3 with any medal. Understand place → Space → cup without reading the full howto.

## Product goals

1. **Obvious first loop** — Drop-In teaches place and run without a wall of text.
2. **Clear progression** — title shows resume + clears; level select shows medals and what’s next.
3. **Satisfying finish** — time, medal, new-best, next level name (or tour complete).
4. **Readable chrome** — BUILD/RUN mode, budget, par, and goal stay scannable while building.
5. **Self-contained** — solo, offline, no netplay or models.

## Out of scope (this pass)

- New piece types or major physics retunes  
- Level editor / user levels  
- Multiplayer or online leaderboards  
- Full audio music bed  

## Checklist

- [x] Title: continue label + progress summary  
- [x] Level select: medals, taglines, current level  
- [x] First-level coach (in-HUD tips)  
- [x] Complete: new best, next name, last-level menu  
- [x] Level tagline toast on load  
- [x] Goal pulse + stronger complete cue  
- [x] How-to tightened  
- [x] Headless gameplay harness (`tests/test_gameplay.js`)  
- [x] Fail soft-lock fix (ground-rest timeout after last marble)  
- [x] Restart-after-complete stability (teardown + goal-pulse gen)  
- [ ] Optional later: more levels, replay ghost, accessibility, harder Drop-In  

## Headless verification

```bash
bro-headless games/tumble games/tumble/tests/test_smoke.js
bro-headless games/tumble games/tumble/tests/test_gameplay.js
```
