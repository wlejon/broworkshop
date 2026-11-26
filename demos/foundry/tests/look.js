// Screenshots of the designer in each mode, for looking at.
import { frames, shot } from "/lib/kit/test.js";

const F = globalThis.__foundry;
frames(40);
shot('ui-frame');
F.select('torso'); frames(6); shot('ui-frame-torso');
F.setMode('bays'); F.select('torso'); frames(6); shot('ui-bays');
F.setMode('lines'); F.select('thigh'); frames(6); shot('ui-lines');
F.setMode('armor'); F.select('torso', null, '-w'); frames(6); shot('ui-armor');
F.setArmorView('thickness'); frames(6); shot('ui-armor-thickness', '#stage');
F.setArmorView('paint');
F.setMode('test'); F.setGait('sprint'); frames(20); shot('ui-run');
F.setGait('hover'); frames(20); shot('ui-hover', '#stage');
