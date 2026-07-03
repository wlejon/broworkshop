// dialogs.js — native folder/file pickers, defensively gated (absent in
// headless / GPU-less builds). Was duplicated byte-for-byte between
// qwen-tts-lab and supertonic-lab; shared here for node-forge's path-typed
// params (model dirs, voice files, basis JSON, ...).

  export function browseFolder(start) {
    if (typeof showOpenFolderDialog !== 'function') return null;
    const r = showOpenFolderDialog(start || null);
    return r && r.length ? r[0] : null;
  }

  export function browseFile(filter) {
    if (typeof showOpenFileDialog !== 'function') return null;
    const r = showOpenFileDialog(filter || '');
    return r && r.length ? r[0] : null;
  }

  export const Dialogs = { browseFolder: browseFolder, browseFile: browseFile };
