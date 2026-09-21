// The tune section: the modulation delta, the norm_out scale, and the
// prefix-K/V dial — the raw in-network knobs the desk's faders spend.
//
// ONE modulation vector drives all 32 blocks, so a block range is realised by
// building a second copy of that vector for the blocks inside it. The delta is
// specified as a FRACTION of that chunk's own value at the current step —
// chunk norms run 21 (gate1) to 189 (gate2) along the schedule, so an absolute
// add would mean four different things in four places — and it lands BEFORE
// the tanh, where a gate component saturates rather than running away.
//
// The bounds are ASYMMETRIC in the research's own dial vector and for a reason
// that generalises: on this model attenuating something the network produced is
// safe and amplifying it is out of distribution. mod.scale1 carries bound 0.25
// downward and 0.025 upward.

import { $ } from '/app/ui/util.js';

export function initTune(ctx) {
  const prefs = ctx.prefs;
  const T = (k, d) => (prefs.tune && prefs.tune[k] != null ? +prefs.tune[k] : d);

  const CHUNKS = [
    ['mod-scale1', 'scale1', 'the attention sublayer\'s pre-norm scale — reads as coarseness'],
    ['mod-gate1', 'gate1', 'the attention residual\'s gate, pre-tanh'],
    ['mod-scale2', 'scale2', 'the SwiGLU sublayer\'s pre-norm scale'],
    ['mod-gate2', 'gate2', 'the SwiGLU residual\'s gate, pre-tanh — the model\'s largest modulation direction, and 74% of it sits where tanh\' < 0.05'],
  ];
  const mod = CHUNKS.map(([id, label, title]) => ctx.buildCtl({
    label: label, title: title, id: id, key: id, lane: 'mod',
    min: -0.5, max: 0.5, step: 0.005,
    value: T(id, 0),
    host: $('mod-rows'), section: 'tune',
    chip: () => 'mod.' + label,
    commit: () => {},
  }));

  const modBand = {
    lo: ctx.buildCtl({ label: 'first block', id: 'mod-lo', min: 0, max: 31, step: 1,
                       neutral: 0, decimals: 0, value: T('mod-lo', 0),
                       host: $('mod-band-rows'), commit: () => {} }),
    hi: ctx.buildCtl({ label: 'one past the last', id: 'mod-hi', min: 1, max: 32, step: 1,
                       neutral: 32, decimals: 0, value: T('mod-hi', 32),
                       host: $('mod-band-rows'), commit: () => {} }),
  };
  if (prefs.modTarget) $('mod-target').value = prefs.modTarget;
  $('mod-target').addEventListener('change', () => {
    ctx.persist();
    if (ctx.live) ctx.schedule('full');
  });

  // One (1, hidden) knob on the final adaptive scale the target rows pass
  // through on the way to proj_out.
  const normOut = ctx.buildCtl({
    label: 'norm_out scale delta', id: 'normout', key: 'normout', lane: 'normOut',
    title: 'added to the final adaptive scale before proj_out',
    min: -0.5, max: 0.5, step: 0.005, value: T('normout', 0),
    host: $('normout-rows'), section: 'tune',
    commit: () => {},
  });

  // The one prefix-side hook that needs no re-extraction: a dial applied where
  // the cached K/V are READ, idempotent, and it survives a cache reset.
  const pkv = {
    k: ctx.buildCtl({ label: 'K scale', id: 'pkv-k', key: 'pkv-k', lane: 'prefixKv',
                      title: 'flattens the attention pattern the prompt induces',
                      min: 0, max: 1.5, step: 0.05, neutral: 1.0, value: T('pkv-k', 1),
                      host: $('pkv-rows'), section: 'tune', commit: () => {} }),
    v: ctx.buildCtl({ label: 'V scale', id: 'pkv-v', key: 'pkv-v', lane: 'prefixKv',
                      title: 'fades the prompt\'s contribution, leaving its attention pattern intact',
                      min: 0, max: 1.5, step: 0.05, neutral: 1.0, value: T('pkv-v', 1),
                      host: $('pkv-rows'), section: 'tune', commit: () => {} }),
    lo: ctx.buildCtl({ label: 'first layer', id: 'pkv-lo', min: 0, max: 31, step: 1,
                       neutral: 0, decimals: 0, value: T('pkv-lo', 0),
                       host: $('pkv-rows'), commit: () => {} }),
    hi: ctx.buildCtl({ label: 'one past the last', id: 'pkv-hi', min: 1, max: 32, step: 1,
                       neutral: 32, decimals: 0, value: T('pkv-hi', 32),
                       host: $('pkv-rows'), commit: () => {} }),
  };

  $('btn-reset-mod').addEventListener('click', () => {
    let any = false;
    mod.concat([normOut]).forEach((h) => {
      if (h.value !== 0) any = true;
      h.set(0, { silent: true });
    });
    if (any && ctx.live) ctx.schedule('full');
  });
  $('btn-reset-pkv').addEventListener('click', () => {
    let any = false;
    [pkv.k, pkv.v].forEach((h) => {
      if (h.value !== 1) any = true;
      h.set(1, { silent: true });
    });
    if (any && ctx.live) ctx.schedule('full');
  });

  ctx.onPersist((p) => {
    p.tune = {
      'mod-scale1': mod[0].value, 'mod-gate1': mod[1].value,
      'mod-scale2': mod[2].value, 'mod-gate2': mod[3].value,
      'mod-lo': modBand.lo.value, 'mod-hi': modBand.hi.value,
      normout: normOut.value,
      'pkv-k': pkv.k.value, 'pkv-v': pkv.v.value,
      'pkv-lo': pkv.lo.value, 'pkv-hi': pkv.hi.value,
    };
    p.modTarget = $('mod-target').value;
  });
  ctx.onGenerateMsg((msg) => {
    const fracs = mod.map((h) => h.value);
    if (fracs.some((f) => f !== 0)) {
      msg.mod = {
        fracs: fracs,
        lo: Math.min(modBand.lo.value, modBand.hi.value - 1), hi: modBand.hi.value,
        target: $('mod-target').value,
      };
    }
    if (normOut.value) msg.normOut = normOut.value;
    if (pkv.k.value !== 1 || pkv.v.value !== 1) {
      msg.prefixKv = { k: pkv.k.value, v: pkv.v.value,
                       lo: Math.min(pkv.lo.value, pkv.hi.value - 1), hi: pkv.hi.value };
    }
  });
}
