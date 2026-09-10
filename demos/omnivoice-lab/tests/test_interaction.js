// Headless interaction test for OmniVoice Lab: drives the REAL UI through
// input injection (click / mouseDown / mouseMove / mouseUp go through hit
// testing and the DOM event pipeline — see bro/docs/headless.md), never the
// modules' setters, and asserts the state + DOM the app derives from it.
//
//   cd ../broworkshop && ../bro/build/Release/bro-headless.exe demos/omnivoice-lab demos/omnivoice-lab/tests/test_interaction.js
//
// Skips (passes with a message) when the weights or a GPU backend are absent.
// Native dialogs (clip 📁, ⤓ wav, ⤓ .ovcp, ⤒ .ovcp) are never clicked.
import { $, omni, takes, current, busy, NQ } from "/app/lib/state.js";
import { sel, cbs } from "/app/lib/grid.js";
import { prompts, activePrompt } from "/app/lib/voice.js";
import { setText } from "/app/lib/text.js";
import { setParam, setLength } from "/app/lib/schedule.js";
import { cards, frameX, GRID_ROW } from "/app/lib/render.js";
import { playbackId } from "/app/lib/audio.js";

const SHOTS = (typeof process !== 'undefined' && process.env && process.env.OMNI_SHOTS) || (bro.appDir + '/tests/out/');
const TEXT = 'Hello there, this is a test of the OmniVoice pipeline.';

function ms(t0) { return ((Date.now() - t0) / 1000).toFixed(2) + 's'; }
function pumpUntil(desc, fn, seconds) {
  const iters = Math.ceil((seconds * 1000) / 16);
  for (let i = 0; i < iters; i++) {
    advanceTime(16); wallSleep(16);
    if (fn()) return;
  }
  throw new Error('timeout waiting for ' + desc);
}
function count(q) { return document.querySelectorAll(q).length; }
function center(el) {
  const r = el.getBoundingClientRect();
  assert(r.width > 0 && r.height > 0, 'element has a box: ' + (el.id || el.className || el.tagName));
  assert(r.top >= 0 && r.bottom <= window.innerHeight, 'element is on screen (' + r.top.toFixed(0) + '–' + r.bottom.toFixed(0) + '): ' + (el.id || el.className || el.textContent.slice(0, 12)));
  return [r.left + r.width / 2, r.top + r.height / 2];
}
function clickEl(el) { const [x, y] = center(el); click(x, y); advanceTime(16); flush(); }
function buttonByText(host, text) {
  const b = Array.from(host.querySelectorAll('button')).find((x) => x.textContent === text);
  assert(b, 'button "' + text + '" exists');
  return b;
}
// Viewport x of the middle of frame f on a frame-aligned card canvas (CSS px,
// via the canvas's backing/CSS ratio), and the viewport y of row q.
function cellXY(c, f, q, rowH) {
  const r = c.canvas.getBoundingClientRect();
  const sx = r.width / c.canvas.width, sy = r.height / c.canvas.height;
  const T = current.numFrames;
  return [r.left + frameX(f + 0.5, T) * sx, r.top + ((q + 0.5) * (rowH || c.canvas.height)) * sy];
}
function gridNote() { return cards.grid.tools.querySelector('.meta:last-child').textContent; }
function takeEntries() { return Array.from(document.querySelectorAll('#take-list .take')); }
function takeButtons(entry) { return Array.from(entry.querySelectorAll('.tbtns button')); }

