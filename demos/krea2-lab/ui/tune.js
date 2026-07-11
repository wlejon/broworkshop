// ── AdaLN dials / band / gate scale — the tune section's research dials ──
// All neutral at 1.0 (multiplicative scales), built with the shared row
// factory so they join the deck like every other control. The range inputs
// keep their historical ids: buildGenerateMsg and the tests read them.

import { $ } from '/app/ui/util.js';

export function initTune(ctx) {
  const prefs = ctx.prefs;

  ctx.buildCtl({
    label: 'detail density', title: 'detail density (AdaLN pregate)',
    id: 'dial-pregate', min: 0.6, max: 2.0, step: 0.05, neutral: 1.0,
    value: prefs.dialPregate != null ? +prefs.dialPregate : 1.0,
    host: $('dial-rows'), section: 'tune', commit: () => {},
  });
  ctx.buildCtl({
    label: 'crispness', title: 'crispness (AdaLN prescale)',
    id: 'dial-prescale', min: 0.7, max: 1.5, step: 0.05, neutral: 1.0,
    value: prefs.dialPrescale != null ? +prefs.dialPrescale : 1.0,
    host: $('dial-rows'), section: 'tune', commit: () => {},
  });
  ctx.buildCtl({
    label: 'literal ↔ stylized', title: 'deep-tap band dial',
    id: 'band', min: 0.5, max: 3.5, step: 0.1, neutral: 1.0, decimals: 1,
    value: prefs.band != null ? +prefs.band : 1.0,
    host: $('band-rows'), section: 'tune', commit: () => {},
  });
  ctx.buildCtl({
    label: 'text gate scale',
    id: 'gate-txt', min: 0, max: 2, step: 0.05, neutral: 1.0,
    value: prefs.gateTxt != null ? +prefs.gateTxt : 1.0,
    host: $('gate-rows'), section: 'tune', commit: () => {},
  });
  ctx.buildCtl({
    label: 'image gate scale',
    id: 'gate-img', min: 0, max: 2, step: 0.05, neutral: 1.0,
    value: prefs.gateImg != null ? +prefs.gateImg : 1.0,
    host: $('gate-rows'), section: 'tune', commit: () => {},
  });

  ctx.onPersist((p) => {
    p.dialPregate = $('dial-pregate').value; p.dialPrescale = $('dial-prescale').value;
    p.band = $('band').value;
    p.gateTxt = $('gate-txt').value; p.gateImg = $('gate-img').value;
  });
  ctx.onGenerateMsg((msg) => {
    msg.band = +$('band').value;
    msg.dial = { pregate: +$('dial-pregate').value, prescale: +$('dial-prescale').value };
    msg.gate = { txtScale: +$('gate-txt').value, imgScale: +$('gate-img').value };
  });
}
