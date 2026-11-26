// Screenshots of the designer in each mode, for looking at.
import { frames, shot } from "/lib/kit/test.js";

const F = globalThis.__foundry;
frames(40);
shot('ui-frame');
F.select('torso'); frames(6); shot('ui-frame-torso');
F.setMode('bays'); F.select('torso'); frames(6); shot('ui-bays');
F.setMode('lines'); F.select('thigh'); frames(6); shot('ui-lines');
F.setMode('armor'); F.select(null); frames(6); shot('ui-armor');
F.vp.reframe([0, 34, 0], 70, { yaw: 3.9, pitch: -0.08 }); frames(6); shot('ui-armor-close', '#stage');
F.vp.reframe([0, 30, 0], 110, { yaw: 0.6, pitch: -0.12 }); frames(6); shot('ui-armor-back', '#stage');
F.setArmorView('thickness'); frames(6); shot('ui-armor-thickness', '#stage');
F.setArmorView('paint');
F.vp.reframe([0, 27, 0], 135, { yaw: 3.75, pitch: -0.10 });
F.setMode('test'); F.setGait('sprint'); frames(20); shot('ui-run');
F.setGait('hover'); frames(20); shot('ui-hover', '#stage');
