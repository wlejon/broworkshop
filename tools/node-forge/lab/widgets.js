// Node Forge — widget registry.
//
// Two extension points, mirroring lab/ops-registry.js's def()/DEFS pattern
// one level up:
//
//   FIELD widgets — one row in the generic per-node config form. Keyed by
//   a param's `type` (int/float/bool/select today). Widgets.registerField
//   (type, {mount(container, node, field, ctx)}) — mount() appends its
//   control into `container` and calls ctx.commit(rawValue) on change,
//   exactly like inspector.js's old inline branches did.
//
//   PANEL widgets — a whole custom control block for an op that declares
//   `panel: 'name'` (+ optional `panelConfig`, static or a function of
//   (node,def)) in its def(). Widgets.registerPanel(name, {mount(node, def,
//   panelConfig, ctx) -> HTMLElement}) — for controls that don't map to one
//   scalar param (the multi-curve painter, the basis slider+map).
//
// ctx for a panel widget exposes two distinct commit paths:
//   onEdit()    — call on every live-edit tick (e.g. once per paint-drag
//                 frame). Triggers graph.invalidateFrom(this node) + a
//                 DEBOUNCED runner.continue() — only this node and its
//                 downstream re-run, so an upstream encode/load node isn't
//                 redundantly re-executed on every paint frame.
//   onCommit()  — call once a gesture settles (mouse up). Triggers the
//                 same full propagate()+clearRun() path a param-form edit
//                 already takes, keeping the "settled" behavior identical
//                 to editing a plain field.
import { Dialogs } from "/lib/dialogs.js";

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  const FIELD_WIDGETS = {};
  const PANEL_WIDGETS = {};

  function mountSelect(container, node, f, ctx) {
    const input = el('select', 'form-input');
    for (const o of f.options) {
      const opt = el('option', null, o);
      opt.value = o;
      input.appendChild(opt);
    }
    input.value = node.params[f.key];
    input.addEventListener('change', () => ctx.commit(input.value));
    container.appendChild(input);
  }

  function mountBool(container, node, f, ctx) {
    const input = el('input', 'form-check');
    input.type = 'checkbox';
    input.checked = !!node.params[f.key];
    input.addEventListener('change', () => ctx.commit(input.checked));
    container.appendChild(input);
  }

  function mountNumber(container, node, f, ctx) {
    const input = el('input', 'form-input');
    input.type = 'number';
    input.value = node.params[f.key];
    if (f.step != null) input.step = f.step;
    input.addEventListener('change', () => ctx.commit(input.value));
    container.appendChild(input);
  }

  // free-text string param (model directory / file path, ...) — added
  // alongside the audio domain nodes, which are the first ops needing a
  // string-valued param rather than a scalar/enum. A field declaring
  // `browse: 'folder'` or `browse: 'file'` (+ optional `browseFilter`) gets
  // a native-dialog button beside the text input — absent in headless/
  // GPU-less builds, where Dialogs.browseFolder/browseFile just return null
  // and the button quietly no-ops.
  function mountText(container, node, f, ctx) {
    const input = el('input', 'form-input wide');
    input.type = 'text';
    input.value = node.params[f.key] || '';
    input.addEventListener('change', () => ctx.commit(input.value));
    container.appendChild(input);
    if (f.browse === 'folder' || f.browse === 'file') {
      const btn = el('button', 'tinybtn', '…');
      btn.title = 'Browse…';
      btn.addEventListener('click', () => {
        const picked = f.browse === 'folder'
          ? Dialogs.browseFolder(input.value)
          : Dialogs.browseFile(f.browseFilter || '');
        if (picked) { input.value = picked; ctx.commit(picked); }
      });
      container.appendChild(btn);
    }
  }

  // registered up front so the four existing field kinds behave exactly as
  // inspector.js's old inline switch did — this is a pure refactor, not a
  // behavior change. '__default__' covers any param `type` not otherwise
  // registered (matches the old switch's implicit numeric-input fallback).
  FIELD_WIDGETS.select = { mount: mountSelect };
  FIELD_WIDGETS.bool = { mount: mountBool };
  FIELD_WIDGETS.int = { mount: mountNumber };
  FIELD_WIDGETS.float = { mount: mountNumber };
  FIELD_WIDGETS.text = { mount: mountText };
  FIELD_WIDGETS.__default__ = { mount: mountNumber };

  export const Widgets = {
    registerField(type, widget) { FIELD_WIDGETS[type] = widget; },
    getField(type) { return FIELD_WIDGETS[type] || FIELD_WIDGETS.__default__; },
    registerPanel(name, widget) { PANEL_WIDGETS[name] = widget; },
    getPanel(name) { return PANEL_WIDGETS[name] || null; },
  };
