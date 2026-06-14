// Model profiles — the adapter seam between a directory of weights on disk
// and a pipeline the worker can build.
//
// A profile knows how to (1) recognise a model directory, (2) locate its
// component files, and (3) emit a build spec + capability descriptor. Today
// there is one profile (Stable Diffusion 1.5 in diffusers layout); another
// model family is a new entry in PROFILES, not a rewrite of the app.
  var fs = require('fs');
  var path = require('path');

  function exists(p) {
    try { return fs.existsSync(p); } catch (e) { return false; }
  }

  // First existing candidate under `dir`, or null.
  function pickFile(dir, names) {
    for (var i = 0; i < names.length; i++) {
      var p = path.join(dir, names[i]);
      if (exists(p)) return p;
    }
    return null;
  }

  // ── Stable Diffusion 1.5 (diffusers component layout) ──────────────────
  //
  //   <model>/text_encoder/model[.fp16].safetensors
  //   <model>/unet/diffusion_pytorch_model[.fp16].safetensors
  //   <model>/vae/diffusion_pytorch_model[.fp16].safetensors
  //   <model>/tokenizer/{vocab.json, merges.txt}
  var SD15 = {
    id: 'sd15',
    label: 'Stable Diffusion 1.5',

    // Quick structural test — does this directory look like the profile?
    matches: function (dir) {
      return exists(path.join(dir, 'unet')) &&
             exists(path.join(dir, 'vae')) &&
             exists(path.join(dir, 'tokenizer'));
    },

    // Resolve every component path. Throws with a clear message on a
    // missing piece so the UI can tell the user exactly what's wrong.
    resolve: function (dir) {
      var tokDir = path.join(dir, 'tokenizer');
      var vocab = path.join(tokDir, 'vocab.json');
      var merges = path.join(tokDir, 'merges.txt');
      if (!exists(vocab) || !exists(merges)) {
        throw new Error('tokenizer/ must contain vocab.json and merges.txt');
      }
      var text = pickFile(path.join(dir, 'text_encoder'),
        ['model.fp16.safetensors', 'model.safetensors']);
      var unet = pickFile(path.join(dir, 'unet'),
        ['diffusion_pytorch_model.fp16.safetensors',
         'diffusion_pytorch_model.safetensors']);
      var vae = pickFile(path.join(dir, 'vae'),
        ['diffusion_pytorch_model.fp16.safetensors',
         'diffusion_pytorch_model.safetensors']);
      if (!text) throw new Error('text_encoder/ has no model.safetensors');
      if (!unet) throw new Error('unet/ has no diffusion_pytorch_model.safetensors');
      if (!vae)  throw new Error('vae/ has no diffusion_pytorch_model.safetensors');

      // Distilled LCM checkpoints are named with an "lcm" hint; this only
      // seeds the sampler dropdown — the user confirms before loading.
      var leaf = path.basename(dir).toLowerCase();
      var suggestedScheduler = leaf.indexOf('lcm') >= 0 ? 'lcm' : 'ddim';

      return {
        profileId: 'sd15',
        name: path.basename(dir),
        dir: dir,
        vocabPath: vocab,
        mergesPath: merges,
        weights: { text: text, unet: unet, vae: vae },
        suggestedScheduler: suggestedScheduler,
        caps: {
          crossAttention: true,      // SD1.5 U-Net has Transformer2D blocks
          negativePrompt: true,
          controlNets:    true,      // residuals sum across N registered nets
          img2img:        true,
          inpaint:        true,
        },
      };
    },

    // Build the worker-side spec. `scheduler` is 'ddim' or 'lcm'; `quantize`
    // requests INT8 U-Net weights (GPU only — ignored on the CPU backend).
    //
    // The sampler and the U-Net architecture are independent. The LCM
    // scheduler is valid on a vanilla SD1.5 checkpoint — that is exactly the
    // LCM-LoRA workflow (a consistency LoRA over a vanilla U-Net). So
    // `lcmDistilled` (which would add the cond_proj guidance path) must NOT be
    // inferred from the scheduler. It is a property of the checkpoint:
    // brodiffusion's load_weights() auto-detects time_embedding.cond_proj.weight
    // and configures the U-Net accordingly, so we leave it false here and let
    // the checkpoint decide.
    buildSpec: function (resolved, scheduler, quantize) {
      var sched = scheduler === 'lcm' ? 'lcm' : 'ddim';
      return {
        kind: 'createPipeline',
        pipeline: {
          vocabPath: resolved.vocabPath,
          mergesPath: resolved.mergesPath,
          scheduler: sched,
          lcmDistilled: false,
          quantizeWeights: !!quantize,
        },
        weights: resolved.weights,
      };
    },
  };

  var PROFILES = [SD15];

  // Detect which profile claims a directory and resolve it.
  function detect(dir) {
    for (var i = 0; i < PROFILES.length; i++) {
      if (PROFILES[i].matches(dir)) {
        var resolved = PROFILES[i].resolve(dir);
        resolved.profile = PROFILES[i];
        return resolved;
      }
    }
    throw new Error('not a recognised model directory ' +
      '(expected diffusers layout: unet/, vae/, tokenizer/)');
  }

  export const Profiles = {
    detect: detect,
    readText: function (p) { return fs.readFileSync(p, 'utf-8'); },
  };