// ── 1. load ──────────────────────────────────────────────────────────────────
let t0 = Date.now();
pumpUntil('model load', () => !!omni || /failed|no GPU|no config/.test($('#backend').textContent), 240);
if (!omni) {
  console.log('SKIP: ' + $('#backend').textContent);
} else {
  console.log('loaded in ' + ms(t0) + ' · ' + $('#backend').textContent);
  console.log('viewport ' + window.innerWidth + 'x' + window.innerHeight + ' (the menu bar takes the rest of 1080)');
  setText(TEXT); advanceTime(200);
  setParam('numSteps', 16); setParam('seed', 7); $('#seed-lock').checked = true;

  // ── 2. ▶ Generate is a real button ─────────────────────────────────────────
  t0 = Date.now();
  clickEl($('#btn-generate'));
  assert(busy && $('#btn-generate').disabled && !$('#btn-stop').disabled, 'clicking Generate starts an op (transport busy)');
  pumpUntil('generate', () => !busy && takes.length === 1, 120);
  const take = takes[0], T = take.numFrames;
  console.log('generate (click): ' + ms(t0) + ' · ' + T + ' frames');
  assert(current === take && count('#take-list .take.current') === 1, 'the take is current');
  assert(cards.grid && cards.audio, 'grid + audio cards exist');
  const gr = cards.grid.canvas.getBoundingClientRect(), ar = cards.audio.canvas.getBoundingClientRect();
  console.log('grid canvas: backing ' + cards.grid.canvas.width + 'x' + cards.grid.canvas.height + ' · CSS ' + gr.width.toFixed(0) + 'x' + gr.height.toFixed(0) + ' @ ' + gr.left.toFixed(0) + ',' + gr.top.toFixed(0) +
              ' · audio CSS ' + ar.width.toFixed(0) + 'x' + ar.height.toFixed(0));
  // (max-width: 100% may scale the canvas below its 1180 backing width on a
  // narrow viewport — the hit-testing below goes through that ratio)
  assert(gr.width > 0 && Math.abs(gr.height - cards.grid.canvas.height * (gr.width / cards.grid.canvas.width)) <= 1, 'grid canvas keeps its aspect on screen');
  assert(sel === null && /drag on the grid/.test(gridNote()), 'no selection after a fresh take: ' + gridNote());

  // ── 3. hover: the readout names the cell under the pointer ─────────────────
  const hq = 3, hf = Math.floor(T * 0.6);
  let [hx, hy] = cellXY(cards.grid, hf, hq, GRID_ROW);
  mouseMove(hx, hy); advanceTime(16); flush();
  const code = take.codes[hq * T + hf], step = take.unmaskStep[hq * T + hf];
  const ro = $('#readout').textContent;
  assert(new RegExp('^frame ' + hf + ' · t = ' + (hf / 25).toFixed(2) + ' s').test(ro), 'readout names the hovered frame: ' + ro);
  assert(ro.indexOf(' · q' + hq + ' = ' + code) >= 0 && ro.indexOf('committed at step ' + step) >= 0 && / score -?\d+\.\d\d/.test(ro), 'readout carries the cell\'s codebook, code id, commit step and score: ' + ro);
  assert(currentCursor() === 'crosshair', 'the grid canvas shows the crosshair cursor: ' + currentCursor());
  // the row under the pointer changes with y, the frame with x
  [hx, hy] = cellXY(cards.grid, hf, 6, GRID_ROW);
  mouseMove(hx, hy); advanceTime(16); flush();
  assert($('#readout').textContent.indexOf(' · q6 = ' + take.codes[6 * T + hf]) >= 0, 'row 6 under the pointer: ' + $('#readout').textContent);
  [hx, hy] = cellXY(cards.grid, 0, 0, GRID_ROW);
  mouseMove(hx, hy); advanceTime(16); flush();
  assert(/^frame 0 · /.test($('#readout').textContent) && $('#readout').textContent.indexOf(' · q0 = ' + take.codes[0]) >= 0, 'first cell: ' + $('#readout').textContent);
  // the waveform reads the peak of the frame instead of a code
  [hx, hy] = cellXY(cards.audio, hf, 0, 0);
  mouseMove(hx, hy); advanceTime(16); flush();
  assert(new RegExp('^frame ' + hf + ' · .* · peak \\d\\.\\d\\d\\d$').test($('#readout').textContent), 'waveform hover reads the frame\'s peak: ' + $('#readout').textContent);
  // leaving the canvas resets the readout
  const rr0 = $('#readout').getBoundingClientRect();
  mouseMove(rr0.left + 40, rr0.top + rr0.height / 2); advanceTime(16); flush();
  assert($('#readout').textContent.indexOf(take.name + ' · ' + T + ' frames') === 0, 'mouseout restores the take readout: ' + $('#readout').textContent);
  // the gutter left of the frames is not a frame
  mouseMove(gr.left + 4, gr.top + 9); advanceTime(16); flush();
  assert($('#readout').textContent.indexOf(take.name) === 0, 'the row-label gutter is not a frame: ' + $('#readout').textContent);

  // ── 4. drag a span on the grid ─────────────────────────────────────────────
  const f0 = Math.floor(T * 0.25), f1 = Math.floor(T * 0.45);
  let [x0, y0] = cellXY(cards.grid, f0, 2, GRID_ROW);
  let [x1, y1] = cellXY(cards.grid, f1, 5, GRID_ROW);
  mouseDown(x0, y0); advanceTime(16); flush();
  assert(sel && sel.t0 === f0 && sel.t1 === f0 + 1, 'mousedown anchors a one-frame span at frame ' + f0 + ': ' + JSON.stringify(sel));
  mouseMove(x1, y1); advanceTime(16); flush();
  assert(sel && sel.t0 === f0 && sel.t1 === f1 + 1, 'dragging right extends the span to frame ' + f1 + ' inclusive: ' + JSON.stringify(sel));
  // the drag keeps tracking when the pointer leaves the canvas (window listener)
  const f2 = Math.floor(T * 0.55);
  const [x2] = cellXY(cards.grid, f2, 0, GRID_ROW);
  mouseMove(x2, rr0.top + 5); advanceTime(16); flush();
  assert(sel && sel.t0 === f0 && sel.t1 === f2 + 1, 'the drag follows the pointer off the canvas: ' + JSON.stringify(sel));
  // and back past the anchor: the span flips
  const fm = Math.floor(T * 0.1);
  const [xm, ym] = cellXY(cards.grid, fm, 7, GRID_ROW);
  mouseMove(xm, ym); advanceTime(16); flush();
  assert(sel && sel.t0 === fm && sel.t1 === f0 + 1, 'dragging left of the anchor flips the span: ' + JSON.stringify(sel));
  mouseMove(x1, y1); advanceTime(16); flush();
  mouseUp(x1, y1); advanceTime(16); flush();
  assert(sel && sel.t0 === f0 && sel.t1 === f1 + 1, 'mouseup keeps the span: ' + JSON.stringify(sel));
  const noteA = gridNote();
  assert(noteA.indexOf('span ' + f0 + '–' + (f1 + 1) + ' (') === 0 && noteA.indexOf(', ' + (f1 + 1 - f0) + ' fr) × 8 codebooks') > 0, 'span readout matches the drag: ' + noteA);
  assert(noteA.indexOf((f0 / 25).toFixed(2) + '–' + ((f1 + 1) / 25).toFixed(2) + ' s') > 0, 'span readout carries the seconds: ' + noteA);
  // after the release, moving the pointer no longer changes the span
  const [xe, ye] = cellXY(cards.grid, Math.floor(T * 0.9), 4, GRID_ROW);
  mouseMove(xe, ye); advanceTime(16); flush();
  assert(sel.t0 === f0 && sel.t1 === f1 + 1, 'a hover after mouseup is not a drag: ' + JSON.stringify(sel));
  assert($('#readout').textContent.indexOf('frame ' + Math.floor(T * 0.9)) === 0, 'hover readout still live after the drag');
  flush(); screenshot(SHOTS + 'omnivoice-lab-i1-drag.png', '#card-grid');

  // ── 5. drag a span on the waveform, right to left ──────────────────────────
  const w0 = Math.floor(T * 0.7), w1 = Math.floor(T * 0.5);
  [x0, y0] = cellXY(cards.audio, w0, 0, 0);
  [x1, y1] = cellXY(cards.audio, w1, 0, 0);
  mouseDown(x0, y0); advanceTime(16); flush();
  assert(sel && sel.t0 === w0 && sel.t1 === w0 + 1, 'waveform mousedown anchors at frame ' + w0 + ': ' + JSON.stringify(sel));
  mouseMove(x1, y1); advanceTime(16); flush();
  mouseUp(x1, y1); advanceTime(16); flush();
  assert(sel && sel.t0 === w1 && sel.t1 === w0 + 1, 'a right-to-left drag on the waveform selects [' + w1 + ', ' + (w0 + 1) + '): ' + JSON.stringify(sel));
  assert(gridNote().indexOf('span ' + w1 + '–' + (w0 + 1) + ' (') === 0, 'span readout follows the waveform drag: ' + gridNote());
  // a mousedown in the gutter is not a drag
  mouseDown(ar.left + 4, ar.top + 20); advanceTime(16); flush();
  mouseMove(x1, y1); advanceTime(16); flush();
  mouseUp(x1, y1); advanceTime(16); flush();
  assert(sel && sel.t0 === w1 && sel.t1 === w0 + 1, 'a press in the gutter does not start a drag: ' + JSON.stringify(sel));
  // ✕ span clears; ▶ span plays the selection
  clickEl(buttonByText(cards.grid.tools, '✕ span'));
  assert(sel === null && /drag on the grid/.test(gridNote()), '✕ span clears the selection: ' + gridNote());
  [x0, y0] = cellXY(cards.grid, f0, 1, GRID_ROW); [x1, y1] = cellXY(cards.grid, f1, 1, GRID_ROW);
  mouseDown(x0, y0); mouseMove(x1, y1); mouseUp(x1, y1); advanceTime(16); flush();
  assert(sel && sel.t0 === f0 && sel.t1 === f1 + 1, 'span re-selected on the grid: ' + JSON.stringify(sel));
  clickEl(buttonByText(cards.grid.tools, '▶ span'));
  assert(playbackId() >= 0 && !/^audio:/.test($('#backend').textContent), '▶ span started a playback: id ' + playbackId());

  // ── 6. codebook ticks and the all / 1–7 / 0 shortcuts ──────────────────────
  const ticks = Array.from(cards.grid.tools.querySelectorAll('.cbtick input'));
  assert(ticks.length === NQ && ticks.every((t) => t.checked) && cbs.every((v) => v === 1), 'eight ticks, all on');
  clickEl(ticks[3]);
  assert(!ticks[3].checked && cbs[3] === 0 && cbs.reduce((a, b) => a + b, 0) === 7, 'clicking q3 unticks it: ' + JSON.stringify(cbs));
  assert(/× 7 codebooks$/.test(gridNote()), 'span readout counts 7 codebooks: ' + gridNote());
  clickEl(ticks[3]);
  assert(ticks[3].checked && cbs[3] === 1, 'clicking q3 again re-ticks it');
  clickEl(buttonByText(cards.grid.tools, '1–7'));
  assert(!ticks[0].checked && cbs[0] === 0 && cbs.slice(1).every((v) => v === 1) && ticks.slice(1).every((t) => t.checked), '1–7: acoustic codebooks only: ' + JSON.stringify(cbs));
  clickEl(buttonByText(cards.grid.tools, '0'));
  assert(ticks[0].checked && cbs[0] === 1 && cbs.slice(1).every((v) => v === 0) && ticks.slice(1).every((t) => !t.checked), '0: the semantic codebook only: ' + JSON.stringify(cbs));
  assert(/× 1 codebooks$/.test(gridNote()), 'span readout counts 1 codebook: ' + gridNote());
  clickEl(buttonByText(cards.grid.tools, 'all'));
  assert(cbs.every((v) => v === 1) && ticks.every((t) => t.checked), 'all: every codebook: ' + JSON.stringify(cbs));
  // the show-changes tick is the ninth checkbox
  const showTick = cards.grid.tools.querySelector('label.lock input');
  clickEl(showTick);
  assert(!showTick.checked, 'show changes toggled off by click');
  clickEl(showTick);
  assert(showTick.checked, 'show changes toggled on by click');

  // ── 7. ↻ span: the button, the seed box, only the selected cells change ────
  clickEl(buttonByText(cards.grid.tools, '1–7'));
  const seedBox = $('#reroll-seed');
  clickEl(seedBox);
  keyDown(97 /* a */, 0, 0x0040 /* LCTRL */); keyUp(97, 0, 0x0040);
  textInput('321'); advanceTime(16); flush();
  assert(seedBox.value === '321', 'typed the re-roll seed: ' + seedBox.value);
  t0 = Date.now();
  clickEl(buttonByText(cards.grid.tools, '↻ span'));
  assert(busy && /re-roll span \d+–\d+ · \d+ of \d+ cells masked · seed 321/.test($('#run-meta').textContent), 'the span re-roll started: ' + $('#run-meta').textContent);
  pumpUntil('re-roll span', () => !busy && takes.length === 2, 120);
  const rr = takes[1];
  console.log('re-roll span (click): ' + ms(t0) + ' · ' + JSON.stringify(rr.rerollInfo));
  assert(rr.kind === 'reroll' && rr.parentId === take.id && current === rr, 'the re-roll is a child of the take, and current');
  assert(rr.rerollInfo.seed === 321 && rr.rerollInfo.preset === 'span' && rr.rerollInfo.span.t0 === f0 && rr.rerollInfo.span.t1 === f1 + 1, 'rerollInfo carries the typed seed and the dragged span: ' + JSON.stringify(rr.rerollInfo));
  assert(JSON.stringify(rr.rerollInfo.codebooks) === JSON.stringify([0, 1, 1, 1, 1, 1, 1, 1]), 'rerollInfo carries the ticked codebooks');
  let inMask = 0, changedIn = 0, changedOut = 0;
  for (let q = 0; q < NQ; q++) for (let t = 0; t < T; t++) {
    const i = q * T + t, masked = q >= 1 && t >= f0 && t < f1 + 1;
    assert(!!rr.masked[i] === masked, 'masked grid = span × ticked codebooks at q' + q + ' t' + t);
    if (masked) { inMask++; if (rr.codes[i] !== take.codes[i]) changedIn++; }
    else if (rr.codes[i] !== take.codes[i]) changedOut++;
  }
  assert(changedOut === 0 && changedIn > 0, 'only the selected cells changed: ' + changedIn + ' of ' + inMask + ' inside, ' + changedOut + ' outside');
  assert(rr.rerollInfo.masked === inMask && rr.rerollInfo.changed === changedIn && rr.rerollInfo.leaked === 0, 'rerollInfo agrees with the diff');
  assert(/nothing outside the mask changed/.test(cards.grid.note.textContent), 'grid note reports the seam check: ' + cards.grid.note.textContent);
  assert(sel === null, 'showing the new take clears the selection');
  // hover a re-rolled cell: the readout says CHANGED (or kept)
  let found = -1; for (let t = f0; t <= f1 && found < 0; t++) if (rr.changed[1 * T + t]) found = t;
  assert(found >= 0, 'a changed cell exists on q1');
  [hx, hy] = cellXY(cards.grid, found, 1, GRID_ROW);
  mouseMove(hx, hy); advanceTime(16); flush();
  assert(/ · CHANGED$/.test($('#readout').textContent) && $('#readout').textContent.indexOf(' · q1 = ' + rr.codes[T + found]) >= 0, 'hover on a re-rolled cell says CHANGED: ' + $('#readout').textContent);
  [hx, hy] = cellXY(cards.grid, found, 0, GRID_ROW);
  mouseMove(hx, hy); advanceTime(16); flush();
  assert(/ · kept/.test($('#readout').textContent) && !/CHANGED/.test($('#readout').textContent), 'hover on a kept cell says kept: ' + $('#readout').textContent);
  flush(); screenshot(SHOTS + 'omnivoice-lab-i2-reroll.png', '#card-grid');

  // ── 8. ■ Stop mid-generation ───────────────────────────────────────────────
  setLength(20, 1); setParam('numSteps', 64);
  const before = takes.length, beforeCurrent = current;
  t0 = Date.now();
  clickEl($('#btn-generate'));
  assert(busy && /generating 500 frames .* 64 steps/.test($('#run-meta').textContent), 'a long generation is running: ' + $('#run-meta').textContent);
  let seen = 0;
  pumpUntil('a few steps', () => { const m = /step (\d+) \/ 64/.exec(cards.unmask.note.textContent); if (m) seen = +m[1]; return seen >= 3; }, 60);
  clickEl($('#btn-stop'));
  pumpUntil('cancel', () => !busy, 60);
  const lastSeen = (/step (\d+) \/ 64/.exec(cards.unmask.note.textContent) || [0, seen])[1];
  console.log('stop: clicked at step ' + seen + ', cancelled after step ' + lastSeen + ' · ' + ms(t0));
  assert(+lastSeen < 64, 'the generation stopped early (step ' + lastSeen + ' of 64)');
  assert($('#run-meta').textContent === 'cancelled', 'run-meta says cancelled: ' + $('#run-meta').textContent);
  assert(takes.length === before && current === beforeCurrent && count('#take-list .take') === before, 'no take was added by the cancelled run');
  assert(!$('#btn-generate').disabled && !$('#btn-pipeline').disabled && $('#btn-stop').disabled, 'transport back to idle');
  assert(playbackId() === -1, 'Stop also stopped playback');
  // and a subsequent generation works
  setLength(0, 1); setParam('numSteps', 16);
  t0 = Date.now();
  clickEl($('#btn-generate'));
  pumpUntil('generate after cancel', () => !busy && takes.length === before + 1, 120);
  const after = takes[before];
  console.log('generate after stop: ' + ms(t0) + ' · ' + after.numFrames + ' frames');
  assert(after.kind === 'generate' && after.numFrames === T && current === after && count('#take-list .take.current') === 1, 'a fresh generate lands after the cancel');

  // ── 9. the take strip: ▶ · ◉ voice · ⊞ grid · the card · ✕ ────────────────
  let entries = takeEntries();
  assert(entries.length === 3 && entries[2].classList.contains('current'), 'three strip entries, the last current');
  const b0 = takeButtons(entries[0]);
  assert(b0.map((b) => b.textContent).join('|') === '▶|⤓ wav|◉ voice|⊞ grid|✕', 'take buttons: ' + b0.map((b) => b.textContent).join('|'));
  // ▶ plays that take without making it current. (■ Stop is disabled while no
  // op runs — endOp() — so a playback started from the strip has no stop
  // button; the transport's ♪ replays the current take instead.)
  const pid0 = playbackId();
  assert(pid0 >= 0 && $('#btn-stop').disabled, 'showing the new take autoplayed it (id ' + pid0 + ') and Stop is disabled while idle');
  clickEl(b0[0]);
  const pid1 = playbackId();
  assert(pid1 >= 0 && pid1 !== pid0, '▶ on take 1 started a new playback: id ' + pid1);
  assert(current === after && entries[2].classList.contains('current') && !entries[0].classList.contains('current'), '▶ does not change the current take');
  assert(!$('#btn-play').disabled && !$('#btn-save-wav').disabled, 'play + save enabled');
  clickEl($('#btn-play'));
  assert(playbackId() >= 0 && playbackId() !== pid1, '♪ replays: a new playback id ' + playbackId());
  // ◉ voice makes the take the active prompt
  assert(prompts.length === 0 && count('#prompt-bank .prompt-entry') === 0, 'bank empty to start');
  clickEl(b0[2]);
  assert(prompts.length === 1 && activePrompt() === prompts[0].prompt && prompts[0].name === take.name && prompts[0].source === 'take', '◉ voice added the take as the active prompt: ' + prompts[0].name);
  assert(count('#prompt-bank .prompt-entry') === 1 && count('#prompt-bank .prompt-entry.active') === 1, 'bank DOM shows one active entry');
  assert($('#prompt-bank .prompt-entry .pname').value === take.name, 'entry named after the take: ' + $('#prompt-bank .prompt-entry .pname').value);
  assert(prompts[0].prompt.numFrames > 0 && $('#prompt-bank .prompt-entry .pinfo').textContent.indexOf(prompts[0].prompt.numFrames + ' fr') === 0, 'entry info shows the prompt frames: ' + $('#prompt-bank .prompt-entry .pinfo').textContent);
  assert(/scaled by the prompt/.test($('#est-meta').textContent), 'the estimate now reads the prompt: ' + $('#est-meta').textContent);
  assert(current === after, '◉ voice does not change the current take');
  // clicking the bank row toggles the active prompt off and on
  clickEl($('#prompt-bank .prompt-entry .pinfo'));
  assert(activePrompt() === null && count('#prompt-bank .prompt-entry.active') === 0, 'clicking the active row deselects it');
  clickEl($('#prompt-bank .prompt-entry .pinfo'));
  assert(activePrompt() === prompts[0].prompt && count('#prompt-bank .prompt-entry.active') === 1, 'clicking it again re-activates it');
  // ⊞ grid loads take 1 into the grid
  clickEl(b0[3]);
  entries = takeEntries();
  assert(current === take && entries[0].classList.contains('current') && count('#take-list .take.current') === 1, '⊞ grid made take 1 current');
  assert(sel === null && cards.grid.note.textContent.indexOf(T + ' frames') === 0 && !/re-roll/.test(cards.grid.note.textContent), 'grid shows take 1: ' + cards.grid.note.textContent);
  assert($('#run-meta').textContent.indexOf(take.name) === 0, 'run-meta names take 1: ' + $('#run-meta').textContent);
  // clicking a card body does the same for take 2 (the re-roll)
  clickEl(entries[1].querySelector('.tname'));
  assert(current === rr && entries[1].classList.contains('current') && /re-roll \(span, seed 321\)/.test(cards.grid.note.textContent), 'clicking the card shows the re-roll: ' + cards.grid.note.textContent);
  // ✕ removes take 3
  clickEl(takeButtons(entries[2])[4]);
  assert(takes.length === 2 && takeEntries().length === 2 && current === rr, '✕ removed the third take; the current one stays');
  flush(); screenshot(SHOTS + 'omnivoice-lab-i3-final.png');
  console.log('OMNIVOICE LAB INTERACTION OK · ' + takes.length + ' takes · ' + prompts.length + ' prompt');
}
