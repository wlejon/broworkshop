// Visualizer registry. Each viz module pushes its descriptor onto VIZ.
// Descriptor shape:
//   {
//     id: string,                       // unique slug
//     name: string,                     // sidebar label
//     category: string,                 // sidebar group
//     subtitle: string,                 // header line under title
//     init({ stage, params }) -> handle // mount; create canvas + controls
//     destroy(handle)                   // unmount; release scene/canvas/timers
//   }
//
// `stage` and `params` are containers the viz can fill; the shell empties
// them on switch. The viz owns its own canvas creation so it can choose 2D
// vs scene context per algorithm.

window.VIZ = window.VIZ || [];
