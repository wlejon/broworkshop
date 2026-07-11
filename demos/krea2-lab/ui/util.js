// Small shared helpers + the latent geometry constants.

export function $(id) { return document.getElementById(id); }

// Latent geometry constants (see krea2-worker.js's header + brodiffusion's
// Pipeline::vae_scale_factor() / Krea2Denoiser's patch_size==2 requirement).
// H_lat = height / VAE_SCALE is what PipelineState.latentHeight/latentWidth
// report (the resolution spatialRender's maskData must match). The DiT's
// token grid — and krea2Gates()'s image-row count — is patchified one more
// level down: img_len == (H_lat/PATCH) * (W_lat/PATCH).
export const VAE_SCALE = 8;
export const PATCH = 2;

// Minted axes persist as their actual unit direction (6144 float32, base64 —
// ~32KB per axis). Restoring is then a cheap registerAxis instead of a full
// re-mint, and axes minted from history renders survive restarts too.
export function f32ToB64(f) {
  const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 8192) {
    s += String.fromCharCode.apply(null, u.subarray(i, Math.min(i + 8192, u.length)));
  }
  return btoa(s);
}
export function b64ToF32(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Float32Array(u.buffer);
}
