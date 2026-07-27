// Explore: the atoms the SAE found that nobody has named.
//
// The axis bank above holds the axes somebody could put a NAME to — 18 built from
// prompt differences, plus the 8 atoms a screening sweep singled out and a person
// then verified by eye. Those 8 carry labels and live in the bank; they are NOT
// repeated here, so every row below is genuinely unnamed and there is exactly one
// slider per direction in the whole app.
//
// What is left are CANDIDATES, not controls. The sweep rendered all 391 into three
// scenes at ±6 and essentially every one moves the picture — but moving the picture
// is not the same as being a control. Judged by eye, most of what moves is a content
// hijack (the scene becomes a castle, a crowd, a man) or a duplicate of another atom;
// eight survived. The rest are unjudged, and no number judges them: actuation,
// preservation, collapse and delta-locality were all measured and not one of them
// separates a control from a hijack (krea-research/FINDINGS_SAE_SWEEP.md). Only the
// render tells you.
//
// So the label of an unnamed atom can only ever be a PICTURE. This list used to
// argue that the picture should be the live render on your own prompt, and refuse
// to show anything else. That was an abdication: it left 383 rows reading
// `sae.4787` with a number beside them, and finding anything meant turning sliders
// at random. Meanwhile the screening sweep's own 2,346 renders — every atom, three
// unalike scenes, both poles — sat on disk unshown.
//
// They ship now, as six thumbnail atlases (assets/sheets/, ~9 MB for all 391 atoms
// at every view; one file per view rather than 2,349 fetches, addressed by
// background-position so a 383-row list costs no decodes). Each row carries its
// −6 and +6 thumbnail; hovering one flips it to the untouched scene, which is the
// A/B that actually reads. The scene picker swaps all of them at once, because an
// atom that looks like a control on a landscape can be a hijack on a still life —
// that disagreement is the single most useful thing the sweep recorded.
//
// The thumbnails are a fixed probe scene, NOT your prompt: they tell you what an
// atom does, and your own render still tells you what it does for you.
//
// Three things make hundreds of sliders scrollable instead of a wall:
//
//   ORDER    strongest mover first. `act` is how far the atom pushed the image at
//            ±6 in the sweep (a cosine distance in CLIP space; 0 = nothing moved).
//            It ranks how MUCH moved, which is not how USEFUL: the best axis in the
//            verified deck sits at rank 211 of 391, because CLIP is trained to be
//            invariant to exactly the framing and clutter it moves. Read the order
//            as a way to scroll, not as a recommendation.
//
//   GROUPS   atoms clustered by what they DID, not by any name. Similarity is the
//            mean of two cosines — one on the CLIP change, one on a 15-feature
//            pixel change — because neither alone is trustworthy: a night photo and
//            an oil painting are near-identical in pixel statistics, and CLIP is
//            blind to framing. Requiring BOTH to agree groups atoms that really do
//            move the picture alike. The group numbers are handles, not meanings.
//
// All of that is measurement from the sweep. None of it is a claim about what an
// atom IS — that is what the slider and your own prompt are for.

import { $ } from '/app/ui/util.js';

