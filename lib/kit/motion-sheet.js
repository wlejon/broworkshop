// Motion oracle sheet rendering, overview maps, timelines, and slit-scan pages.

export const THRESHOLDS = {
    lostTexture: 1.5,      // block luma sigma under which motion is not measured
    eventSigma: 6,         // robust deviations over the block's last second
    popFloorD: 7,          // levels: a structure change at least this
    flashFloor: 5,         // levels: a brightness kick at least this
    kickFloor: 2.5,        // px/frame (full res): a motion kick at least this
    noiseWiggle: 7,        // Hz: motion wiggling faster than this is noise-like...
    noiseJitter: 0.3,      // ...when its jitter is at least this (px)
    flickerLevels: 1.2,    // levels of brightness noise...
    flickerWiggle: 7,      // ...wiggling faster than this (Hz)
    movingFloor: 0.15,     // px/frame: a block that moves at all
    lockstepCorr: 0.85,    // far blocks correlating over this at lag <= 2: lockstep
    incoherentCorr: 0.2,   // near blocks correlating under this: noise
};

export const B = 8;          // block size at half resolution (16 px full)
export const MARGIN = 16;    // half-res margin kept for the search

export function median(a) {
    if (!a.length) return NaN;
    const s = Float64Array.from(a).sort();
    return s[s.length >> 1];
}

export function pctl(a, p) {
    if (!a.length) return NaN;
    const s = Float64Array.from(a).sort();
    return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)))];
}

export const fx = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');

