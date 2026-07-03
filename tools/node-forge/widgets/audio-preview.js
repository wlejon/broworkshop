// Node Forge — shared audio-preview sink panel widget.
//
// A generic "here's a PCM buffer, draw its waveform and let me play it"
// panel, backed by lib/clip-audio.js. Used by every audio domain's
// terminal sink node (RAVE's, Kokoro's, ...) instead of each domain
// duplicating waveform-draw + AudioContext-clip-publish chrome.
//
// panelConfig contract:
//   getBuffer(node) -> { samples: Float32Array, sampleRate, channels } | null
//                       null (or a buffer with no samples) before the graph
//                       has been run.
//
// No live-edit interaction here — this widget never calls ctx.onEdit() or
// ctx.onCommit(). It republishes the AudioContext clip only when the
// underlying Float32Array reference actually changes (cached on the node),
// not on every inspector re-render, since panels remount from scratch on
// every render()/refresh() call.
import { Widgets } from "/app/lab/widgets.js";
import { ClipAudio } from "/lib/clip-audio.js";

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function mount(node, def, cfg, ctx) {
    const root = el('div', 'audio-preview-panel');
    const cv = document.createElement('canvas');
    cv.width = 1100; cv.height = 96; cv.className = 'curve-canvas';
    root.appendChild(cv);

    const controls = el('div', 'audio-preview-controls');
    const playBtn = el('button', 'tinybtn', '▶ Play');
    const info = el('span', 'curve-stats');
    controls.appendChild(playBtn);
    controls.appendChild(info);
    root.appendChild(controls);

    const buf = cfg.getBuffer(node);
    if (!buf || !buf.samples || !buf.samples.length) {
      info.textContent = 'no audio yet — run the graph';
      playBtn.disabled = true;
      return root;
    }

    const channels = buf.channels || 1;
    ClipAudio.drawWaveform(cv, buf.samples, channels, '#ffcf6b');
    const secs = (buf.samples.length / channels / buf.sampleRate).toFixed(2);
    info.textContent = secs + 's · ' + buf.sampleRate + 'Hz' + (channels > 1 ? ' × ' + channels : '');

    if (node._previewBuf !== buf.samples) {
      node._previewClipId = ClipAudio.publishClip(
        node._previewClipId != null ? node._previewClipId : -1, buf.samples, channels, buf.sampleRate);
      node._previewBuf = buf.samples;
    }
    playBtn.addEventListener('click', () => ClipAudio.playClipId(node._previewClipId));
    return root;
  }

  Widgets.registerPanel('audio-preview', { mount: mount });
