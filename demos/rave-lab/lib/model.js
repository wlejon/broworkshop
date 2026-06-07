// ═══ model load + dialogs ════════════════════════════════════════════════════

function setBadge(text, err) {
  const b = $('#backend');
  b.textContent = text;
  b.classList.toggle('err', !!err);
}

const _fs = (typeof require === 'function') ? require('fs') : null;
function fileExists(p) { try { return !!_fs && _fs.existsSync(p); } catch (e) { return false; } }

// Probe the usual spots for a converted RAVE model so the field is pre-filled.
function defaultModelDir(current) {
  const cands = [
    current,
    'D:/projects/brosoundml-data/rave/magnets_z8',
    '/tmp/rave/out_z8',
    'D:/tmp/rave/out_z8',
    './model',
  ].filter(Boolean);
  for (const d of cands) if (fileExists(d + '/config.json')) return d;
  return cands.find(Boolean) || '';
}

// Native dialogs, defensively gated (absent in headless / GPU-less builds).
function browseFolder(start) {
  if (typeof showOpenFolderDialog !== 'function') { setBadge('folder dialog unavailable in this build', true); return null; }
  const r = showOpenFolderDialog(start || null);
  return r && r.length ? r[0] : null;
}
function browseFile(filter) {
  if (typeof showOpenFileDialog !== 'function') { setBadge('file dialog unavailable in this build', true); return null; }
  const r = showOpenFileDialog(filter || '');
  return r && r.length ? r[0] : null;
}

function loadModel(dir) {
  dir = (dir || '').trim();
  if (!dir) { setBadge('pick a model directory', true); return; }
  rave = null;
  $('#model-meta').textContent = '';
  $('#btn-play-src').disabled = true;
  $('#btn-play-out').disabled = true;
  $('#btn-decode').disabled = true;
  $('#btn-reset').disabled = true;
  setBadge('loading model…');
  try {
    bro.rave.loadRave(dir, {
      device: 'cuda',
      onReady: (r) => {
        rave = r;
        $('#model-meta').textContent =
          `sr ${r.sampleRate} · ${r.nLatent} latents (of ${r.fullLatent}) · ` +
          `${r.nBand} bands · ${r.totalRatio} samp/frame`;
        setBadge('ready · make a tone or load a file');
        $('#hint').textContent = 'Make a tone or open a file to encode it into editable latent curves.';
      },
      onError: (m) => setBadge('model error: ' + m, true),
    });
  } catch (e) {
    setBadge('load failed: ' + e.message, true);
  }
}
