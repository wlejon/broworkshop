// Shared HDR atomic splat GPU compute engine via bro.kernel.
// Compiles caller manifold shaders importing `sci::splat`, uploads column KernelBuffers
// directly from bro.table (`toKernelBuffer(..., { residency: 'gpu' })`), runs clear +
// grid-stride splat + HDR bloom resolve directly to `canvas.getContext('kernel')`.

export const SCI_SPLAT_MODULE_SRC = `
// Shared 3D camera projection, fixed-point HDR atomic splatting, and scientific colormaps.

pub const SPLAT_SCALE: f32 = 256.0;

pub fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = clamp((x - edge0) / max(edge1 - edge0, 1e-6), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// Evaluates bit idx from a packed Uint32Array filter mask; returns 1.0 when set.
pub fn mask_active(mask: read_store<u32, 1>, idx: u32, hasMask: u32) -> f32 {
    if hasMask == 0u {
        return 1.0;
    }
    let w = mask[idx >> 5u];
    let b = (w >> (idx & 31u)) & 1u;
    if b != 0u {
        return 1.0;
    }
    return 0.0;
}

// Projects world point using camera basis packed in vec4s:
//   camR.xyz = right axis, camR.w = dist
//   camU.xyz = up axis,    camU.w = fovPx
//   camF.xyz = forward,    camT.xyz = target
// Returns vec3(screenX, screenY, depth); depth <= 0.05 means behind camera.
pub fn project_point(p: vec3<f32>,
                     camR: vec4<f32>, camU: vec4<f32>,
                     camF: vec4<f32>, camT: vec4<f32>,
                     w: u32, h: u32) -> vec3<f32> {
    let d = p - camT.xyz;
    let depth = camR.w + dot(d, camF.xyz);
    if depth <= 0.05 {
        return vec3<f32>(-1.0, -1.0, -1.0);
    }
    let px = dot(d, camR.xyz);
    let py = dot(d, camU.xyz);
    let invz = camU.w / depth;
    let sx = (w as f32) * 0.5 + px * invz;
    let sy = (h as f32) * 0.5 - py * invz;
    return vec3<f32>(sx, sy, depth);
}

// Atomically splats linear HDR RGB color at integer pixel (sx, sy) with optional 2x2 subpixel tap.
pub fn splat_pixel(accR: rw_store<u32, 1>, accG: rw_store<u32, 1>,
                   accB: rw_store<u32, 1>, accC: rw_store<u32, 1>,
                   sx: f32, sy: f32, w: u32, h: u32,
                   col: vec3<f32>, radiusMode: u32) {
    let ix = sx as i32;
    let iy = sy as i32;
    if ix < 1 || iy < 1 || ix >= (w as i32) - 1 || iy >= (h as i32) - 1 {
        return;
    }
    let rQ = min(65535u, (max(col.x, 0.0) * SPLAT_SCALE) as u32);
    let gQ = min(65535u, (max(col.y, 0.0) * SPLAT_SCALE) as u32);
    let bQ = min(65535u, (max(col.z, 0.0) * SPLAT_SCALE) as u32);
    if rQ == 0u && gQ == 0u && bQ == 0u {
        return;
    }
    let pid = (iy as u32) * w + (ix as u32);
    if rQ > 0u { accR.atomic_add(pid, rQ); }
    if gQ > 0u { accG.atomic_add(pid, gQ); }
    if bQ > 0u { accB.atomic_add(pid, bQ); }
    accC.atomic_add(pid, 1u);

    if radiusMode > 0u {
        let rSide = rQ >> 1u;
        let gSide = gQ >> 1u;
        let bSide = bQ >> 1u;
        if rSide > 0u {
            accR.atomic_add(pid + 1u, rSide);
            accR.atomic_add(pid + w, rSide);
        }
        if gSide > 0u {
            accG.atomic_add(pid + 1u, gSide);
            accG.atomic_add(pid + w, gSide);
        }
        if bSide > 0u {
            accB.atomic_add(pid + 1u, bSide);
            accB.atomic_add(pid + w, bSide);
        }
    }
}

// Planckian / Gaia BP-RP blue-white-amber-red stellar ramp (t in 0..1: 0=hot O/B, 1=cool M).
pub fn blackbody_rgb(tIn: f32) -> vec3<f32> {
    let t = clamp(tIn, 0.0, 1.0);
    if t < 0.35 {
        let u = t / 0.35;
        return mix(vec3<f32>(0.38, 0.68, 1.35), vec3<f32>(0.96, 0.98, 1.08), vec3<f32>(u, u, u));
    }
    if t < 0.68 {
        let u = (t - 0.35) / 0.33;
        return mix(vec3<f32>(0.96, 0.98, 1.08), vec3<f32>(1.15, 0.72, 0.28), vec3<f32>(u, u, u));
    }
    let u = (t - 0.68) / 0.32;
    return mix(vec3<f32>(1.15, 0.72, 0.28), vec3<f32>(1.10, 0.24, 0.14), vec3<f32>(u, u, u));
}

// Perceptually bright Viridis-like plasma colormap (t in 0..1).
pub fn plasma_rgb(tIn: f32) -> vec3<f32> {
    let t = clamp(tIn, 0.0, 1.0);
    let r = clamp(0.18 + 1.05 * smoothstep(0.18, 0.92, t), 0.05, 1.25);
    let g = clamp(0.08 + 0.95 * smoothstep(0.40, 1.00, t) + 0.20 * sin(t * 3.14159), 0.05, 1.20);
    let b = clamp(0.45 + 0.75 * sin(clamp(t * 2.2, 0.0, 3.14159)) - 0.55 * smoothstep(0.65, 1.0, t), 0.08, 1.15);
    return vec3<f32>(r, g, b);
}

// Diverging deep-cryo blue <-> neutral mist <-> amber-crimson heat (t in -1..+1).
pub fn thermal_div_rgb(anomNorm: f32) -> vec3<f32> {
    let a = clamp(anomNorm, -1.0, 1.0);
    if a < 0.0 {
        let u = clamp(-a, 0.0, 1.0);
        return mix(vec3<f32>(0.42, 0.56, 0.64), vec3<f32>(0.15, 0.68, 1.35), vec3<f32>(u, u, u));
    }
    let u = clamp(a, 0.0, 1.0);
    let mid = vec3<f32>(0.98, 0.72, 0.22);
    let hot = vec3<f32>(1.35, 0.24, 0.12);
    if u < 0.5 {
        let s = u * 2.0;
        return mix(vec3<f32>(0.48, 0.58, 0.60), mid, vec3<f32>(s, s, s));
    }
    let s = (u - 0.5) * 2.0;
    return mix(mid, hot, vec3<f32>(s, s, s));
}
`;

