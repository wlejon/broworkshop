// rig.js — playback for skinned glTF files: CPU skinning of the working
// meshes from an animation (or a blend of two), bone markers, bind pose.

import { h, clear } from "/lib/kit/dom.js";

/** Handle: { active, blend, blendW, paused, bindPose, bones, time, attach(doc), pose(), update(dt), setBones(on, size), renderList(el, onChange) }. */
export function createRig(scene) {
    let doc = null;
    let boneNodes = [];
    const rig = {
        active: -1, blend: -1, blendW: 0.5,
        paused: false, bindPose: false, bones: false,
        time: 0,

        attach(d) {
            doc = d;
            rig.active = d && d.hasAnim ? 0 : -1;
            rig.blend = -1;
            rig.blendW = 0.5;
            rig.time = 0;
            clearBones();
        },

        get canPlay() { return !!(doc && doc.hasSkin && doc.hasSkel); },

        /** The pose for the current time: bind, one clip, or two clips blended. */
        pose() {
            if (!doc || !doc.hasSkel) return null;
            if (rig.bindPose || rig.active < 0 || !doc.hasAnim) return doc.skeleton.bindPose();
            const sample = (i) => {
                const a = doc.animations[i];
                return a.evaluate(doc.skeleton, a.duration > 0 ? rig.time % a.duration : rig.time, true);
            };
            const pa = sample(rig.active);
            if (rig.blend < 0 || !doc.animations[rig.blend]) return pa;
            return Pose.blend(pa, sample(rig.blend), rig.blendW);
        },

        /**
         * Advance and skin. `frozen` (geometry was modified, or an LOD is
         * shown) leaves the meshes alone but still moves the bone markers.
         */
        update(dt, frozen) {
            if (!doc || !doc.hasSkel) return;
            if (!rig.paused && !rig.bindPose) rig.time += dt;
            const pose = rig.pose();
            if (!frozen && doc.hasSkin) {
                // applySkinning multiplies by the skin's inverse binds itself,
                // so it takes world matrices (not computeSkinningMatrices, as
                // the docs say: ENGINE-ISSUES.md "applySkinning applies the
                // inverse bind twice"). The test pins the deformed shape.
                const mats = pose.computeWorldMatrices(doc.skeleton);
                for (const it of doc.items) {
                    if (it.work.vertexCount !== doc.skin.vertexCount) continue;
                    it.work.positions = new Float32Array(it.basePositions);
                    if (it.baseNormals) it.work.normals = new Float32Array(it.baseNormals);
                    it.work.applySkinning(doc.skin, mats);
                    it.work.computeNormals();
                    it.node.updateMesh(it.work);
                }
            }
            if (boneNodes.length) {
                const world = pose.computeWorldMatrices(doc.skeleton);
                boneNodes.forEach((n, i) => { n.x = world[i * 16 + 12]; n.y = world[i * 16 + 13]; n.z = world[i * 16 + 14]; });
            }
        },

        /** Show / hide a marker sphere per bone (`size` = radius). */
        setBones(on, size) {
            rig.bones = on;
            clearBones();
            if (!on || !doc || !doc.hasSkel) return;
            for (let i = 0; i < doc.skeleton.boneCount; i++) {
                boneNodes.push(scene.createMesh({
                    mesh: Mesh.sphere(size, 8, 6), color: '#ffe66d', unlit: true,
                    castsShadow: false, depthBias: [-1, -1000], name: 'bone-' + i,
                }));
            }
            rig.update(0, true);
        },
        get boneCount() { return boneNodes.length; },

        /** Click an entry to play it; shift-click to blend it with the playing one. */
        choose(i, shift) {
            if (shift) {
                rig.blend = rig.blend === i || i === rig.active ? -1 : i;
            } else {
                rig.active = i;
                if (rig.blend === i) rig.blend = -1;
            }
        },

        renderList(el, onChange) {
            clear(el);
            if (!doc || !doc.hasAnim) { el.appendChild(h('div.k-note', null, '(no animations)')); return; }
            doc.animations.forEach((a, i) => {
                const cls = 'div.anim-item' + (i === rig.active ? '.active' : '') + (i === rig.blend ? '.blend' : '');
                el.appendChild(h(cls, {
                    dataset: { index: String(i) },
                    onclick: (e) => { rig.choose(i, e.shiftKey); rig.renderList(el, onChange); if (onChange) onChange(); },
                }, (a.name || 'anim ' + i) + ' · ' + a.duration.toFixed(2) + 's'));
            });
        },

        detach() { doc = null; clearBones(); },
    };

    function clearBones() {
        for (const n of boneNodes) n.destroy();
        boneNodes = [];
    }
    return rig;
}
