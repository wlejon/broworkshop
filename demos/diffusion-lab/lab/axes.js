// Word axes — conditioning-space control built live from two word sets.
//
// A complementary steering surface to the per-token attention bias: instead of
// reweighting where a token attends, each axis is a DIRECTION in CLIP's
// conditioning space, searched from a "from" set (A) and a "to" set (B). The
// worker encodes each phrase, takes the diff-of-means, unit-normalizes, and
// registers it as a named control axis; a strength slider (value = injection
// norm, A↓ / B↑) drives it. Generate applies all active axes at once; strength 0
// is a true no-op. This is the runtime form of the brodiffusion CondControl seam.
//
// The module owns its DOM (by id) and the axis list; the app supplies the worker
// client, a status reporter, a persist hook, and busy/ready gating.

function $(id) { return document.getElementById(id); }

function splitPhrases(text) {
  return (text || '').split(/[\n,]+/).map(function (s) { return s.trim(); })
    .filter(Boolean);
}

function create(ctx) {
  // ctx: { client, status, persist, getReady, setBusy }
  var axes = [];        // { wname, name, neg, pos, sep, els }
  var axisSeq = 0;      // monotonic id for unique worker axis names
  var loaded = false;

  function refreshHint() {
    var el = $('wa-hint');
    if (!el) return;
    el.textContent = axes.length
      ? 'strength = injection norm · A↓ / B↑ · 0 = no change'
      : (loaded ? 'Add an axis from two word sets (e.g. young ↔ old).'
                : 'Load a model, then build an axis from two word sets.');
  }

  // Build the UI card for an already-registered axis and track it.
  function addAxisCard(def) {
    var card = document.createElement('div');
    card.className = 'axis-card';

    var head = document.createElement('div');
    head.className = 'axis-head';
    var nm = document.createElement('span');
    nm.className = 'axis-name';
    nm.textContent = def.name;
    nm.title = 'A: ' + def.neg.join(', ') + '  ↔  B: ' + def.pos.join(', ') +
               '  · separation ' + def.sep.toFixed(2);
    var del = document.createElement('button');
    del.className = 'icon axis-del';
    del.textContent = '✕';
    del.title = 'Remove this axis';
    head.appendChild(nm);
    head.appendChild(del);

    var row = document.createElement('div');
    row.className = 'axis-ctl';
    var range = document.createElement('input');
    range.type = 'range';
    range.min = '-40'; range.max = '40'; range.step = '1';
    range.value = String(def.strength || 0);
    var val = document.createElement('span');
    val.className = 'axis-val';
    function refresh() {
      var v = +range.value;
      val.textContent = (v > 0 ? '+' : '') + v;
      val.classList.toggle('off', v === 0);
    }
    range.addEventListener('input', function () { refresh(); ctx.persist(); });
    val.addEventListener('dblclick', function () {
      range.value = '0'; refresh(); ctx.persist();
    });
    refresh();
    row.appendChild(range);
    row.appendChild(val);

    card.appendChild(head);
    card.appendChild(row);
    $('wa-host').appendChild(card);

    var rec = { wname: def.wname, name: def.name, neg: def.neg, pos: def.pos,
                sep: def.sep, els: { card: card, range: range } };
    axes.push(rec);

    del.addEventListener('click', function () {
      ctx.client.removeAxis(rec.wname);
      var i = axes.indexOf(rec);
      if (i >= 0) axes.splice(i, 1);
      card.remove();
      refreshHint();
      ctx.persist();
    });
    refreshHint();
    return rec;
  }

  // Build a new axis from the form's two word sets.
  function doBuild() {
    if (!ctx.getReady()) return;
    var neg = splitPhrases($('wa-neg').value);
    var pos = splitPhrases($('wa-pos').value);
    if (!neg.length || !pos.length) {
      ctx.status('enter at least one word in each set', 'err'); return;
    }
    var name = $('wa-name').value.trim() || (neg[0] + ' → ' + pos[0]);
    var wname = 'ax' + (axisSeq++);
    ctx.setBusy(true);
    ctx.status('building axis — encoding ' + (neg.length + pos.length) +
               ' phrases…');
    ctx.client.search(neg, pos, wname, function (err, msg) {
      ctx.setBusy(false);
      if (err) { ctx.status(String(err.message || err), 'err'); return; }
      addAxisCard({ wname: wname, name: name, neg: neg, pos: pos,
                    sep: msg.sep, strength: 0 });
      $('wa-name').value = '';
      $('wa-neg').value = '';
      $('wa-pos').value = '';
      ctx.status('axis “' + name + '” added · separation ' +
                 msg.sep.toFixed(2), 'ok');
      ctx.persist();
    });
  }

  $('wa-build').addEventListener('click', doBuild);
  refreshHint();

  return {
    // { wname: alpha } for the nonzero axes — handed to client.prime.
    collectControls: function () {
      var out = {};
      for (var i = 0; i < axes.length; i++) {
        var v = +axes[i].els.range.value;
        if (v) out[axes[i].wname] = v;
      }
      return out;
    },

    // Plain definitions for persistence (re-registered on the next load).
    serialize: function () {
      return axes.map(function (a) {
        return { name: a.name, neg: a.neg, pos: a.pos, sep: a.sep,
                 strength: +a.els.range.value };
      });
    },

    // Re-register axes saved from a prior session — sequential, since the
    // client serializes requests. Cards appear as each is rebuilt.
    restore: function (defs) {
      defs = Array.isArray(defs) ? defs.slice() : [];
      var i = 0;
      (function next() {
        if (i >= defs.length) return;
        var d = defs[i++];
        if (!d || !d.neg || !d.pos) { next(); return; }
        var wname = 'ax' + (axisSeq++);
        ctx.client.search(d.neg, d.pos, wname, function (err, msg) {
          if (!err) {
            addAxisCard({ wname: wname,
                          name: d.name || (d.neg[0] + ' → ' + d.pos[0]),
                          neg: d.neg, pos: d.pos, sep: msg.sep,
                          strength: +d.strength || 0 });
            ctx.persist();
          }
          next();
        });
      })();
    },

    setLoaded: function (b) {
      loaded = b;
      $('wa-build').disabled = !b;
      refreshHint();
    },

    // Drop all axis cards (e.g. before a reload re-registers them against the
    // fresh pipeline). Does not touch the worker — a reload starts it clean.
    reset: function () {
      for (var i = 0; i < axes.length; i++) axes[i].els.card.remove();
      axes.length = 0;
      refreshHint();
    },

    clearStrengths: function () {
      for (var i = 0; i < axes.length; i++) {
        axes[i].els.range.value = '0';
        axes[i].els.range.dispatchEvent(new Event('input'));
      }
    },

    count: function () { return axes.length; },
  };
}

export const Axes = { create: create };