const RESOLVE_SRC = `
import sci::splat::*;

@kernel @grid(2)
fn k_clear(g: grid<2>,
           accR: rw_store<u32, 1>, accG: rw_store<u32, 1>,
           accB: rw_store<u32, 1>, accC: rw_store<u32, 1>,
           w: u32) {
    let pid = (g.y() as u32) * w + (g.x() as u32);
    accR[pid] = 0u;
    accG[pid] = 0u;
    accB[pid] = 0u;
    accC[pid] = 0u;
}

@kernel @grid(2)
fn k_resolve(g: grid<2>,
             accR: read_store<u32, 1>, accG: read_store<u32, 1>,
             accB: read_store<u32, 1>, accC: read_store<u32, 1>,
             out: write_store<vec4<f32>, 2>,
             w: u32, h: u32, exposure: f32, bloomAmt: f32, bgShift: f32) {
    let ix = g.x() as i32;
    let iy = g.y() as i32;
    let pid = (iy as u32) * w + (ix as u32);
    let invS = 1.0 / SPLAT_SCALE;

    let rawR = (accR[pid] as f32) * invS;
    let rawG = (accG[pid] as f32) * invS;
    let rawB = (accB[pid] as f32) * invS;

    // 4-tap neighbor halo for crisp HDR star/node bloom without multi-pass overhead
    var bR: f32 = 0.0;
    var bG: f32 = 0.0;
    var bB: f32 = 0.0;
    if ix > 1 && iy > 1 && ix < (w as i32) - 2 && iy < (h as i32) - 2 {
        let wi = w as i32;
        let pL = ((iy) * wi + (ix - 2)) as u32;
        let pR = ((iy) * wi + (ix + 2)) as u32;
        let pU = ((iy - 2) * wi + (ix)) as u32;
        let pD = ((iy + 2) * wi + (ix)) as u32;
        bR = ((accR[pL] + accR[pR] + accR[pU] + accR[pD]) as f32) * (0.25 * invS);
        bG = ((accG[pL] + accG[pR] + accG[pU] + accG[pD]) as f32) * (0.25 * invS);
        bB = ((accB[pL] + accB[pR] + accB[pU] + accB[pD]) as f32) * (0.25 * invS);
    }

    let cR = log(1.0 + rawR * exposure) + bloomAmt * log(1.0 + bR * exposure * 0.55);
    let cG = log(1.0 + rawG * exposure) + bloomAmt * log(1.0 + bG * exposure * 0.55);
    let cB = log(1.0 + rawB * exposure) + bloomAmt * log(1.0 + bB * exposure * 0.55);

    // Subtle deep-space radial vignette background
    let nx = ((ix as f32) / max(w as f32, 1.0)) * 2.0 - 1.0;
    let ny = ((iy as f32) / max(h as f32, 1.0)) * 2.0 - 1.0;
    let vig = clamp(1.0 - 0.35 * (nx * nx + ny * ny), 0.25, 1.0);
    let bg = vec3<f32>(0.012 + bgShift * 0.008, 0.016, 0.028 + bgShift * 0.015) * vig;

    var lin = bg + vec3<f32>(cR, cG, cB);
    // ACES filmic tone map
    let num = lin * (lin * 2.51 + vec3<f32>(0.03, 0.03, 0.03));
    let den = lin * (lin * 2.43 + vec3<f32>(0.59, 0.59, 0.59)) + vec3<f32>(0.14, 0.14, 0.14);
    let mapped = clamp(num / den, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));
    out[g.x(), g.y()] = vec4<f32>(mapped.x, mapped.y, mapped.z, 1.0);
}
`;

