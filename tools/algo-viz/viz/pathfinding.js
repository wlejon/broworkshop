// A* pathfinding on bro.ai.game.NavGrid. Click sets start, shift-click sets
// goal. The grid + obstacles + smoothed path are all drawn from the C++
// nav state — no JS pathfinding logic.

(function () {
    const WORLD_HALF = 20;   // navgrid spans [-20, 20] on both axes

    function createObstacles(n, rng) {
        const out = [];
        for (let i = 0; i < n; i++) {
            const hw = 0.8 + rng() * 2.0;
            const hd = 0.8 + rng() * 2.0;
            const x = (rng() * 2 - 1) * (WORLD_HALF - hw - 1);
            const z = (rng() * 2 - 1) * (WORLD_HALF - hd - 1);
            out.push({ x, z, hw, hd });
        }
        return out;
    }

    // Tiny seeded PRNG so "Randomize" is reproducible per seed.
    function mulberry32(seed) {
        let s = seed >>> 0;
        return function () {
            s = (s + 0x6D2B79F5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    VIZ.push({
        id: 'pathfinding',
        name: 'A* Pathfinding',
        category: 'Path & Navigation',
        subtitle: 'bro.ai.game NavGrid + A* with path smoothing. Click to set start, shift-click to set goal.',

        init({ stage, params }) {
            const canvas = document.createElement('canvas');
            stage.appendChild(canvas);
            const ctx = canvas.getContext('2d');

            const hint = document.createElement('div');
            hint.id = 'hint';
            hint.textContent = 'click: start · shift-click: goal · R: randomize';
            stage.appendChild(hint);

            const state = {
                cellSize: 0.5,
                padding:  0.4,
                seed:     1,
                numObstacles: 12,
                obstacles: [],
                nav: null,
                start: { x: -16, z: -16 },
                goal:  { x:  16, z:  16 },
                path:  [],
                animFrame: null,
            };

            function rebuild() {
                const rng = mulberry32(state.seed);
                state.obstacles = createObstacles(state.numObstacles, rng);
                state.nav = bro.ai.game.createNavGrid({
                    minX: -WORLD_HALF, minZ: -WORLD_HALF,
                    maxX:  WORLD_HALF, maxZ:  WORLD_HALF,
                    cellSize: state.cellSize,
                    obstacles: state.obstacles,
                    padding: state.padding,
                });
                refindPath();
            }

            function refindPath() {
                if (!state.nav) { state.path = []; return; }
                state.path = state.nav.findPath(
                    state.start.x, state.start.z,
                    state.goal.x,  state.goal.z) || [];
            }

            // World→screen mapping (square viewport, centered).
            function worldToScreen() {
                const w = canvas.width, h = canvas.height;
                const side = Math.min(w, h);
                const scale = side / (2 * WORLD_HALF);
                const ox = (w - side) * 0.5 + side * 0.5;
                const oy = (h - side) * 0.5 + side * 0.5;
                return { scale, ox, oy };
            }
            function w2s(x, z, m) { return [m.ox + x * m.scale, m.oy + z * m.scale]; }
            function s2w(sx, sy, m) {
                return { x: (sx - m.ox) / m.scale, z: (sy - m.oy) / m.scale };
            }

            function draw() {
                const w = canvas.clientWidth | 0, h = canvas.clientHeight | 0;
                if (canvas.width !== w || canvas.height !== h) {
                    canvas.width = w; canvas.height = h;
                }
                const m = worldToScreen();

                ctx.fillStyle = '#050505';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Walkable cells — sample on the grid.
                const cs = state.cellSize;
                ctx.fillStyle = '#0e1820';
                for (let z = -WORLD_HALF + cs * 0.5; z < WORLD_HALF; z += cs) {
                    for (let x = -WORLD_HALF + cs * 0.5; x < WORLD_HALF; x += cs) {
                        if (state.nav.isWalkable(x, z)) {
                            const [px, py] = w2s(x - cs*0.5, z - cs*0.5, m);
                            ctx.fillRect(px, py, cs * m.scale - 1, cs * m.scale - 1);
                        }
                    }
                }

                // Obstacles (truth, before padding).
                ctx.fillStyle = '#3a1a1a';
                ctx.strokeStyle = '#ff6b6b';
                ctx.lineWidth = 1;
                for (const o of state.obstacles) {
                    const [px, py] = w2s(o.x - o.hw, o.z - o.hd, m);
                    const sw = o.hw * 2 * m.scale, sh = o.hd * 2 * m.scale;
                    ctx.fillRect(px, py, sw, sh);
                    ctx.strokeRect(px + 0.5, py + 0.5, sw - 1, sh - 1);
                }

                // Path
                if (state.path.length >= 2) {
                    ctx.strokeStyle = '#74b9ff';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    for (let i = 0; i < state.path.length; i++) {
                        const [px, py] = w2s(state.path[i].x, state.path[i].z, m);
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.stroke();

                    ctx.fillStyle = '#74b9ff';
                    for (const p of state.path) {
                        const [px, py] = w2s(p.x, p.z, m);
                        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
                    }
                } else if (state.start && state.goal) {
                    // No path: dashed line in red so it's obvious.
                    ctx.strokeStyle = '#ff6b6b';
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    const [a, b] = w2s(state.start.x, state.start.z, m);
                    const [c, d] = w2s(state.goal.x,  state.goal.z,  m);
                    ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
                    ctx.setLineDash([]);
                }

                // Endpoints
                drawDot(ctx, w2s(state.start.x, state.start.z, m), '#7bed9f', 'S');
                drawDot(ctx, w2s(state.goal.x,  state.goal.z,  m), '#ffa502', 'G');

                // Stats
                ctx.fillStyle = '#888';
                ctx.font = '11px monospace';
                ctx.fillText(`waypoints: ${state.path.length}`, 10, 18);
            }

            function drawDot(ctx, [x, y], color, label) {
                ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#000';
                ctx.font = 'bold 10px monospace';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(label, x, y);
                ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
            }

            function loop() {
                draw();
                state.animFrame = requestAnimationFrame(loop);
            }

            // --- Input -----------------------------------------------------------
            function onClick(e) {
                const r = canvas.getBoundingClientRect();
                const sx = e.clientX - r.left, sy = e.clientY - r.top;
                canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
                const wp = s2w(sx, sy, worldToScreen());
                if (wp.x < -WORLD_HALF || wp.x > WORLD_HALF ||
                    wp.z < -WORLD_HALF || wp.z > WORLD_HALF) return;
                if (e.shiftKey) state.goal  = wp;
                else            state.start = wp;
                refindPath();
            }
            function onKey(e) {
                if (e.key === 'r' || e.key === 'R') {
                    state.seed = (state.seed + 1) | 0;
                    seedInput.value = state.seed;
                    rebuild();
                }
            }
            canvas.addEventListener('click', onClick);
            window.addEventListener('keydown', onKey);

            // --- Params ----------------------------------------------------------
            const seedInput = mkNumber(params, 'seed', state.seed, 1, v => {
                state.seed = v | 0; rebuild();
            });
            mkRange(params, 'cell',     state.cellSize,    0.25, 1.5, 0.05, v => {
                state.cellSize = v; rebuild();
            }, v => v.toFixed(2));
            mkRange(params, 'padding',  state.padding,     0.0,  1.0, 0.05, v => {
                state.padding = v; rebuild();
            }, v => v.toFixed(2));
            mkRange(params, 'obstacles', state.numObstacles, 0,   30, 1, v => {
                state.numObstacles = v | 0; rebuild();
            }, v => `${v|0}`);
            mkButton(params, 'Randomize', () => {
                state.seed = (state.seed + 1) | 0;
                seedInput.value = state.seed; rebuild();
            });

            rebuild();
            loop();

            return { canvas, hint, onClick, onKey, state };
        },

        destroy(handle) {
            if (handle.state && handle.state.animFrame) cancelAnimationFrame(handle.state.animFrame);
            if (handle.canvas) handle.canvas.removeEventListener('click', handle.onClick);
            window.removeEventListener('keydown', handle.onKey);
        },
    });

    // -- shared mini control helpers (also used by other viz modules) -----------
    function mkRange(parent, label, value, min, max, step, onChange, fmt) {
        const wrap = document.createElement('label');
        wrap.className = 'field';
        wrap.innerHTML = `<span class="lbl">${label}</span>`;
        const input = document.createElement('input');
        input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = fmt ? fmt(value) : value;
        input.oninput = () => {
            const v = parseFloat(input.value);
            num.textContent = fmt ? fmt(v) : v;
            onChange(v);
        };
        wrap.appendChild(input); wrap.appendChild(num);
        parent.appendChild(wrap);
        return input;
    }
    function mkNumber(parent, label, value, step, onChange) {
        const wrap = document.createElement('label');
        wrap.className = 'field';
        wrap.innerHTML = `<span class="lbl">${label}</span>`;
        const input = document.createElement('input');
        input.type = 'number'; input.value = value; input.step = step;
        input.style.width = '70px';
        input.onchange = () => onChange(parseFloat(input.value));
        wrap.appendChild(input); parent.appendChild(wrap);
        return input;
    }
    function mkSelect(parent, label, options, value, onChange) {
        const wrap = document.createElement('label');
        wrap.className = 'field';
        wrap.innerHTML = `<span class="lbl">${label}</span>`;
        const sel = document.createElement('select');
        for (const opt of options) {
            const o = document.createElement('option');
            o.value = opt; o.textContent = opt;
            if (opt === value) o.selected = true;
            sel.appendChild(o);
        }
        sel.onchange = () => onChange(sel.value);
        wrap.appendChild(sel); parent.appendChild(wrap);
        return sel;
    }
    function mkButton(parent, label, onClick) {
        const b = document.createElement('button');
        b.className = 'opbtn'; b.textContent = label; b.onclick = onClick;
        parent.appendChild(b); return b;
    }

    // expose so other viz modules can use them without copy-paste
    window.AVUI = { mkRange, mkNumber, mkSelect, mkButton };
})();
