// Checkpoint discovery and loading. No simulator: if the model cannot load,
// the app says why and stays inert.

const fs = (typeof require === 'function') ? require('fs') : null;
const pathMod = (typeof require === 'function') ? require('path') : null;

const KEY = 'laya-triage.modelDir';

export let model = null;       // the loaded bro.lm LayaModel
export let modelDir = '';

function recall() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
function remember(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

export function isCheckpoint(dir) {
  try { return !!fs && !!dir && fs.existsSync(dir + '/model.safetensors') &&
               fs.existsSync(dir + '/rl_agent_config.json'); } catch (e) { return false; }
}

// The directory to pre-fill: the last one that loaded, LAYA_MODEL_DIR, or a
// `laya/` checkout beside any ancestor of this app (the usual sibling layout).
export function defaultModelDir() {
  const env = (typeof process !== 'undefined' && process.env) ? process.env : {};
  const cands = [recall(), env.LAYA_MODEL_DIR || ''];
  if (pathMod && typeof bro !== 'undefined' && bro.appDir) {
    let d = bro.appDir.replace(/\\/g, '/').replace(/\/+$/, '');
    for (let i = 0; i < 8 && d; i++) {
      cands.push(d + '/laya');
      const up = pathMod.dirname(d).replace(/\\/g, '/');
      if (up === d) break;
      d = up;
    }
  }
  for (const c of cands) if (isCheckpoint(c)) return c;
  return '';
}

export function browseFolder(start) {
  if (typeof showOpenFolderDialog !== 'function') return null;   // absent in headless
  const r = showOpenFolderDialog(start || null);
  return r && r.length ? r[0] : null;
}

// Why the model cannot be used in this build, or '' when it can.
export function unavailableReason() {
  if (typeof bro === 'undefined' || !bro.lm || bro.lm.available === false) {
    return 'bro.lm is not compiled into this build (needs the AI tower: -DBRO_PROFILE=full).';
  }
  if (typeof bro.lm.loadLayaAsync !== 'function') return 'this bro build has no bro.lm.loadLayaAsync; rebuild bro.';
  return '';
}

// Load (async, one replica per GPU). Resolves to the model; rejects with a
// plain-language Error.
export function loadModel(dir) {
  dir = (dir || '').trim().replace(/[\\/]+$/, '');
  const why = unavailableReason();
  if (why) return Promise.reject(new Error(why));
  if (!dir) return Promise.reject(new Error('No checkpoint directory. Point this at a Laya checkout (the folder holding model.safetensors).'));
  if (!isCheckpoint(dir)) return Promise.reject(new Error('No Laya checkpoint in ' + dir + ' (expected model.safetensors and rl_agent_config.json).'));
  if (model) { try { model.dispose(); } catch (e) {} model = null; }
  return bro.lm.loadLayaAsync(dir, { devices: 'all' }).then((m) => {
    model = m;
    modelDir = dir;
    remember(dir);
    return m;
  });
}
