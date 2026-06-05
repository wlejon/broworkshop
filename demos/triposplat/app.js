// TripoSplat showcase — single image -> 3D Gaussian Splat, rendered live.
//
// The whole pipeline runs on-device through bro.triposplat (DINOv3 + Flux.2 VAE
// encoders -> flow-matching DiT -> octree Gaussian decoder). This app is pure
// composition: load the four checkpoints, encode the sample image, and hand the
// returned splat cloud to the scene's GaussianSplatNode (EWA splatting).
//
// Weights live in the sibling repos' download dirs (scripts/download-triposplat.sh
// in brodiffusion + brovisionml). Edit WEIGHTS if yours are elsewhere.

const WEIGHTS = {
  dinov3:  "D:/projects/brovisionml/weights/triposplat/clip_vision/dino_v3_vit_h.safetensors",
  vae:     "D:/projects/brodiffusion/weights/triposplat/vae/flux2-vae.safetensors",
  flow:    "D:/projects/brodiffusion/weights/triposplat/diffusion_models/triposplat_fp16.safetensors",
  decoder: "D:/projects/brodiffusion/weights/triposplat/vae/triposplat_vae_decoder_fp16.safetensors",
};

const $ = (id) => document.getElementById(id);
const status = (s) => { $("status").textContent = s; };

const canvas = $("view");
const scene = canvas.getContext("scene");
let splatNode = null;

// ── orbit camera ────────────────────────────────────────────────────────────
let az = 0.6, el = 0.3, radius = 2.2;
const target = [0, 0, 0];
function applyCamera() {
  const cx = target[0] + radius * Math.cos(el) * Math.sin(az);
  const cy = target[1] + radius * Math.sin(el);
  const cz = target[2] + radius * Math.cos(el) * Math.cos(az);
  scene.setCamera({ position: [cx, cy, cz], target, fov: 45 });
}
applyCamera();

let dragging = false, lx = 0, ly = 0;
canvas.addEventListener("mousedown", (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
window.addEventListener("mouseup", () => { dragging = false; });
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  az -= (e.clientX - lx) * 0.01;
  el = Math.max(-1.4, Math.min(1.4, el + (e.clientY - ly) * 0.01));
  lx = e.clientX; ly = e.clientY;
  applyCamera();
});
canvas.addEventListener("wheel", (e) => {
  radius = Math.max(0.6, Math.min(6, radius * (1 + Math.sign(e.deltaY) * 0.08)));
  applyCamera();
  e.preventDefault();
});

// ── controls ──────────────────────────────────────────────────────────────────
$("steps").oninput = () => $("vSteps").textContent = $("steps").value;
$("cfg").oninput   = () => $("vCfg").textContent = ($("cfg").value / 10).toFixed(1);
$("ng").oninput    = () => $("vNg").textContent = $("ng").value;

// ── load the sample image + models ──────────────────────────────────────────
let pipeline = null;
let sampleImage = null;   // ImageData-shaped { data, width, height } for generate()

// Decode an image file to ImageData via the Image element (broimage-backed) +
// an offscreen 2D canvas. generate() accepts the { data, width, height } shape
// directly, so no ImageBitmap is needed.
function loadImageData(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const c2 = cv.getContext("2d");
      c2.drawImage(img, 0, 0);
      resolve(c2.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = () => reject(new Error("image load failed: " + url));
    img.src = url;
  });
}

async function boot() {
  sampleImage = await loadImageData("sample.png");
  $("thumb").style.backgroundImage = "url(sample.png)";

  status("Loading models (DINOv3 + VAE + flow + decoder)…");
  await new Promise((r) => setTimeout(r, 30));   // let the status paint
  try {
    pipeline = bro.triposplat.load(WEIGHTS);
    status(`Models ready on ${pipeline.device}. Click Generate.`);
    $("go").disabled = false;
  } catch (e) {
    status("Load failed: " + e.message);
  }
}

$("go").disabled = true;
$("go").onclick = async () => {
  if (!pipeline) return;
  $("go").disabled = true;
  const opts = {
    seed: 42,
    steps: parseInt($("steps").value, 10),
    guidanceScale: parseFloat($("cfg").value) / 10,
    numGaussians: parseInt($("ng").value, 10),
  };
  status(`Generating ${opts.numGaussians.toLocaleString()} Gaussians (${opts.steps} steps)…`);
  await new Promise((r) => setTimeout(r, 30));
  const t0 = performance.now();
  try {
    const cloud = pipeline.generate(sampleImage, opts);
    if (splatNode) splatNode.remove();
    splatNode = scene.createGaussianSplat({ name: "splat", cloud, scale: 1.0 });
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    status(`${cloud.count.toLocaleString()} Gaussians in ${dt}s.`);
  } catch (e) {
    status("Generate failed: " + e.message);
  }
  $("go").disabled = false;
};

boot();