export function initExplore(ctx) {
  const rows = [];   // [{atom, act, row}] — every UNNAMED atom, built once

  // ── thumbnails: the sweep's own renders, packed into atlases ─────────────
  // assets/sheets/sheets.json says how the tiles are laid out and which slot
  // each atom got. Everything here degrades to the old slider-only list if the
  // asset is missing — a lab with no sheets is worse, not broken.
  const TILE = 64;                 // display px; the atlas ships at 128 for retina
  let sheets = null;               // the manifest
  let scene = ctx.prefs.exploreScene || 'cliff';
  const tiles = [];                // [{atom, el, pole}] — repositioned on scene change

  const SHEETS = 'assets/sheets/';
  const sceneRec = () => sheets.scenes.filter((s) => s.key === scene)[0] || sheets.scenes[0];

  // Which sheet a tile shows and how that sheet is scaled and offset are ONE
  // decision, so one function makes all three. Splitting them — filenames in the
  // stylesheet, geometry here — is what made hover draw the whole atlas at the
  // neutral strip's scale: the two rules had equal specificity, so resizing for
  // the neutral never changed the image.
  function paint(el, url, size, pos) {
    el.style.backgroundImage = 'url(' + SHEETS + url + ')';
    el.style.backgroundSize = size;
    el.style.backgroundPosition = pos;
  }

  // One atlas tile: background-size scales the whole sheet down to TILE px per
  // cell, background-position picks the cell. No per-atom image element, so the
  // list builds 766 thumbnails without 766 requests.
  function placeTile(el, atom, pole) {
    if (!sheets) return;
    const slot = sheets.slot[atom];
    if (slot == null) { el.classList.add('missing'); el.style.backgroundImage = 'none'; return; }
    paint(el, sceneRec().files[pole],
          (sheets.cols * TILE) + 'px ' + (sheets.rows * TILE) + 'px',
          '-' + ((slot % sheets.cols) * TILE) + 'px -' +
          (Math.floor(slot / sheets.cols) * TILE) + 'px');
  }

  // The neutral strip is one tile per scene laid out left to right, so showing
  // scene i means scaling the strip to N tiles wide and sliding it i tiles over.
  function placeNeutral(el, px) {
    if (!sheets) return;
    const n = sheets.scenes.length;
    const i = Math.max(0, sheets.scenes.map((s) => s.key).indexOf(scene));
    paint(el, sheets.neutral, (n * px) + 'px ' + px + 'px', '-' + (i * px) + 'px 0px');
  }

  function applyScene() {
    // No atlas: fall back to the plain slider list rather than showing an empty
    // reference frame and three dead scene buttons.
    const ref = $('explore-neutral'), pick = $('explore-scenes');
    if (ref) ref.style.display = sheets ? '' : 'none';
    if (pick && pick.parentNode) pick.parentNode.style.display = sheets ? '' : 'none';
    if (!sheets) return;
    const list = $('explore-list');
    sheets.scenes.forEach((s) => list.classList.remove('sc-' + s.key));
    list.classList.add('sc-' + scene);   // state marker, for tests and debugging
    const nt = $('explore-neutral-tile');
    if (nt) placeNeutral(nt, 96);
    // Every tile moves to the new scene's atlas — except the one under the
    // cursor, which is mid-flip and must land on the NEW scene's neutral.
    tiles.forEach((t) => {
      if (t.hovering) placeNeutral(t.el, TILE); else placeTile(t.el, t.atom, t.pole);
    });
    const cap = $('explore-neutral-cap');
    const s = sheets && sheets.scenes.filter((x) => x.key === scene)[0];
    if (cap && s) cap.textContent = 'untouched: ' + s.label;
    document.querySelectorAll('#explore-scenes .scene-btn').forEach((b) =>
      b.classList.toggle('on', b.getAttribute('data-scene') === scene));
    ctx.persist();
  }

  function buildSceneButtons() {
    const host = $('explore-scenes');
    if (!host || !sheets) return;
    host.innerHTML = '';
    sheets.scenes.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'scene-btn';
      b.setAttribute('data-scene', s.key);
      b.textContent = s.key;
      b.title = s.label + ' — every thumbnail below switches to this scene';
      b.addEventListener('click', () => { scene = s.key; applyScene(); });
      host.appendChild(b);
    });
  }

  // ── verdicts: what somebody already learned by looking ───────────────────
  // assets/sae_verdicts.json carries the judgements the sweep produced —
  // 39 contact sheets read by eye — and this is the only form that knowledge can
  // take, because the sweep also established that no NUMBER carries it: the four
  // metrics it tried (actuation, preservation, collapse, delta-locality) all fail
  // to separate a control from a content hijack. So the list ships opinions with
  // provenance rather than another score.
  //
  // Without this the ordering actively misleads. Atom 214 — which replaces your
  // subject with a castle — is one of the strongest movers in the file, so it
  // sorts high; 2811 and 6641, both of which insert a person, are rows 3 and 4 of
  // the very first group. Meanwhile 4787, a verified compositional axis, sits at
  // act 0.10 near the bottom. Sorting by how much an atom moved puts the traps at
  // eye level and buries the finds.
  //
  // Your own marks live alongside them and win, because you are looking at your
  // own prompt and the person who judged the sheet was not.
  let verdicts = {};                                  // {atom: {v, by, note, of}}
  let marks = Object.assign({}, ctx.prefs.atomMarks); // {atom: 'keep'|'reject'}
  const VERDICT_LABEL = { keep: 'keep', hijack: 'hijack', dupe: 'dupe', inert: 'inert' };
  // A verdict is only ever "worth a look" or "somebody rejected this".
  const isReject = (v) => v === 'hijack' || v === 'dupe' || v === 'inert';
  // What this atom counts as right now: your mark if you made one, else the
  // shipped verdict, else nothing.
  function stateOf(atom) {
    if (marks[atom]) return { v: marks[atom] === 'keep' ? 'keep' : 'hijack', mine: true };
    const j = verdicts[atom];
    return j ? { v: j.v, by: j.by, note: j.note, of: j.of, mine: false } : null;
  }

  // Built once and only ever SHOWN or HIDDEN. Rebuilding the list on each filter
  // keystroke would drop rows out of the control registry, and a slider you had
  // turned up would either vanish from the deck while still injecting, or stop
  // injecting without telling you. Neither is acceptable in a tool whose whole job
  // is knowing what is shaping the image.
  //
  // `named` is assets/axes_meta.json. An atom that already has a labelled slider
  // in the axis bank is SKIPPED here: building it in both places made two sliders
  // for one direction, and collectAxisControls() merged explore OVER the bank, so
  // the bank's copy silently stopped counting whenever both were turned up. One
  // direction, one slider.
  function build(index, named) {
    const host = $('explore-list');
    host.innerHTML = '';
    let group = -1, box = null, groups = 0, skipped = 0;

    index.forEach((e) => {
      const key = 'sae.' + e.atom;
      if (named[key]) { skipped++; return; }
      // Lazily — a group whose every atom is named must not leave a bare header.
      if (e.group !== group || !box) {
        group = e.group;
        groups++;
        const det = document.createElement('details');
        det.className = 'axis-cat-group';
        det.setAttribute('open', '');
        const sum = document.createElement('summary');
        sum.className = 'ctl-cat';
        const nm = document.createElement('span');
        nm.textContent = 'group ' + (group + 1);
        const hint = document.createElement('span');
        hint.className = 'hint inline';
        hint.textContent = 'move the picture alike';
        sum.appendChild(nm);
        sum.appendChild(hint);
        det.appendChild(sum);
        host.appendChild(det);
        box = det;
      }
      // The badge and the two mark buttons ride in the control's head row.
      const badge = document.createElement('span');
      badge.className = 'atom-verdict';
      const mk = (glyph, want, tip) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'atom-mark ' + want;
        b.textContent = glyph;
        b.title = tip;
        b.addEventListener('click', () => {
          // Second click on your own mark clears it, handing the atom back to
          // whatever the sweep said (or to nothing).
          if (marks[e.atom] === want) delete marks[e.atom]; else marks[e.atom] = want;
          refreshRow();
          refreshJudgedLine();
          ctx.persist();
          applyFilter();
        });
        return b;
      };
      const keepBtn = mk('✓', 'keep', 'mark this one worth keeping');
      const rejBtn = mk('✗', 'reject', 'mark this one a hijack / not worth it');

      function refreshRow() {
        const s = stateOf(e.atom);
        badge.textContent = s ? (VERDICT_LABEL[s.v] || s.v) : '';
        badge.className = 'atom-verdict' + (s ? ' show v-' + s.v + (s.mine ? ' mine' : '') : '');
        badge.title = !s ? ''
          : s.mine ? 'your mark — click the button again to clear it'
          : (s.note || '') + (s.of ? ' (see sae.' + s.of + ')' : '') +
            ' · judged by ' + (s.by === 'vlm' ? 'a vision model, unchecked' : 'eye');
        keepBtn.classList.toggle('on', marks[e.atom] === 'keep');
        rejBtn.classList.toggle('on', marks[e.atom] === 'reject');
      }

      const ctl = ctx.buildCtl({
        label: key,
        title: key + ' — unnamed. Moved the image ' + e.act.toFixed(2) +
               ' and kept the scene ' + e.pres.toFixed(2) + ' in the screening sweep; ' +
               'neither number can tell a control from a content hijack. Turn it and generate.',
        key: key,
        min: -6, max: 6, step: 0.01,
        section: 'explore',
        group: 'explore',
        headBtns: [badge, keepBtn, rejBtn],
        commit: () => {},
      });

      // The card is the filter target, not the slider row: hiding the row alone
      // would leave its two thumbnails floating with nothing under them.
      const card = document.createElement('div');
      card.className = 'atom-card';
      if (sheets) {
        const strip = document.createElement('div');
        strip.className = 'atom-thumbs';
        sheets.poles.forEach((p) => {
          const t = document.createElement('button');
          t.type = 'button';
          t.className = 'atom-tile t-' + p.key;
          t.title = key + ' at ' + (p.alpha > 0 ? '+' : '') + p.alpha +
                    ' — hover to flip back to the untouched scene, click to set the slider';
          placeTile(t, e.atom, p.key);
          // Clicking a thumbnail dials the slider to the strength that PRODUCED
          // that picture, so what you saw is what you get. ±6 is the sweep's
          // extreme, which is the point — you can always walk it back.
          t.addEventListener('click', () => { ctl.set(p.alpha); });
          // Hover flips the tile to the untouched scene and back. The swap is
          // between two different atlases, so it cannot be a :hover rule — the
          // background-position for the neutral strip is a different geometry.
          const rec = { atom: e.atom, el: t, pole: p.key, hovering: false };
          t.addEventListener('mouseenter', () => {
            rec.hovering = true;
            t.classList.add('flip');
            placeNeutral(t, TILE);
          });
          t.addEventListener('mouseleave', () => {
            rec.hovering = false;
            t.classList.remove('flip');
            placeTile(t, e.atom, p.key);
          });
          tiles.push(rec);
          strip.appendChild(t);
        });
        card.appendChild(strip);
      }
      card.appendChild(ctl.row);
      box.appendChild(card);
      rows.push({ atom: e.atom, act: e.act, row: card, ctl: ctl, group: group,
                  refresh: refreshRow });
      refreshRow();
    });
    // The h2 stays one line — it sits next to the reset button and wraps badly.
    // The curation breakdown gets its own line under the filter, where there is
    // room to say it in words.
    $('explore-count').textContent = rows.length + ' unnamed · ' + groups + ' groups';
    $('explore-count').title = skipped
      ? skipped + ' more atoms carry names and live in the axis bank'
      : '';
    refreshJudgedLine();
  }

  function refreshJudgedLine() {
    let keeps = 0, rejects = 0;
    rows.forEach((r) => {
      const s = stateOf(r.atom);
      if (!s) return;
      if (s.v === 'keep') keeps++; else if (isReject(s.v)) rejects++;
    });
    const mine = Object.keys(marks).length;
    $('btn-marks-clear').style.display = mine ? '' : 'none';
    $('btn-marks-clear').textContent = 'forget my ' + mine + ' mark' + (mine === 1 ? '' : 's');
    const el = $('explore-judged');
    el.textContent = (!keeps && !rejects)
      ? 'nobody has judged any of these yet. '
      : keeps + ' worth a look · ' + rejects + ' already rejected · ' +
        (rows.length - keeps - rejects) + ' nobody has looked at ';
  }

  function applyFilter() {
    const min = +$('explore-minact').value || 0;
    const q = ($('explore-filter').value || '').trim();
    const mode = $('explore-verdict').value;   // all | promising | unjudged | rejected
    let shown = 0;
    rows.forEach((r) => {
      const s = stateOf(r.atom);
      let pass = true;
      if (mode === 'promising') pass = !!s && s.v === 'keep';
      else if (mode === 'unjudged') pass = !s;
      else if (mode === 'rejected') pass = !!s && isReject(s.v);
      const hit = pass && r.act >= min && (!q || String(r.atom).indexOf(q) >= 0);
      // A slider that is turned up stays visible whatever the filter says — it is
      // shaping the image, so hiding it would be lying about what is on.
      const on = +r.ctl.range.value !== 0;
      r.row.style.display = (hit || on) ? '' : 'none';
      if (hit) shown++;
    });
    // Hide a group whose every row is hidden, so scrolling is not all headers.
    const boxes = $('explore-list').querySelectorAll('.axis-cat-group');
    boxes.forEach((b) => {
      const any = Array.prototype.some.call(b.querySelectorAll('.atom-card'),
                                            (c) => c.style.display !== 'none');
      b.style.display = any ? '' : 'none';
    });
    $('explore-shown').textContent = shown === rows.length ? '' : ('showing ' + shown);
  }

  // The index and the axis-bank metadata arrive independently (app.js fetches
  // axes_meta.json, we fetch the index) and the list needs BOTH: without the
  // metadata we cannot tell which atoms the bank already names, and building
  // early would put the duplicates back. Whichever lands second builds.
  //
  // The verdicts join them as a third input. They are optional — a missing or
  // broken file leaves every atom unjudged, which is exactly the state the list
  // was in before and still a usable one — but they are waited for, so the first
  // paint already carries the badges rather than flickering them in.
  //
  // The sheet manifest joins as a fourth. Also optional and also waited for: a
  // list built before it lands would have no thumbnails at all, and rebuilding
  // to add them is exactly the thing this list must never do.
  let index = null, named = null, judged = false, sheeted = false;
  function buildWhenReady() {
    if (!index || !named || !judged || !sheeted) return;
    buildSceneButtons();
    build(index, named);   // the asset is already ordered: strongest group, strongest atom
    applyScene();
    applyFilter();
  }
  ctx.onAxesMeta((meta) => { named = meta; buildWhenReady(); });
  fetch('assets/sae_index.json').then((r) => r.json()).then((ix) => {
    index = ix;
    buildWhenReady();
  }).catch((e) => { $('explore-count').textContent = 'no sae_index.json: ' + e.message; });
  fetch('assets/sae_verdicts.json').then((r) => r.json()).then((j) => {
    verdicts = (j && j.verdicts) || {};
  }).catch(() => { verdicts = {}; }).then(() => { judged = true; buildWhenReady(); });
  fetch('assets/sheets/sheets.json').then((r) => r.json()).then((j) => {
    sheets = (j && j.slot) ? j : null;
  }).catch(() => { sheets = null; }).then(() => { sheeted = true; buildWhenReady(); });

  $('explore-verdict').addEventListener('change', applyFilter);
  $('explore-filter').addEventListener('input', applyFilter);
  $('explore-minact').addEventListener('input', () => {
    $('explore-minact-val').textContent = (+$('explore-minact').value).toFixed(2);
    applyFilter();
  });
  $('btn-explore-reset').addEventListener('click', () => {
    rows.forEach((r) => r.ctl.set(0));
    applyFilter();
  });
  // Forget every mark. You can mark 383 atoms, so there has to be a way back —
  // and it must not touch the sliders: what you BELIEVE about an atom and what
  // you currently have it set to are different things.
  $('btn-marks-clear').addEventListener('click', () => {
    marks = {};
    rows.forEach((r) => r.refresh());
    refreshJudgedLine();
    ctx.persist();
    applyFilter();
  });

  // What actually goes on the wire.
  ctx.collectExplore = () => {
    const out = {};
    rows.forEach((r) => {
      const v = +r.ctl.range.value;
      if (v) out['sae.' + r.atom] = v;
    });
    return out;
  };

  // Your marks outlive the session. They are yours, so they are kept apart from
  // the shipped verdicts and never written back into the asset.
  ctx.onPersist((p) => { p.atomMarks = marks; p.exploreScene = scene; });
}
