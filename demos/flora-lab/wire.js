// wire.js — helpers that build {positions, indices} pairs for MeshNode
// in Lines draw mode. Indices come in pairs (a,b) interpreted as
// GL_LINES endpoints, not triangles.
//
// Output shape: { positions: Float32Array, indices: Uint32Array }
// Feed straight into scene.createMesh({ drawMode: 'lines', ... }).

export const wire = (function () {

    function makeBuffers(vCount, iCount) {
        return {
            positions: new Float32Array(vCount * 3),
            indices:   new Uint32Array(iCount),
            vHead: 0, iHead: 0,
            pushV(x, y, z) {
                const o = this.vHead * 3;
                this.positions[o] = x; this.positions[o+1] = y; this.positions[o+2] = z;
                return this.vHead++;
            },
            pushE(a, b) {
                this.indices[this.iHead++] = a;
                this.indices[this.iHead++] = b;
            },
            finish() { return { positions: this.positions, indices: this.indices }; },
        };
    }

    // Single line segment.
    function line(a, b) {
        const buf = makeBuffers(2, 2);
        const ia = buf.pushV(a[0], a[1], a[2]);
        const ib = buf.pushV(b[0], b[1], b[2]);
        buf.pushE(ia, ib);
        return buf.finish();
    }

    // 3-axis cross centred at origin, half-extent r on each axis.
    function cross(r) {
        const buf = makeBuffers(6, 6);
        const x0 = buf.pushV(-r, 0, 0), x1 = buf.pushV(r, 0, 0);
        const y0 = buf.pushV(0, -r, 0), y1 = buf.pushV(0, r, 0);
        const z0 = buf.pushV(0, 0, -r), z1 = buf.pushV(0, 0, r);
        buf.pushE(x0, x1); buf.pushE(y0, y1); buf.pushE(z0, z1);
        return buf.finish();
    }

    // Axis-aligned box wireframe. Centred at origin; halfX/Y/Z half-extents.
    function box(hx, hy, hz) {
        hy = hy ?? hx; hz = hz ?? hx;
        const buf = makeBuffers(8, 24);
        const corners = [
            [-hx,-hy,-hz],[ hx,-hy,-hz],[ hx,-hy, hz],[-hx,-hy, hz],
            [-hx, hy,-hz],[ hx, hy,-hz],[ hx, hy, hz],[-hx, hy, hz],
        ];
        for (const c of corners) buf.pushV(c[0], c[1], c[2]);
        // bottom 0-1-2-3, top 4-5-6-7, verticals 0-4 1-5 2-6 3-7
        const edges = [
            [0,1],[1,2],[2,3],[3,0],
            [4,5],[5,6],[6,7],[7,4],
            [0,4],[1,5],[2,6],[3,7],
        ];
        for (const e of edges) buf.pushE(e[0], e[1]);
        return buf.finish();
    }

    // Flat ring on the XZ plane, radius r, n segments.
    function circle(r, n) {
        n = n || 32;
        const buf = makeBuffers(n, n * 2);
        for (let i = 0; i < n; i++) {
            const t = (i / n) * Math.PI * 2;
            buf.pushV(Math.cos(t) * r, 0, Math.sin(t) * r);
        }
        for (let i = 0; i < n; i++) buf.pushE(i, (i + 1) % n);
        return buf.finish();
    }

    // Three great circles giving a wireframe sphere look.
    function sphereCage(r, n) {
        n = n || 24;
        const buf = makeBuffers(n * 3, n * 6);
        const planes = [
            [0,1,2],   // XY (z=0)
            [0,2,1],   // XZ (y=0)
            [2,1,0],   // YZ (x=0)
        ];
        for (let p = 0; p < 3; p++) {
            const base = p * n;
            for (let i = 0; i < n; i++) {
                const t = (i / n) * Math.PI * 2;
                const c = Math.cos(t) * r, s = Math.sin(t) * r;
                const v = [0, 0, 0];
                v[planes[p][0]] = c;
                v[planes[p][1]] = s;
                buf.pushV(v[0], v[1], v[2]);
            }
            for (let i = 0; i < n; i++) buf.pushE(base + i, base + ((i + 1) % n));
        }
        return buf.finish();
    }

    // Merge a list of {positions, indices} into one buffer pair.
    // Index offsets are fixed up automatically. Returns null for empty input.
    function merge(parts) {
        let vTot = 0, iTot = 0;
        for (const p of parts) {
            vTot += p.positions.length / 3;
            iTot += p.indices.length;
        }
        if (vTot === 0) return null;
        const out = makeBuffers(vTot, iTot);
        for (const p of parts) {
            const off = out.vHead;
            out.positions.set(p.positions, out.vHead * 3);
            out.vHead += p.positions.length / 3;
            for (let i = 0; i < p.indices.length; i++) {
                out.indices[out.iHead++] = p.indices[i] + off;
            }
        }
        return out.finish();
    }

    // Translate a {positions,indices} pair in-place. Returns the same object.
    function translate(buf, dx, dy, dz) {
        const p = buf.positions;
        for (let i = 0; i < p.length; i += 3) {
            p[i]   += dx;
            p[i+1] += dy;
            p[i+2] += dz;
        }
        return buf;
    }

    return { line, cross, box, circle, sphereCage, merge, translate };

})();
