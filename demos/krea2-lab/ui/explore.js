// Explore: every atom the SAE found, unnamed.
//
// The axis bank above holds the axes somebody could put a NAME to — 18 built from
// prompt differences, 8 picked out of a screening sweep by eye. That naming is a
// filter on our vocabulary, not on the model. The sweep rendered 391 atoms and
// essentially all of them ACTUATE: only one of the 391 barely moves the picture.
// The other 390 all do something, whether or not anyone has a word for it.
//
// So this panel does not classify, label, or rank by what an atom "is". It shows
// you what each one DOES — a 3x3 strip rendered offline (three unrelated scenes
// down, the slider at -6 / neutral / +6 across) — and lets you take any of them
// as a live slider. You find the interesting ones the way you would in any
// darkroom: by looking at the contact sheet.
//
// The strips come from the sweep's own frames, so browsing costs nothing.

import { $ } from '/app/ui/util.js';

export function initExplore(ctx) {
  let index = [];          // [{atom, act, pres}] from assets/sae_index.json
  let picked = {};         // atom -> ctl, the ones promoted to live sliders
  const PREV = 'assets/sae_previews/';

  // Restore picks from prefs so an exploration survives a reload.
  const saved = Array.isArray(ctx.prefs.explorePicks) ? ctx.prefs.explorePicks : [];

  function key(a) { return 'sae.' + a; }

  function pickRow(atom) {
    const ctl = ctx.buildCtl({
      label: key(atom), title: key(atom) + ' — unnamed; the strip is the description',
      key: key(atom), min: -6, max: 6, step: 0.01,
      section: 'explore',
      commit: () => {},
    });
    // A thumbnail beside the slider, so a picked axis stays recognisable once it
    // is out of the grid and you have five of them stacked.
    const thumb = document.createElement('img');
    thumb.className = 'explore-thumb';
    thumb.src = PREV + 'sae_' + atom + '.jpg';
    thumb.title = 'drop this axis';
    thumb.addEventListener('click', () => toggle(atom));
    ctl.row.insertBefore(thumb, ctl.row.firstChild);
    ctl.row.classList.add('explore-picked-row');
    return ctl;
  }

  function toggle(atom) {
    if (picked[atom]) {
      picked[atom].range.value = '0';       // zero it before dropping — a removed
      ctx.unregister && ctx.unregister(key(atom));   // slider must stop injecting
      picked[atom].row.remove();
      delete picked[atom];
    } else {
      const ctl = pickRow(atom);
      $('explore-picked').appendChild(ctl.row);
      picked[atom] = ctl;
    }
    const cell = $('explore-grid').querySelector('[data-atom="' + atom + '"]');
    if (cell) cell.classList.toggle('picked', !!picked[atom]);
    $('explore-picked-empty').style.display =
      Object.keys(picked).length ? 'none' : '';
    ctx.prefs.explorePicks = Object.keys(picked).map(Number);
    ctx.persist();
    ctx.refreshButtons && ctx.refreshButtons();
  }

  function buildGrid() {
    const host = $('explore-grid');
    host.innerHTML = '';
    const q = ($('explore-filter').value || '').trim();
    const min = +$('explore-minact').value || 0;
    let shown = 0;
    index.forEach((e) => {
      if (e.act < min) return;
      if (q && String(e.atom).indexOf(q) < 0) return;
      const cell = document.createElement('div');
      cell.className = 'explore-cell' + (picked[e.atom] ? ' picked' : '');
      cell.setAttribute('data-atom', e.atom);
      const im = document.createElement('img');
      im.src = PREV + 'sae_' + e.atom + '.jpg';
      im.loading = 'lazy';
      const cap = document.createElement('div');
      cap.className = 'explore-cap';
      cap.textContent = e.atom;
      cell.appendChild(im);
      cell.appendChild(cap);
      cell.title = 'sae.' + e.atom + '  ·  moves the image ' + e.act.toFixed(2) +
                   '  ·  keeps the scene ' + e.pres.toFixed(2) + '\nclick to take it as a slider';
      cell.addEventListener('click', () => toggle(e.atom));
      host.appendChild(cell);
      shown++;
    });
    $('explore-count').textContent = shown + ' of ' + index.length;
  }

  fetch('assets/sae_index.json').then((r) => r.json()).then((ix) => {
    // Strongest movers first — not a quality ranking, just the ones whose strip
    // has the most to look at.
    index = ix.slice().sort((a, b) => b.act - a.act);
    saved.forEach((a) => { if (!picked[a]) toggle(a); });
    buildGrid();
  }).catch((e) => { $('explore-count').textContent = 'no sae_index.json: ' + e.message; });

  $('explore-filter').addEventListener('input', buildGrid);
  $('explore-minact').addEventListener('input', () => {
    $('explore-minact-val').textContent = (+$('explore-minact').value).toFixed(2);
    buildGrid();
  });
  $('btn-explore-clear').addEventListener('click', () => {
    Object.keys(picked).map(Number).forEach(toggle);
  });

  // The picked sliders are plain ctl rows registered in the 'explore' section, so
  // the deck, the reset-all button and the section badges already see them. All
  // that is left is to feed them into the generate call.
  ctx.collectExplore = () => {
    const out = {};
    for (const a in picked) {
      if (!picked.hasOwnProperty(a)) continue;
      const v = +picked[a].range.value;
      if (v) out[key(a)] = v;
    }
    return out;
  };
}
