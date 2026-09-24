// sim/ctx.js — the one piece of shared mutable context: the scene graph every
// sim module builds into, set by main.js before anything is built.

export const ctx = {
    /** @type {any} bro.scene graph */
    scene: null,
};

export const scene = () => ctx.scene;
