// forest entry: the panel. The scene, the trees and the flight are
// forest.js, which tests and the capture tool import.
import { boot, segmented, stats } from "/lib/kit/index.js";
import { vp, sky, forest, WINDS, setWind, SHOTS, setShot, fly, land } from "/app/forest.js";

const app = boot();

const labels = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, o[k].label]));
segmented('#winds', labels(WINDS), { value: forest.wind, onChange: setWind });
segmented('#shots', labels(SHOTS), { value: forest.shot, onChange: setShot });
segmented('#tod', Object.fromEntries(sky.order.map((k) => [k, sky.presets[k].label])),
    { value: sky.current, onChange: (k) => sky.apply(k) });
segmented('#tiers', { auto: 'By size', leaves: 'Leaves', clumps: 'Clumps', crowns: 'Crowns' },
    { value: 'auto', onChange: (t) => forest.node.setForestTier(t) });
document.querySelector('#fly').addEventListener('click', () => fly(0));

// Any drag or wheel on the view takes it over from the flight.
for (const ev of ['pointerdown', 'wheel']) vp.canvas.addEventListener(ev, () => land(), { capture: true });

const readouts = stats('#stats', { trees: 'trees', tiers: 'leaves / clumps / crowns', verts: 'vertices' });
vp.onFrame(() => {
    const s = forest.node.forestStats();
    if (!s) return;
    readouts.set({
        trees: s.treeCount.toLocaleString() + ' of ' + s.specimenCount + ' specimens',
        tiers: `${s.trees.leaves} / ${s.trees.clumps} / ${s.trees.crowns}`,
        verts: (s.vertices / 1e6).toFixed(1) + ' M',
    });
});
app.status.ok('grown in ' + (forest.growMs / 1000).toFixed(1) + ' s');
