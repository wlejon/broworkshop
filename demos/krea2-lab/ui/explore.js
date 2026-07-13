// Explore: every atom the SAE found, unnamed.
//
// The axis bank above holds the axes somebody could put a NAME to — 18 built from
// prompt differences, 8 more picked out of a screening sweep by eye. That naming
// is a filter on our vocabulary, not on the model. The sweep rendered all 391 and
// essentially every one ACTUATES: exactly 1 of 391 barely moves the picture. The
// other 390 all do something, whether or not anyone has a word for it.
//
// So this is just the sliders. Turn one, generate, look. The lab renders live, so
// the picture on YOUR prompt is the label — no thumbnails, no captions, no names.
//
// Two things make 391 sliders scrollable instead of a wall:
//
//   ORDER    strongest mover first. `act` is how far the atom pushed the image at
//            ±6 in the sweep (a cosine distance in CLIP space; 0 = nothing moved).
//            The ones that do MORE are at the top, of the list and of each group.
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
  const rows = [];   // [{atom, act, row}] — every atom, built once

  // Built once and only ever SHOWN or HIDDEN. Rebuilding the list on each filter
  // keystroke would drop rows out of the control registry, and a slider you had
  // turned up would either vanish from the deck while still injecting, or stop
  // injecting without telling you. Neither is acceptable in a tool whose whole job
  // is knowing what is shaping the image.
  function build(index) {
    const host = $('explore-list');
    host.innerHTML = '';
    let group = -1, box = null;

    index.forEach((e) => {
      if (e.group !== group) {
        group = e.group;
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
      const ctl = ctx.buildCtl({
        label: 'sae.' + e.atom,
        title: 'sae.' + e.atom + ' — unnamed. Moves the image ' + e.act.toFixed(2) +
               ', keeps the scene ' + e.pres.toFixed(2) + '. Turn it and generate.',
        key: 'sae.' + e.atom,
        min: -6, max: 6, step: 0.01,
        section: 'explore',
        group: 'explore',
        commit: () => {},
      });
      box.appendChild(ctl.row);
      rows.push({ atom: e.atom, act: e.act, row: ctl.row, ctl: ctl, group: group });
    });
    $('explore-count').textContent = index.length + ' atoms · ' + (group + 1) + ' groups';
  }

  function applyFilter() {
    const min = +$('explore-minact').value || 0;
    const q = ($('explore-filter').value || '').trim();
    let shown = 0;
    rows.forEach((r) => {
      const hit = r.act >= min && (!q || String(r.atom).indexOf(q) >= 0);
      // A slider that is turned up stays visible whatever the filter says — it is
      // shaping the image, so hiding it would be lying about what is on.
      const on = +r.ctl.range.value !== 0;
      r.row.style.display = (hit || on) ? '' : 'none';
      if (hit) shown++;
    });
    // Hide a group whose every row is hidden, so scrolling is not all headers.
    const boxes = $('explore-list').querySelectorAll('.axis-cat-group');
    boxes.forEach((b) => {
      const any = Array.prototype.some.call(b.querySelectorAll('.ctl'),
                                            (c) => c.style.display !== 'none');
      b.style.display = any ? '' : 'none';
    });
    $('explore-shown').textContent = shown === rows.length ? '' : ('showing ' + shown);
  }

  fetch('assets/sae_index.json').then((r) => r.json()).then((ix) => {
    build(ix);            // the asset is already ordered: strongest group, strongest atom
    applyFilter();
  }).catch((e) => { $('explore-count').textContent = 'no sae_index.json: ' + e.message; });

  $('explore-filter').addEventListener('input', applyFilter);
  $('explore-minact').addEventListener('input', () => {
    $('explore-minact-val').textContent = (+$('explore-minact').value).toFixed(2);
    applyFilter();
  });
  $('btn-explore-reset').addEventListener('click', () => {
    rows.forEach((r) => r.ctl.set(0));
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
}