let splatModuleRegistered = false;
export function ensureSplatModule() {
    if (splatModuleRegistered || !bro.kernel || !bro.kernel.available) return;
    bro.kernel.registerModule('sci::splat', SCI_SPLAT_MODULE_SRC);
    splatModuleRegistered = true;
}

export class HdrSplatEngine {
    constructor(canvas, manifoldSource, opts = {}) {
        this.canvas = canvas;
        this.w = 0;
        this.h = 0;
        this.gpuReady = !!(bro.kernel && bro.kernel.available && bro.kernel.gpu);
        this.ctxKernel = null;
        this.ctx2d = null;

        this.colBuffers = {};
        this.maskBuffer = null;
        this.hasMask = 0;
        this.rowCount = 0;

        this.exposure = opts.exposure ?? 1.4;
        this.bloomAmt = opts.bloomAmt ?? 0.32;
        this.bgShift = opts.bgShift ?? 0.0;
        this.radiusMode = opts.radiusMode ?? 1;
        this.resizeCount = 0;

        this.accR = null;
        this.accG = null;
        this.accB = null;
        this.accC = null;
        this.pixels = null;
        this.kClear = null;
        this.kResolve = null;
        this.kSplat = null;

        if (this.gpuReady) {
            try {
                this.ctxKernel = canvas.getContext('kernel');
                ensureSplatModule();
                const resMod = bro.kernel.compile(RESOLVE_SRC, { file: 'sci_resolve.bk' });
                this.kClear = resMod.kernel('k_clear');
                this.kResolve = resMod.kernel('k_resolve');

                const mMod = bro.kernel.compile(manifoldSource, { file: opts.shaderFile || 'manifolds.bk' });
                this.kSplat = mMod.kernel(opts.entry || 'k_splat');
            } catch (err) {
                console.warn('HdrSplatEngine GPU init fallback:', err && err.message ? err.message : err);
                this.gpuReady = false;
            }
        }
        if (!this.gpuReady || !this.ctxKernel) {
            this.ctx2d = canvas.getContext('2d');
        }
    }

