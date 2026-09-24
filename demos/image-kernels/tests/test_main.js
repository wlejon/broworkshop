// Image Kernels — the live app: the pipeline cards drive bro.image stages, the
// colorize paths draw, the HUD reads back. Run: scripts/validate.sh demos/image-kernels
import { check, eq, frames, test, done, q, text, clickOn, setValue, shot } from "/lib/kit/test.js";
import { view, renderFrame, setRenderer } from "/app/lab.js";
import { stages, stage, field } from "/app/pipeline.js";

frames(10);

const card = (id) => q('.stage[data-id=' + id + ']');
const toggle = (id) => clickOn(card(id).querySelector('[data-toggle]'));

test('boot: field allocated, five OFF stage cards, HUD filled', () => {
    eq([field.w, field.h], [384, 384]);
    eq(document.querySelectorAll('#pipeline .stage').length, 5);
    check(stages.every((s) => !s.on), 'all stages off');
    check(card('map').classList.contains('off'), 'off card styled');
    eq(text('#fsize'), '384×384');
    eq(text('#rmode'), 'GPU');
    check(+text('#rmax') > +text('#rmin'), 'range from reduce minmax');
});

test('stage toggle turns a verb on and times it', () => {
    toggle('map');
    check(stage('map').on && !card('map').classList.contains('off'), 'map on');
    eq(text(card('map').querySelector('[data-toggle]')), 'on');
    frames(3);
    check(/ms$/.test(text(card('map').querySelector('[data-ms]'))), 'map stage timed');
});

test('map op select shows only its params', () => {
    const sel = card('map').querySelector('select[data-k=op]');
    setValue(sel, 'pow');
    eq(stage('map').cfg.op, 'pow');
    check(card('map').querySelector('.p-affine').hidden && !card('map').querySelector('.p-pow').hidden, 'pow row only');
    const exp = card('map').querySelector('input[data-k=exp]');
    setValue(exp, 3);
    eq(stage('map').cfg.exp, 3);
    eq(text(card('map').querySelector('[data-v=exp]')), '3.00');
    setValue(sel, 'abs');
});

test('abs → edge magnitude gives a finite field with range', () => {
    toggle('stencil');
    setValue(card('stencil').querySelector('select[data-k=kernel]'), 'edgemag');
    check(/sqrt/.test(text(card('stencil').querySelector('.kmat'))), 'kernel card explains edgemag');
    const r = renderFrame();
    const mm = bro.image.reduce(r.buf, 'minmax');
    check(Number.isFinite(mm.max) && mm.max > mm.min, 'dynamic range ' + mm.min + '..' + mm.max);
    check(r.buf === field.a || r.buf === field.b, 'result in a ping-pong buffer');
});

test('combine + resample stages', () => {
    toggle('combine');
    setValue(card('combine').querySelector('select[data-k=op]'), 'wsum');
    check(!card('combine').querySelector('.p-wsum').hidden && card('combine').querySelector('.p-lerp').hidden, 'wsum rows');
    toggle('resample');
    setValue(card('resample').querySelector('select[data-k=factor]'), '8');
    eq(stage('resample').cfg.factor, 8);
    renderFrame();
    eq([field.loW, field.loH], [48, 48], 'resample scratch at 1/8');
});

test('histogram-eq routes colorize through the eq LUT', () => {
    toggle('histeq');
    eq(renderFrame().eqActive, true);
    toggle('histeq');
});

test('CPU renderer draws through lookup', () => {
    clickOn('#renderer');
    eq(view.gpu, false);
    eq(text('#renderer'), 'renderer: CPU');
    check(!q('#cpu').hidden && q('#gpu').hidden, 'cpu canvas shown');
    const n = view.drawn.cpu;
    frames(3);
    check(view.drawn.cpu > n, 'CPU lookup ran');
    const r = q('#cpu').getBoundingClientRect();
    const p = getPixel(r.left + r.width / 2, r.top + r.height / 2);
    check(p.a === 255 && p.r + p.g + p.b > 0, 'cpu canvas painted');
    setRenderer(true);
});

test('manual range shows lo/hi and uses them', () => {
    setValue('#range-mode', 'manual');
    check(!q('#lo-wrap').hidden && !q('#hi-wrap').hidden, 'lo/hi shown');
    setValue('#lo', -0.5);
    setValue('#hi', 0.75);
    frames(2);
    eq([view.range.min, view.range.max], [-0.5, 0.75]);
    eq(text('#rmin'), '-0.500');
    setValue('#range-mode', 'auto');
    check(q('#lo-wrap').hidden, 'lo hidden again');
});

test('source, field size, colormap, animate', () => {
    setValue('#source', 'checker');
    setValue('#field-size', '256');
    eq([field.w, field.h], [256, 256]);
    setValue('#gradient', 'posterize');
    eq(view.gradient, 'posterize');
    clickOn('#animate');
    eq(view.animate, false);
    const t = view.time;
    frames(5);
    eq(view.time, t, 'time frozen while not animating');
    clickOn('#animate');
    frames(3);
    eq(text('#fsize'), '256×256');
});

test('GPU renderer draws through gpu.colormap', () => {
    const n = view.drawn.gpu;
    frames(3);
    check(view.drawn.gpu > n, 'gpu.colormap ran');
});

for (const s of stages) if (s.on) toggle(s.id);
setValue('#source', 'fbm');
setValue('#gradient', 'viridis');
frames(10);
shot('main');
done('image-kernels app');
