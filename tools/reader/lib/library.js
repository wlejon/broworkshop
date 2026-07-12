// ═══ library view: document cards, import, resume, delete ════════════════════
import { $ } from "/app/lib/state.js";
import { library, importFile, deleteDocument, saveLibrary } from "/app/lib/docs.js";
import { openDocument, showLibraryView } from "/app/lib/reader.js";

export function initLibrary() {
  showLibraryView._render = renderLibrary;   // reader's back button re-renders us
  $('#btn-import').addEventListener('click', importViaDialog);
}

// Native open dialog — feature-tested; absent/never triggered in headless tests.
function importViaDialog() {
  if (typeof showOpenFileDialog !== 'function') { setLibHint('file dialog unavailable in this build', true); return; }
  const files = showOpenFileDialog('Documents|txt;md;markdown;html;htm;xhtml', true);
  if (!files || !files.length) return;
  importPaths(files);
}

export function importPaths(paths) {
  let last = null, errs = [];
  for (const p of paths) {
    try { last = importFile(p.replace(/\\/g, '/')); }
    catch (e) { errs.push(p.split(/[\\\/]/).pop() + ': ' + e.message); }
  }
  renderLibrary();
  setLibHint(errs.length ? errs.join(' · ') : '', errs.length > 0);
  return last;
}

function setLibHint(text, err) {
  const h = $('#lib-hint');
  h.textContent = text || '';
  h.classList.toggle('err', !!err);
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function renderLibrary() {
  const grid = $('#doc-grid');
  grid.textContent = '';
  $('#lib-empty').style.display = library.length ? 'none' : 'block';
  for (const doc of library) {
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = doc.title;
    card.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const pct = doc.sentenceCount ? Math.round((doc.pos / doc.sentenceCount) * 100) : 0;
    meta.textContent = fmtDate(doc.addedAt) + ' · ' + doc.sentenceCount + ' sentences'
      + (doc.engine ? ' · ' + doc.engine : '') + (doc.voice || doc.speaker ? ' · ' + (doc.voice || doc.speaker) : '');
    card.appendChild(meta);

    const bar = document.createElement('div');
    bar.className = 'card-bar';
    const fill = document.createElement('div');
    fill.className = 'card-fill';
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    card.appendChild(bar);

    const row = document.createElement('div');
    row.className = 'card-row';
    const open = document.createElement('button');
    open.className = 'primary';
    open.textContent = doc.pos > 0 ? '▶ Continue · ' + pct + '%' : '▶ Read';
    open.addEventListener('click', () => openDocument(doc));
    row.appendChild(open);
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '✕';
    del.title = 'Remove from library (click twice)';
    del.addEventListener('click', () => {
      if (del.dataset.armed) { deleteDocument(doc.id); renderLibrary(); }
      else { del.dataset.armed = '1'; del.textContent = 'remove?'; setTimeout(() => { delete del.dataset.armed; del.textContent = '✕'; }, 1800); }
    });
    row.appendChild(del);
    card.appendChild(row);

    grid.appendChild(card);
  }
}