// A canvas over the page to draw a sheet on; save() writes it as a JPEG
// (quality 95: a PNG of a busy sheet is over what an image viewer takes whole).
export function sheet(W = innerWidth, H = innerHeight) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:20`;
    document.body.append(cv);
    const g = cv.getContext('2d');
    g.fillStyle = '#101010';
    g.fillRect(0, 0, W, H);
    return {
        g, W, H,
        text(s, x, y, color = '#fff', size = 13) {
            g.font = `600 ${size}px system-ui`;
            g.fillStyle = '#000'; g.fillText(s, x + 1, y + 1);
            g.fillStyle = color; g.fillText(s, x, y);
        },
        // RGBA pixels (w x h) drawn at x, y scaled by integer k (nearest).
        pixels(px, w, h, x, y, k = 1) {
            const im = g.createImageData(w * k, h * k);
            for (let j = 0; j < h * k; j++) for (let i = 0; i < w * k; i++) {
                const s = ((Math.floor(j / k)) * w + Math.floor(i / k)) * 4, d = (j * w * k + i) * 4;
                im.data[d] = px[s]; im.data[d + 1] = px[s + 1]; im.data[d + 2] = px[s + 2]; im.data[d + 3] = 255;
            }
            g.putImageData(im, x, y);
        },
        save(file) {
            advanceTime(1);
            const f = frameImage();
            const top = Math.max(0, f.height - innerHeight);
            const px = new Uint8Array(f.data.buffer, f.data.byteOffset + top * f.width * 4, (f.height - top) * f.width * 4);
            bro.image.encodeJpegFile(file, px, f.width, f.height - top, 4, 95);
            cv.remove();
            return file;
        },
    };
}

export const motionSheetMethods = {
    // The base picture for a map: the middle frame, grey and dimmed, at half size.
    baseMap() {
        const rgb = this.midRGB || this.firstRGB, W = this.W, w = this.W2, h = this.H2;
        const px = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const o = (2 * y * W + 2 * x) * 4, l = (54 * rgb[o] + 183 * rgb[o + 1] + 19 * rgb[o + 2]) >> 8;
            const v = 20 + l * 0.45, d = (y * w + x) * 4;
            px[d] = px[d + 1] = px[d + 2] = v;
        }
        return px;
    },

    tint(px, b, rgb, a) {
        const w = this.W2, x0 = MARGIN + (b % this.nx) * B, y0 = MARGIN + ((b / this.nx) | 0) * B;
        for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
            const d = ((y0 + j) * w + x0 + i) * 4;
            for (let c = 0; c < 3; c++) px[d + c] = px[d + c] * (1 - a) + rgb[c] * a;
        }
    },

    drawOverview(st, ranked) {
        const o = this.o, T = THRESHOLDS, fps = o.fps, N = this.V.length;
        const S = sheet();
        const w = this.W2, h = this.H2;
        // Map 1: events (red pops, orange flashes, yellow kicks) and flicker (magenta).
        const m1 = this.baseMap();
        for (const s of st) if (s.flicker > T.flickerLevels && s.flickerWiggle > T.flickerWiggle)
            this.tint(m1, s.b, [230, 40, 230], Math.min(0.85, 0.3 + s.flicker / 6));
        const evCount = new Map();
        const col = { pop: [255, 40, 40], flash: [255, 150, 0], kick: [255, 240, 0] };
        for (const e of this.events) {
            // Every block of the event's box.
            for (let b = 0; b < this.nb; b++) {
                const [x, y] = this.blockCentre(b);
                if (x >= e.box[0] && x <= e.box[2] && y >= e.box[1] && y <= e.box[3]) {
                    const c = evCount.get(b) || { n: 0, kind: e.kind };
                    c.n++;
                    evCount.set(b, c);
                }
            }
        }
        for (const [b, c] of evCount) this.tint(m1, b, col[c.kind], Math.min(0.9, 0.45 + 0.15 * c.n));
        S.pixels(m1, w, h, 0, 0);
        // Map 2: motion character, coloured by wiggle, opacity by motion.
        const m2 = this.baseMap();
        for (const s of st) {
            if (s.motion === undefined) {
                if (s.tex >= T.lostTexture && s.valid < 0.7) this.tint(m2, s.b, [40, 40, 120], 0.6);
                continue;
            }
            if (s.motion < T.movingFloor) continue;
            const f = s.wiggle;
            const c = f < 2 ? [40, 200, 70] : f < 4 ? [40, 200, 200] : f < 7 ? [250, 180, 30] : [255, 40, 40];
            this.tint(m2, s.b, c, Math.min(0.9, 0.25 + 0.25 * s.motion));
        }
        S.pixels(m2, w, h, w, 0);
        // Region outlines.
        S.g.lineWidth = 1;
        for (const r of this.regionsAt(N >> 1) || []) {
            const [x0, y0, x1, y1] = r.rect;
            for (const ox of [0, w]) {
                S.g.strokeStyle = '#7cf';
                S.g.strokeRect(ox + x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h);
                S.text(r.name, ox + x0 * w + 3, y0 * h + 13, '#7cf', 11);
            }
        }
        // Top events numbered.
        for (const e of ranked.slice(0, 12)) {
            const x = e.centre[0] / 2, y = e.centre[1] / 2;
            S.g.strokeStyle = '#fff';
            S.g.strokeRect(e.box[0] / 2, e.box[1] / 2, (e.box[2] - e.box[0]) / 2, (e.box[3] - e.box[1]) / 2);
            S.text(`#${e.rank}`, x + 6, y - 4, '#fff', 12);
        }
        S.text(`${o.name}: events (red pop = structure change, orange flash = brightness kick, yellow kick = motion jerk), magenta flicker`, 6, h - 8, '#fff', 11);
        S.text('motion by wiggle: green <2 Hz sway, cyan 2-4, amber 4-7 flutter, red >7 Hz noise; opacity = amount; navy = lost', w + 6, h - 8, '#fff', 11);
        // Timelines.
        this.drawTimelines(S, 0, h, w, h);
        // Slit-scans through the top events (or the busiest rows).
        this.drawEventSlits(S, ranked, st, w, h, w, h);
        return S.save(`${o.out}/${o.name}_motion.jpg`);
    },

    drawTimelines(S, X, Y, w, h) {
        const o = this.o, N = this.V.length, fps = o.fps, g = S.g;
        g.fillStyle = '#181818';
        g.fillRect(X, Y, w, h);
        const names = [...new Set((this.regionsAt(N >> 1) || []).map((r) => r.name))];
        const groups = names.length ? names : [null];
        const colors = ['#5f5', '#5cf', '#fc5', '#f8f', '#f55', '#aaf'];
        const pad = 34, pw = w - pad - 8;
        const xs = (k) => X + pad + (k / Math.max(1, N - 1)) * pw;
        // Per region per frame: median |V - region mean| (px/frame), mean |P kick|.
        const series = groups.map((name) => {
            const mv = new Float32Array(N), fl = new Float32Array(N);
            for (let k = 0; k < N; k++) {
                const vs = [], ps = [];
                for (let b = 0; b < this.nb; b++) {
                    if (name !== null && this.regionOf(b, k) !== name) continue;
                    const vx = this.V[k][2 * b];
                    if (Number.isFinite(vx)) vs.push(Math.hypot(vx, this.V[k][2 * b + 1]));
                    if (k > 0 && k < N - 1) {
                        const p = this.P[k][b] - 0.5 * (this.P[k - 1][b] + this.P[k + 1][b]);
                        if (Number.isFinite(p)) ps.push(Math.abs(p));
                    }
                }
                mv[k] = vs.length ? pctl(vs, 0.75) : NaN;
                fl[k] = ps.length ? pctl(ps, 0.9) : NaN;
            }
            return { name, mv, fl };
        });
        const panel = (y0, ph, key, label, unit) => {
            let mx = 1e-3;
            for (const s of series) for (const v of s[key]) if (Number.isFinite(v)) mx = Math.max(mx, v);
            g.strokeStyle = '#444';
            g.strokeRect(X + pad, y0, pw, ph);
            S.text(`${label} (max ${mx.toFixed(2)} ${unit})`, X + pad + 4, y0 + 12, '#ccc', 11);
            series.forEach((s, i) => {
                g.strokeStyle = colors[i % colors.length];
                g.beginPath();
                let started = false;
                for (let k = 0; k < N; k++) {
                    const v = s[key][k];
                    if (!Number.isFinite(v)) { started = false; continue; }
                    const x = xs(k), y = y0 + ph - (v / mx) * (ph - 16);
                    if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
                }
                g.stroke();
            });
        };
        const ph = (h - 70) / 3;
        panel(Y + 6, ph, 'mv', 'motion p75 per frame', 'px/frame');
        panel(Y + 12 + ph, ph, 'fl', 'brightness kick p90 per frame', 'levels');
        // Events per frame.
        const y0 = Y + 18 + 2 * ph;
        g.strokeStyle = '#444';
        g.strokeRect(X + pad, y0, pw, ph);
        S.text('events (red pop, orange flash, yellow kick); #n = rank', X + pad + 4, y0 + 12, '#ccc', 11);
        const colK = { pop: '#f33', flash: '#f90', kick: '#ff0' };
        for (const e of this.events) {
            g.fillStyle = colK[e.kind];
            const hh = Math.min(ph - 16, 6 + 3 * e.blocks);
            g.fillRect(xs(e.pair) - 1, y0 + ph - hh, 2, hh);
        }
        for (const e of (this.ranked || []).slice(0, 8)) S.text(`#${e.rank}`, xs(e.pair) - 6, y0 + 26 + (e.rank % 3) * 11, '#fff', 10);
        // Time axis.
        const secs = N / fps;
        const stepS = secs > 20 ? 5 : secs > 8 ? 2 : 1;
        for (let s = 0; s <= secs; s += stepS) {
            const k = s * fps;
            S.text(this.meta[k] && this.meta[k].t !== undefined ? `${this.meta[k].t.toFixed(1)}s` : `${s}s`, xs(k) - 8, Y + h - 30, '#999', 10);
        }
        series.forEach((s, i) => S.text(s.name || 'view', X + pad + 6 + i * 110, Y + h - 12, colors[i % colors.length], 12));
    },

    // A slit's pixels over frames [k0, k1): from kept luma (any row) or a fixed slit.
    slitPixels(spec, k0, k1) {
        const W = this.W, n = k1 - k0;
        if (spec.fixed !== undefined) {
            const rows = this.slitRows[spec.fixed], w = rows[0].length / 4;
            const px = new Uint8Array(w * n * 4);
            for (let k = 0; k < n; k++) px.set(rows[k0 + k], k * w * 4);
            return { px, w, h: n };
        }
        const w = spec.x1 - spec.x0 + 1, px = new Uint8Array(w * n * 4);
        for (let k = 0; k < n; k++) {
            const L = this.lumaAll[k0 + k];
            for (let i = 0; i < w; i++) {
                const v = L[spec.y * W + spec.x0 + i], d = (k * w + i) * 4;
                px[d] = px[d + 1] = px[d + 2] = v;
            }
        }
        return { px, w, h: n };
    },

    drawSlit(S, spec, k0, k1, X, Y, maxW, maxH, label, marks) {
        const n = k1 - k0;
        const { px, w, h } = this.slitPixels(spec, k0, k1);
        // Each frame `ky` rows tall, each pixel `kx` wide, within the panel.
        const ky = Math.max(1, Math.min(3, Math.floor((maxH - 18) / n)));
        let src = px, sw = w;
        if (w > maxW) {
            // Narrow: keep the middle maxW columns at full resolution.
            const c0 = Math.floor((w - maxW) / 2);
            sw = maxW;
            src = new Uint8Array(sw * h * 4);
            for (let y = 0; y < h; y++) src.set(px.subarray((y * w + c0) * 4, (y * w + c0 + sw) * 4), y * sw * 4);
        }
        const kx = Math.max(1, Math.min(3, Math.floor(maxW / sw)));
        const im = S.g.createImageData(sw * kx, n * ky);
        for (let y = 0; y < n * ky; y++) for (let x = 0; x < sw * kx; x++) {
            const s = (Math.floor(y / ky) * sw + Math.floor(x / kx)) * 4, d = (y * sw * kx + x) * 4;
            im.data[d] = src[s]; im.data[d + 1] = src[s + 1]; im.data[d + 2] = src[s + 2]; im.data[d + 3] = 255;
        }
        S.g.putImageData(im, X + 14, Y + 16);
        S.text(label, X + 2, Y + 11, '#fff', 11);
        // Event marks on the left edge, a tick a second on the right.
        for (const m of marks || []) {
            if (m.k < k0 || m.k >= k1) continue;
            S.g.fillStyle = m.color || '#f33';
            S.g.fillRect(X + 2, Y + 16 + (m.k - k0) * ky, 10, Math.max(2, ky));
            if (m.label) S.text(m.label, X + 16 + sw * kx + 2, Y + 20 + (m.k - k0) * ky, m.color || '#f33', 10);
        }
        for (let k = k0; k < k1; k++) if (k % this.o.fps === 0) {
            S.g.fillStyle = '#666';
            S.g.fillRect(X + 14 + sw * kx, Y + 16 + (k - k0) * ky, 4, 1);
        }
        return sw * kx + 30;
    },

    // Slits for the overview: through the top events (a window round each),
    // else through each region's busiest block row.
    eventSlitSpecs(ranked, st) {
        const W = this.W, specs = [];
        const use = ranked.slice(0, 2);
        for (const e of use) {
            const y = Math.round(e.centre[1]);
            if (this.o.keepFrames) {
                const x0 = Math.max(0, Math.round(e.centre[0] - 75)), x1 = Math.min(W - 1, x0 + 149);
                specs.push({ spec: { y, x0, x1 }, centre: e.pair, label: `#${e.rank} ${e.kind} row ${y}, x ${x0}-${x1}` });
            } else if (this.o.slits.length) {
                // The nearest fixed slit.
                let bi = 0, bd = Infinity;
                this.o.slits.forEach((s, i) => { const d = Math.abs(s.y * this.H - y); if (d < bd) { bd = d; bi = i; } });
                specs.push({ spec: { fixed: bi }, centre: e.pair, label: `#${e.rank} ${e.kind} (nearest slit ${this.o.slits[bi].label})` });
            }
        }
        return specs;
    },

    drawEventSlits(S, ranked, st, X, Y, w, h) {
        const N = this.frames, specs = this.eventSlitSpecs(ranked, st);
        if (!specs.length) {
            // No events: the busiest rows of each region.
            for (const sp of this.busySlits(st).slice(0, 2)) specs.push(sp);
        }
        const per = Math.floor(w / Math.max(1, specs.length));
        const win = Math.min(N, Math.floor((h - 20) / 2));
        let x = X;
        for (const sp of specs.slice(0, 2)) {
            const k0 = Math.max(0, Math.min(N - win, (sp.centre !== undefined ? sp.centre : N / 2) - (win >> 1)) | 0);
            const marks = this.events.map((e) => ({ k: e.frame, color: { pop: '#f33', flash: '#f90', kick: '#ff0' }[e.kind] }));
            this.drawSlit(S, sp.spec, k0, Math.min(N, k0 + win), x, Y, per - 34, h, `${sp.label}, frames ${k0}-${k0 + win} (time runs down)`, marks);
            x += per;
        }
    },

    busySlits(st) {
        const out = [];
        if (!this.o.keepFrames) return this.o.slits.map((s, i) => ({ spec: { fixed: i }, label: `slit ${s.label}` }));
        const names = [...new Set((this.regionsAt(this.V.length >> 1) || []).map((r) => r.name))];
        for (const name of names.length ? names : [null]) {
            const bs = st.filter((s) => s.motion > THRESHOLDS.movingFloor && (name === null || this.regionOf(s.b, this.V.length >> 1) === name));
            if (!bs.length) continue;
            const best = bs.sort((p, q) => q.motion - p.motion)[Math.min(bs.length - 1, Math.floor(bs.length * 0.1))];
            const [cx, cy] = this.blockCentre(best.b);
            // 150 px, drawn 3x: a sway of a pixel or two shows.
            const x0 = Math.max(0, Math.round(cx - 75)), x1 = Math.min(this.W - 1, x0 + 149);
            out.push({ spec: { y: Math.round(cy), x0, x1 }, label: `${name || 'view'}: row ${Math.round(cy)}, x ${x0}-${x1}` });
        }
        return out;
    },

    drawEvents(ranked) {
        const S = sheet(), o = this.o;
        const top = ranked.filter((e) => e.crop).slice(0, 6);
        const cw = 200, ch = 150, k = 1;
        S.text(`${o.name}: top events, each the frames before, at and after it (box = the blocks that broke)`, 8, 16, '#fff', 13);
        top.forEach((e, i) => {
            const col = i % 2, row = (i / 2) | 0;
            const X = 8 + col * 636, Y = 26 + row * 222;
            e.crop.px.forEach((px, j) => {
                S.pixels(px, cw, ch, X + j * (cw + 4), Y + 18, k);
                S.g.strokeStyle = j === 1 ? '#f33' : '#888';
                const bx0 = Math.max(0, e.box[0] - e.crop.x0), by0 = Math.max(0, e.box[1] - e.crop.y0);
                const bx1 = Math.min(cw, e.box[2] - e.crop.x0), by1 = Math.min(ch, e.box[3] - e.crop.y0);
                S.g.strokeRect(X + j * (cw + 4) + bx0, Y + 18 + by0, bx1 - bx0, by1 - by0);
                S.text(['t-1', 't', 't+1'][j], X + j * (cw + 4) + 3, Y + 30, '#fff', 11);
            });
            const t = e.meta && e.meta.t !== undefined ? e.meta.t : e.frame / o.fps;
            const m = o.eventMeta ? o.eventMeta(e.meta || {}) : '';
            S.text(`#${e.rank} ${e.kind} frame ${e.frame} t=${t.toFixed(2)}s z ${e.z.toFixed(1)} ${e.region || ''} ${m}`.slice(0, 96), X, Y + 12, '#fc6', 12);
        });
        return S.save(`${o.out}/${o.name}_motion_events.jpg`);
    },

    // Slit pages: every fixed slit over the whole run (long runs: several
    // pages), or each region's busiest row (kept frames).
    drawSlitPages(st, ranked) {
        const o = this.o, N = this.frames, files = [];
        const specs = this.busySlits(st);
        if (!specs.length) return files;
        const panelH = 340, win = panelH, pages = [];
        // Panels: (spec, window); 4 a page (2 x 2), each up to 620 px wide.
        const panels = [];
        for (const sp of specs) for (let k0 = 0; k0 < N; k0 += win) panels.push({ sp, k0, k1: Math.min(N, k0 + win) });
        for (let i = 0; i < panels.length; i += 4) pages.push(panels.slice(i, i + 4));
        const marks = this.events.map((e) => ({ k: e.frame, color: { pop: '#f33', flash: '#f90', kick: '#ff0' }[e.kind],
                                                label: e.rank <= 12 ? `#${e.rank}` : '' }));
        pages.slice(0, 6).forEach((pg, pi) => {
            const S = sheet();
            pg.forEach((p, i) => {
                const X = (i % 2) * 640, Y = ((i / 2) | 0) * 360;
                const t0 = this.meta[p.k0] && this.meta[p.k0].t !== undefined ? this.meta[p.k0].t : p.k0 / o.fps;
                this.drawSlit(S, p.sp.spec, p.k0, p.k1, X, Y, 580, 358, `${p.sp.label}; from t=${t0.toFixed(1)}s, ` +
                              `${p.k1 - p.k0} frames down`, marks);
            });
            files.push(S.save(`${o.out}/${o.name}_motion_slits${pages.length > 1 ? pi + 1 : ''}.jpg`));
        });
        return files;
    },
};
