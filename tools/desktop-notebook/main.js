// Desktop Notebook — Markdown notes with a live preview, on the native menu
// bar and window controls.
//
// lib/store.js    notes (localStorage) + settings (prefStore)
// lib/samples.js  the notes a fresh notebook starts with
// lib/editor.js   textarea editor: gutter, history, formatting, preview
// lib/find.js     find & replace bar
// lib/sidebar.js  note list: search, pin, delete
// lib/view.js     view mode, splitter, zoom, theme, window controls
// lib/files.js    open / save as Markdown / export HTML
// lib/app.js      wiring: commands (menu + keys), ribbon, autosave, status
import { start } from "/app/lib/app.js";

start();
