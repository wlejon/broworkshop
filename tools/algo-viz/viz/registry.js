// Visualizer registry. Each viz module calls register(descriptor):
//
//   {
//     id: string,                        unique slug (sidebar data-id)
//     name: string,                      sidebar label + header title
//     category: string,                  sidebar group
//     subtitle: string,                  the note under the title
//     init({ stage, params, status }) -> handle
//                                        mount into the stage (a .k-viewport)
//                                        and the params toolbar; `status` is
//                                        the app's kit statusLine
//     destroy(handle)                    release scene objects, timers,
//                                        workers and window listeners
//   }
//
// The shell empties `stage` and `params` on every switch, so a viz only has
// to undo what lives outside them.

export const VIZ = [];

export function register(def) {
    if (VIZ.some((v) => v.id === def.id)) throw new Error('algo-viz: duplicate viz ' + def.id);
    VIZ.push(def);
    return def;
}
