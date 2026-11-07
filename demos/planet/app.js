// Planet: a world drawn from a bro.tiles cube-sphere cache. The core
// (core/planet.js) draws any world; a world is a folder of its own code,
// worlds/<name>/, with its entry worlds/<name>.js (core/world.js says what
// one provides). `--world=<name>` after the app's folder picks it; Earth is
// the default.
//   bro-headless demos/planet test.js --world=earth
import { boot } from "/lib/kit/app.js";
import { setWorld } from "/app/core/shaders.js";
import { startPlanet } from "/app/core/planet.js";

boot();

const arg = (bro.app?.argv ?? []).find((a) => String(a).startsWith('--world='));
const name = arg ? String(arg).slice('--world='.length) : 'earth';
// The world's modules resolve from its folder (planet::<name>, shaders.js).
setWorld(name);
const { default: world } = await import(`/app/worlds/${name}.js`);
await startPlanet(world);
