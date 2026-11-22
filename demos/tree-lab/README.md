# Tree Lab

bro.flora's tree species presets grown alone in a nursery world (cached under
the app's cache dir), drawn as branch tubes and a clumped leaf scatter that
bro.scene sways in its wind field, beside a 1.8 m post for scale.

The presets grow to 7–10 m broadleaves (oak, beech, elm, birch) and 11–23 m
conifers; growing longer barely adds height. `draw(world, { scale, leaf })`
sizes a tree at draw time: `scale` multiplies the whole plant (2.6 makes the
oak 18.7 m with a 0.91 m trunk and 7 m clear bole), `leaf` is the drawn
leaf's size against the grown one, the crown filled with proportionally more
leaves so it covers as before.

## Files

```
index.html, main.js   page + entry: a button per species, time of day
lab.js                scene, sky, ground, the post; growSpecies, measureTree,
                      draw, clear, lookFrom
sheet.js              runSheet: each species' size, a still from eye height,
                      and its GPU ms over the bare frame at given distances
```

A headless script runs the sheet:

```js
import { runSheet } from "/app/sheet.js";
runSheet({ names: ['oak'], seconds: [60], drawOpts: { scale: 2.6, leaf: 1.5 }, costAt: [20, 60, 150] });
```

`bro-headless demos/tree-lab that-script.js`; stills go to the app's cache dir.
