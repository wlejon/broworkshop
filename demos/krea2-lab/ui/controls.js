// Control framework: tabs, the sectioned rail, the unified control row
// (buildCtl + press-and-hold steppers), the registry that drives the deck +
// section badges, and the deck itself. Attaches its API onto ctx
// (ctx.buildCtl et al) — nearly every feature module builds rows through here.

import { $ } from '/app/ui/util.js';

export function initControls(ctx) {
  // ── control registry (drives the deck + section badges) ─────────────────
  // Every scrubbable control registers here. The deck at the rail's foot
  // shows one chip per non-neutral control — the "what's shaping this
  // image" view — and each section tab wears its active count.
  let registry = [];   // {section, group?, chip(), chipValue(), active(), zero(), reveal()}
  function unregisterGroup(group) {
    registry = registry.filter((r) => r.group !== group);
  }
  let activeSection = ['scene', 'character', 'face', 'look', 'explore', 'mint', 'tune'].indexOf(ctx.prefs.section) >= 0
    ? ctx.prefs.section : 'scene';
  // post-refreshDeck hooks (the axis bank's per-category count badges hang here)
  const deckHooks = [];

  // ── tabs ─────────────────────────────────────────────────────────────────
  function switchTab(name) {
    document.querySelectorAll('.tabbtn').forEach((b) =>
      b.classList.toggle('active', b.getAttribute('data-tab') === name));
    document.querySelectorAll('.tabpanel').forEach((p) =>
      p.classList.toggle('active', p.id === 'tab-' + name));
  }
  document.querySelectorAll('.tabbtn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  // ── rail sections ────────────────────────────────────────────────────────
  function switchSection(name) {
    activeSection = name;
    document.querySelectorAll('.secbtn').forEach((b) =>
      b.classList.toggle('active', b.getAttribute('data-sec') === name));
    document.querySelectorAll('#rail-body .sec').forEach((s) =>
      s.classList.toggle('active', s.id === 'sec-' + name));
    ctx.persist();
  }
  document.querySelectorAll('.secbtn').forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.getAttribute('data-sec')));
    // per-section active-control count badge (filled by refreshDeck)
    const dot = document.createElement('span');
    dot.className = 'sec-dot';
    dot.id = 'dot-' + btn.getAttribute('data-sec');
    btn.appendChild(dot);
  });

  // ── unified control row ──────────────────────────────────────────────────
  // One builder for every slider in the rail. Two lines: a header — either
  // "name … value" or, for "a ↔ b" labels, the semantic-differential
  // "a  …value…  b" with the poles at the track's ends — and the slider
  // flanked by fine-step buttons. The row carries .on whenever the value is
  // off-neutral, which is what makes active controls visually loud and
  // neutral ones quiet.
  function poleParts(label) {
    const i = label.indexOf('↔');
    if (i < 0) return null;
    return { neg: label.slice(0, i).trim(), pos: label.slice(i + 1).trim() };
  }
  // cfg: {label, title?, min, max, step, value?, neutral=0, decimals=2,
  //       id? (range id), key? (data-key), host? (append target),
  //       commit(v)   — write app state (persist is handled here),
  //       nameClick?  — makes the name clickable (minted-axis inspect),
  //       headBtns?   — extra buttons for the head row (delete ×),
  //       section?, chip()? — register a deck chip (omit section to skip)}
  function buildCtl(cfg) {
    const neutral = cfg.neutral || 0;
    const decimals = cfg.decimals != null ? cfg.decimals : 2;
    const row = document.createElement('div');
    row.className = 'ctl';
    if (cfg.key) row.setAttribute('data-key', cfg.key);

    const head = document.createElement('div');
    head.className = 'ctl-head';
    const val = document.createElement('span');
    val.className = 'ctl-val';
    val.title = 'double-click to reset to ' + neutral.toFixed(decimals);
    const poles = poleParts(cfg.label);
    if (poles && !cfg.nameClick) {
      const a = document.createElement('span');
      a.className = 'ctl-pole'; a.textContent = poles.neg;
      a.title = cfg.title || ('− pulls toward "' + poles.neg + '"');
      const b = document.createElement('span');
      b.className = 'ctl-pole pos'; b.textContent = poles.pos;
      b.title = cfg.title || ('+ pushes toward "' + poles.pos + '"');
      head.appendChild(a); head.appendChild(val); head.appendChild(b);
    } else {
      const nm = document.createElement(cfg.nameClick ? 'button' : 'span');
      nm.className = cfg.nameClick ? 'axis-mine-name clickable' : 'ctl-name';
      if (cfg.nameClick) { nm.type = 'button'; nm.addEventListener('click', cfg.nameClick); }
      nm.textContent = cfg.label;
      nm.title = cfg.title || cfg.label;
      head.appendChild(nm); head.appendChild(val);
    }
    (cfg.headBtns || []).forEach((b) => head.appendChild(b));

    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(cfg.min); range.max = String(cfg.max); range.step = String(cfg.step);
    range.value = String(cfg.value != null ? cfg.value : neutral);
    if (cfg.id) range.id = cfg.id;

    function refresh() {
      const v = +range.value;
      const signed = cfg.min < 0 && v > 0 ? '+' : '';
      val.textContent = signed + v.toFixed(decimals);
      const on = v !== neutral;
      val.classList.toggle('off', !on);
      row.classList.toggle('on', on);
    }
    function commit() { refresh(); cfg.commit(+range.value); ctx.persist(); }
    function settle() { if (ctx.live) ctx.schedule('full'); }
    function setValue(v, opts) {
      range.value = String(v);
      commit();
      if (!opts || !opts.silent) settle();
    }
    range.addEventListener('input', commit);
    range.addEventListener('change', settle);
    val.addEventListener('dblclick', () => setValue(neutral));
    const minus = makeStepper(range, -1, commit, settle);
    const plus = makeStepper(range, +1, commit, settle);

    const body = document.createElement('div');
    body.className = 'ctl-body';
    body.appendChild(minus); body.appendChild(range); body.appendChild(plus);
    row.appendChild(head); row.appendChild(body);
    if (cfg.host) cfg.host.appendChild(row);
    refresh();

    const handle = { row: row, range: range, refresh: refresh, set: setValue };
    if (cfg.section) {
      registry.push({
        group: cfg.group,
        section: cfg.section,
        active: () => +range.value !== neutral,
        value: () => +range.value,
        chip: cfg.chip || (() => {
          const v = +range.value;
          return poles ? (v >= neutral ? poles.pos : poles.neg) : cfg.label;
        }),
        chipValue: () => {
          const v = +range.value;
          return (cfg.min < 0 && v > 0 ? '+' : '') + v.toFixed(decimals);
        },
        zero: (opts) => setValue(neutral, opts),
        reveal: () => revealControl(cfg.section, row),
      });
    }
    return handle;
  }

  // Deck chip → jump to the control: switch to its section, scroll its row
  // into view, flash it.
  function revealControl(section, row) {
    switchSection(section);
    const body = $('rail-body');
    const rr = row.getBoundingClientRect(), br = body.getBoundingClientRect();
    body.scrollTop += rr.top - br.top - Math.max(0, (br.height - rr.height) / 2);
    row.classList.remove('flash');
    void row.offsetWidth;   // restart the animation on repeat clicks
    row.classList.add('flash');
  }

  // ── the deck: chips for every non-neutral control ────────────────────────
  function refreshDeck() {
    const host = $('deck-chips');
    if (!host) return;
    host.innerHTML = '';
    const counts = { scene: 0, face: 0, look: 0, mint: 0, tune: 0 };
    let n = 0;
    registry.forEach((r) => {
      if (!r.active()) return;
      n++;
      counts[r.section]++;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'deck-chip';
      chip.title = 'show this control';
      const nm = document.createElement('span');
      nm.textContent = r.chip();
      const v = document.createElement('span');
      v.className = 'chip-v'; v.textContent = r.chipValue();
      const x = document.createElement('span');
      x.className = 'chip-x'; x.textContent = '×';
      x.title = 'reset to neutral';
      x.addEventListener('click', (e) => { e.stopPropagation(); r.zero(); });
      chip.addEventListener('click', () => r.reveal());
      chip.appendChild(nm); chip.appendChild(v); chip.appendChild(x);
      host.appendChild(chip);
    });
    if (!n) {
      const e = document.createElement('div');
      e.className = 'deck-empty';
      e.textContent = 'all neutral — the prompt alone shapes the render';
      host.appendChild(e);
    }
    $('deck-count').textContent = n ? String(n) : '';
    $('btn-deck-clear').disabled = !n;
    if (!n) setStackMeter(null);
    for (const sec in counts) {
      const dot = $('dot-' + sec);
      if (!dot) continue;
      dot.textContent = String(counts[sec]);
      dot.classList.toggle('show', counts[sec] > 0);
    }
    deckHooks.forEach((fn) => fn());
  }
  // ── the stack meter ──────────────────────────────────────────────────────
  // Axis sliders are individually bounded, but the model sees their SUM, and the
  // scene only absorbs so much before the injection — not the prompt — is what
  // gets drawn. The worker reports what the stack spent and what it was allowed
  // (brodiffusion's CondControl budget, which scales an over-spent stack back by
  // one common factor). Fed from each render's response, so the number shown is
  // always the one the picture was made with.
  function setStackMeter(stack) {
    const box = $('deck-stack');
    if (!box) return;
    if (!stack || !stack.norm || !stack.budget) {
      box.classList.remove('show', 'over');
      return;
    }
    box.classList.add('show');
    box.classList.toggle('over', !!stack.clamped);
    $('ds-fill').style.width =
      Math.min(100, (stack.norm / stack.budget) * 100).toFixed(0) + '%';
    $('ds-text').textContent = stack.clamped
      ? 'push ' + stack.norm.toFixed(1) + ' — held at ' + stack.budget.toFixed(1) +
        ' (all axes ×' + stack.scale.toFixed(2) + ')'
      : 'push ' + stack.norm.toFixed(1) + ' / ' + stack.budget.toFixed(1);
  }
  ctx.setStackMeter = setStackMeter;

  // "return every control to neutral" — one render at the end, not one per chip
  $('btn-deck-clear').addEventListener('click', () => {
    let any = false;
    registry.forEach((r) => { if (r.active()) { any = true; r.zero({ silent: true }); } });
    if (any && ctx.live) ctx.schedule('full');
  });

  // ── press-and-hold ± steppers ──────────────────────────────────────────
  // A single click nudges a range input by its own step (0.01 — the finest,
  // exact increase a slider drag can't reliably hit); holding starts fine and
  // ramps up to a fast steady sweep. onStep fires after every value change
  // (mirrors the slider's 'input'); onSettle fires once on release (mirrors
  // 'change'), so the live-preview / full-render cadence matches dragging.
  function makeStepper(range, sign, onStep, onSettle) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctl-step';
    btn.textContent = sign > 0 ? '+' : '−';   // real minus, not hyphen
    btn.title = (sign > 0 ? 'increase' : 'decrease') + ' — click for one fine step, hold to ramp';
    const step = +range.step || 0.01;
    const lo = +range.min, hi = +range.max;
    let timer = 0, ticks = 0, moved = false;
    function nudge(mult) {
      let v = +range.value + sign * step * mult;
      v = Math.max(lo, Math.min(hi, v));
      v = Math.round(v / step) * step;             // snap to grid, kill fp drift
      if (v === +range.value) return;
      range.value = String(v);
      moved = true;
      onStep();
    }
    function stop() {
      if (!timer) return;
      clearInterval(timer); timer = 0; ticks = 0;
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('mouseup', stop);
      if (moved) { moved = false; if (onSettle) onSettle(); }
    }
    function start(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (timer) return;
      moved = false;
      nudge(1);                                    // one fine step on press
      ticks = 0;
      timer = setInterval(() => {
        ticks++;
        // fine for the first ~0.3s, then accelerate toward a fast sweep
        const mult = ticks < 7 ? 1 : Math.min(25, 1 + (ticks - 6) * 0.7);
        nudge(mult);
      }, 45);
      // End the hold on release ANYWHERE — pointer/mouse up bubble to window,
      // so this fires even if the cursor drifts off the tiny button mid-hold.
      window.addEventListener('pointerup', stop);
      window.addEventListener('mouseup', stop);
    }
    // pointerdown is the primary path; mousedown is a fallback for any build
    // that doesn't synthesize pointer events (start() guards against firing
    // twice for the same press via the `timer` check).
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('mousedown', start);
    return btn;
  }

  ctx.buildCtl = buildCtl;
  ctx.unregisterGroup = unregisterGroup;
  ctx.refreshDeck = refreshDeck;
  ctx.switchSection = switchSection;
  ctx.switchTab = switchTab;
  ctx.registryLast = () => registry[registry.length - 1];
  ctx.onDeckRefresh = (fn) => deckHooks.push(fn);
  Object.defineProperty(ctx, 'activeSection', { get: () => activeSection });
  ctx.onPersist((p) => { p.section = activeSection; });
}