    resizeIfNeeded() {
        const w = Math.max(16, Math.round(this.canvas.clientWidth || this.canvas.width || 800));
        const h = Math.max(16, Math.round(this.canvas.clientHeight || this.canvas.height || 600));
        if (w === this.w && h === this.h && (this.pixels || this.ctx2d)) return false;

        this.w = w;
        this.h = h;
        this.canvas.width = w;
        this.canvas.height = h;
        this.resizeCount++;
        if (!this.gpuReady) return true;

        this._destroyAccumBuffers();
        const pixBytes = w * h * 4;
        this.accR = bro.kernel.createBuffer(pixBytes, { residency: 'gpu' });
        this.accG = bro.kernel.createBuffer(pixBytes, { residency: 'gpu' });
        this.accB = bro.kernel.createBuffer(pixBytes, { residency: 'gpu' });
        this.accC = bro.kernel.createBuffer(pixBytes, { residency: 'gpu' });
        this.pixels = bro.kernel.createBuffer(w * h * 16, { residency: 'gpu' });
        return true;
    }

    _destroyAccumBuffers() {
        for (const k of ['accR', 'accG', 'accB', 'accC', 'pixels']) {
            if (this[k]) { try { this[k].destroy(); } catch (_) {} this[k] = null; }
        }
    }

    uploadColumns(tableOrSnap, colNames) {
        this.destroyColumns();
        this.rowCount = tableOrSnap ? (tableOrSnap.rowCount | 0) : 0;
        if (!this.gpuReady || !tableOrSnap || this.rowCount <= 0) return;
        for (const c of colNames) {
            this.colBuffers[c] = tableOrSnap.toKernelBuffer(c, { residency: 'gpu' });
        }
        // Reset mask to empty 1-word dummy buffer until filter updates
        if (!this.maskBuffer) {
            this.maskBuffer = bro.kernel.createBuffer(new Uint32Array([0xFFFFFFFF]), { residency: 'gpu' });
            this.hasMask = 0;
        }
    }

    uploadMask(u32BitsetOrNull) {
        if (!this.gpuReady) return;
        if (this.maskBuffer) { try { this.maskBuffer.destroy(); } catch (_) {} this.maskBuffer = null; }
        if (!u32BitsetOrNull || u32BitsetOrNull.length === 0) {
            this.maskBuffer = bro.kernel.createBuffer(new Uint32Array([0xFFFFFFFF]), { residency: 'gpu' });
            this.hasMask = 0;
        } else {
            this.maskBuffer = bro.kernel.createBuffer(u32BitsetOrNull, { residency: 'gpu' });
            this.hasMask = 1;
        }
    }

    destroyColumns() {
        for (const k of Object.keys(this.colBuffers)) {
            if (this.colBuffers[k]) { try { this.colBuffers[k].destroy(); } catch (_) {} }
        }
        this.colBuffers = {};
    }

    render(view, splatArgsFn, extraSplatFn = null) {
        this.resizeIfNeeded();
        if (!this.gpuReady || !this.ctxKernel || !this.kSplat || this.rowCount <= 0) {
            if (this.ctx2d) {
                this.ctx2d.fillStyle = '#070a12';
                this.ctx2d.fillRect(0, 0, this.w, this.h);
            }
            return;
        }
        const cam = view.gpuCamParams(this.w, this.h);
        this.kClear.dispatch([this.w, this.h], this.accR, this.accG, this.accB, this.accC, this.w);

        const stride = Math.min(this.rowCount, 1048576);
        const meta = {
            w: this.w,
            h: this.h,
            count: this.rowCount,
            stride,
            fromManifold: view.fromManifold | 0,
            toManifold: view.toManifold | 0,
            morph: view.smoothMorph,
            maskBuffer: this.maskBuffer,
            hasMask: this.hasMask,
            radiusMode: this.radiusMode | 0,
        };
        const userArgs = splatArgsFn(this.colBuffers, cam, meta);
        this.kSplat.dispatch(
            stride,
            this.accR, this.accG, this.accB, this.accC,
            ...userArgs
        );
        if (extraSplatFn) {
            extraSplatFn(this.accR, this.accG, this.accB, this.accC, cam, meta);
        }

        this.kResolve.dispatch(
            [this.w, this.h],
            this.accR, this.accG, this.accB, this.accC,
            this.pixels, this.w, this.h, this.exposure, this.bloomAmt, this.bgShift
        );
        this.ctxKernel.present(this.pixels, { format: 'rgba32f' });
    }

    dispose() {
        this.destroyColumns();
        if (this.maskBuffer) { try { this.maskBuffer.destroy(); } catch (_) {} this.maskBuffer = null; }
        this._destroyAccumBuffers();
    }
}
