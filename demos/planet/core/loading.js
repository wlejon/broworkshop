// The planet's loading indicators. While it starts, a panel over the stage
// says what it is doing (its kernels compiling, the world being made, the
// first ground being produced and its shaders built) with a bar, and fades
// once the view is ready. After that, a chip in the corner says what is still
// being made whenever the view has work outstanding (new ground as the camera
// moves, shaders a new view needs), from the scene's own account of it
// (scene.pendingWork(), which the core feeds the tiles still wanted).

// pendingWork()'s lines, in words; null leaves a line out (the exposure
// settling is not loading).
function describe(line) {
    const [kind, rest = ''] = line.split(/:\s*/, 2);
    const n = parseInt(rest, 10);
    switch (kind) {
        case 'ground tiles': return `Producing ground · ${n} tile${n === 1 ? '' : 's'}`;
        case 'pipelines': return /building/.test(rest) ? `Building shaders · ${n}` : 'Building shaders';
        case 'world service': return 'Streaming the world';
        case 'exposure': return null;
        default: return line;
    }
}

const visibleWork = (scene) => scene.pendingWork().map(describe).filter(Boolean);

// The boot's phases: each its share of the bar.
const SHARE = { compile: [0, 0.45], create: [0.45, 0.55], ground: [0.55, 1] };
// Frames running with no work before the boot panel goes, and the most
// frames it waits for that once the ground is drawn (an endless line, a
// shader that never settles, does not hold the view back).
const QUIET_FRAMES = 8;
const MAX_SETTLE_FRAMES = 600;
// The corner chip shows work only once it has lasted this long (ms), so a
// tile or two produced between frames does not flicker it.
const CHIP_DELAY_MS = 300;

export function createLoading(name) {
    const worldName = name[0].toUpperCase() + name.slice(1);
    const panel = document.createElement('div');
    panel.id = 'loading';
    panel.innerHTML =
        '<div class="title"></div><div class="step"></div>' +
        '<div class="k-progress"><div></div></div><div class="detail"></div>';
    panel.querySelector('.title').textContent = worldName;
    const step = panel.querySelector('.step');
    const bar = panel.querySelector('.k-progress > div');
    const detail = panel.querySelector('.detail');
    document.body.appendChild(panel);

    const chip = document.createElement('div');
    chip.id = 'busy';
    chip.hidden = true;
    chip.innerHTML = '<span class="spin"></span><span class="what"></span>';
    const chipText = chip.querySelector('.what');
    document.body.appendChild(chip);

    let fraction = 0, created = 0;
    const show = (phase, f, label, more = '') => {
        const [a, b] = SHARE[phase];
        // The bar never goes back (a phase's own estimate can).
        fraction = Math.max(fraction, a + (b - a) * Math.min(1, Math.max(0, f)));
        bar.style.width = `${(fraction * 100).toFixed(1)}%`;
        if (step.textContent !== label) step.textContent = label;
        if (detail.textContent !== more) detail.textContent = more;
    };

    // Boot state once the planet runs.
    let booting = true, quiet = 0, settleFrames = 0, groundSeen = 0;
    let busySince = -1;

    return {
        // Its kernels compiling: `done` of `total`.
        compiling(done, total) {
            show('compile', done / total, 'Compiling kernels', `${done} of ${total}`);
        },
        // The @cpu kernels' machine code being built.
        buildingCpu() {
            show('compile', 1, 'Building CPU kernels');
        },
        // A step of making the world (its systems, its ground).
        creating(label) {
            show('create', ++created / 8, label);
        },
        // Each frame of the running planet: the scene and the tile cache.
        frame(scene, cache) {
            const work = visibleWork(scene);
            if (booting) {
                const pending = cache.pending;
                groundSeen = Math.max(groundSeen, pending + cache.stats.produced);
                const made = groundSeen > 0 ? cache.stats.produced / groundSeen : 0;
                show('ground', pending === 0 ? 1 : made * 0.95, work[0] ?? 'Drawing the ground',
                     work.slice(1).join(' · '));
                quiet = work.length === 0 && pending === 0 ? quiet + 1 : 0;
                if (cache.drawCount > 0) settleFrames++;
                if (quiet >= QUIET_FRAMES || settleFrames >= MAX_SETTLE_FRAMES) {
                    booting = false;
                    panel.classList.add('done');
                    setTimeout(() => panel.remove(), 600);
                }
                return;
            }
            const now = performance.now();
            if (work.length === 0) {
                busySince = -1;
                if (!chip.hidden) chip.hidden = true;
                return;
            }
            if (busySince < 0) busySince = now;
            if (now - busySince < CHIP_DELAY_MS) return;
            if (chip.hidden) chip.hidden = false;
            const text = work.join(' · ');
            if (chipText.textContent !== text) chipText.textContent = text;
        },
        get booting() { return booting; },
    };
}
