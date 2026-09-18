// Setup screen & model selection panel for Voice Pipeline.

import * as VoiceModels from "/app/models.js";

function humanBytes(n) {
    if (!n || n <= 0) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
}

const esc = (s) => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function rowsOf(items, per, lineClass) {
    let html = '';
    for (let i = 0; i < items.length; i += per)
        html += '<div class="' + lineClass + '">' + items.slice(i, i + per).join('') + '</div>';
    return html;
}

export function initSetupScreen({ $setup, $convo, $status, setStatus, onStart }) {
    const sel = {
        backend: 'qwen',     // 'text' | 'kokoro' | 'qwen' | 'voicedesign'
        speaker: 'serena',
        language: 'english',
        description: VoiceModels.QWEN_VD_EXAMPLES[0],
        wake: true,
    };

    function backendKey(b) {
        return b === 'kokoro'      ? 'tts'
             : b === 'qwen'        ? 'ttsq'
             : b === 'voicedesign' ? 'ttsvd'
             : null;
    }

    function groupReady(key) {
        const s = VoiceModels.groupStatus(key);
        return !!(s && s.present);
    }

    function backendAvailable(b) {
        if (b === 'text') return true;
        const s = VoiceModels.groupStatus(backendKey(b));
        return !!(s && (s.present || s.downloadable));
    }

    function requiredKeys() {
        const keys = ['llm', 'stt'];
        if (sel.wake) keys.push('wake');
        const bk = backendKey(sel.backend);
        if (bk) keys.push(bk);
        return keys;
    }

    function showSetup() {
        sel.backend = backendAvailable('qwen') && groupReady('ttsq') ? 'qwen'
                    : backendAvailable('voicedesign') && groupReady('ttsvd') ? 'voicedesign'
                    : groupReady('tts') ? 'kokoro'
                    : backendAvailable('qwen') ? 'qwen' : 'text';

        const tag = (key) => {
            const s = VoiceModels.groupStatus(key);
            if (!s) return '';
            if (s.present) return '<span class="tag ready">ready</span>';
            if (s.downloadable) return '<span class="tag dl">download ' + humanBytes(s.bytes) + '</span>';
            return '<span class="tag need">needs weights</span>';
        };

        const card = (b, title, sub, key) => {
            const avail = backendAvailable(b);
            const t = key ? tag(key) : '<span class="tag none">no model</span>';
            return '<div class="voice-card' + (avail ? '' : ' disabled') + '" data-backend="' + b + '">' +
                   '<span class="vc-title">' + title + '</span>' +
                   '<span class="vc-sub">' + sub + '</span>' + t + '</div>';
        };

        $setup.innerHTML =
            '<p class="intro">Pick a voice for the assistant, then start. Only what you ' +
            'choose is loaded — speech recognition (Whisper) and the language model ' +
            '(Qwen3-8B) load alongside it.</p>' +

            '<div class="section-label">Voice</div>' +
            '<div class="voice-cards">' + rowsOf([
                card('text',        'Text only',  'No speech — replies appear as text', null),
                card('kokoro',      'Kokoro',     'Fast 82M, one warm voice', 'tts'),
                card('qwen',        'Qwen3-TTS · CustomVoice', '9 preset speakers, 10 languages', 'ttsq'),
                card('voicedesign', 'Qwen3-TTS · VoiceDesign', 'Describe any voice in words', 'ttsvd'),
            ], 2, 'card-line') + '</div>' +

            '<div id="voiceOpts" class="voice-opts"></div>' +

            '<div class="section-label">Pipeline</div>' +
            '<div class="core-rows">' +
                '<label class="wake-toggle"><input type="checkbox" id="wakeChk"' +
                    (sel.wake ? ' checked' : '') + '> Wake word — say &ldquo;computer&rdquo; ' +
                    'to talk hands-free ' + tag('wake') + '</label>' +
                '<div class="core-row"><span>Speech recognition · Whisper</span>' + tag('stt') + '</div>' +
                '<div class="core-row"><span>Language model · Qwen3-8B</span>' + tag('llm') + '</div>' +
            '</div>' +

            '<div class="start-bar">' +
                '<button id="startBtn" class="start">Start</button>' +
                '<div class="start-prog" id="startProg" hidden><div class="start-bar-fill" id="startFill"></div></div>' +
                '<div class="start-note" id="startNote"></div>' +
            '</div>';

        $setup.hidden = false;
        $convo.hidden = true;
        setStatus('idle', 'choose a voice');
        renderVoiceOpts();
        wireSetup();
        refreshStart();
    }

    function renderVoiceOpts() {
        const el = document.getElementById('voiceOpts');
        if (!el) return;
        const langChips = () => {
            const chips = VoiceModels.QWEN_LANGUAGES.map(l =>
                '<div class="lang" data-lang="' + l + '"' +
                (l === sel.language ? ' aria-selected="true"' : '') + '>' +
                l.charAt(0).toUpperCase() + l.slice(1) + '</div>');
            return '<div class="opt-label">Language</div>' +
                   '<div class="lang-grid">' + rowsOf(chips, 5, 'lang-line') + '</div>';
        };

        if (sel.backend === 'qwen') {
            const chips = VoiceModels.QWEN_SPEAKERS.map(s =>
                '<div class="spk" data-speaker="' + s.id + '"' +
                (s.id === sel.speaker ? ' aria-selected="true"' : '') + '>' +
                '<span class="spk-name">' + esc(s.name) + '</span>' +
                '<span class="spk-note">' + esc(s.note) +
                (s.dialect ? ' · ' + esc(s.dialect) : '') + '</span></div>');
            el.innerHTML = '<div class="opt-label">Speaker</div>' +
                '<div class="spk-grid">' + rowsOf(chips, 3, 'spk-line') + '</div>' + langChips();
        } else if (sel.backend === 'voicedesign') {
            const examples = VoiceModels.QWEN_VD_EXAMPLES.map(x =>
                '<div class="ex" data-ex="' + esc(x) + '">' + esc(x) + '</div>').join('');
            el.innerHTML =
                '<div class="opt-label">Describe the voice</div>' +
                '<input type="text" id="vdDesc" class="vd-desc" value="' + esc(sel.description) + '" ' +
                'placeholder="e.g. a warm, low-pitched elderly storyteller">' +
                '<div class="opt-sub">Or start from an example:</div>' +
                '<div class="ex-list">' + examples + '</div>' + langChips();
        } else if (sel.backend === 'kokoro') {
            el.innerHTML = '<p class="opt-note">Kokoro speaks with a single warm English voice ' +
                '(af_heart). No options to pick — fast and lightweight.</p>';
        } else {
            el.innerHTML = '<p class="opt-note">Replies are shown as text only. You can still ' +
                'talk to the assistant; it just won\'t speak back.</p>';
        }
        wireVoiceOpts();
    }

    function wireSetup() {
        $setup.querySelectorAll('.voice-card').forEach(c => {
            c.addEventListener('click', () => {
                if (c.classList.contains('disabled')) return;
                sel.backend = c.dataset.backend;
                $setup.querySelectorAll('.voice-card').forEach(x =>
                    x.classList.toggle('on', x === c));
                renderVoiceOpts();
                refreshStart();
            });
            c.classList.toggle('on', c.dataset.backend === sel.backend);
        });
        const wk = document.getElementById('wakeChk');
        if (wk) wk.addEventListener('change', () => { sel.wake = wk.checked; refreshStart(); });
        document.getElementById('startBtn').addEventListener('click', startSelected);
    }

    function wireVoiceOpts() {
        const el = document.getElementById('voiceOpts');
        if (!el) return;
        el.querySelectorAll('.spk').forEach(b => b.addEventListener('click', () => {
            sel.speaker = b.dataset.speaker;
            el.querySelectorAll('.spk').forEach(x =>
                x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
        }));
        el.querySelectorAll('.ex').forEach(b => b.addEventListener('click', () => {
            sel.description = b.dataset.ex;
            const ta = document.getElementById('vdDesc');
            if (ta) ta.value = sel.description;
        }));
        const ta = document.getElementById('vdDesc');
        if (ta) ta.addEventListener('input', () => { sel.description = ta.value; });
        el.querySelectorAll('.lang').forEach(b => b.addEventListener('click', () => {
            sel.language = b.dataset.lang;
            el.querySelectorAll('.lang').forEach(x =>
                x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
        }));
    }

    function refreshStart() {
        const btn = document.getElementById('startBtn');
        const note = document.getElementById('startNote');
        if (!btn) return;
        let dlBytes = 0, blocked = null;
        for (const k of requiredKeys()) {
            const s = VoiceModels.groupStatus(k);
            if (!s || s.present) continue;
            if (s.downloadable) dlBytes += s.bytes || 0;
            else blocked = s.label;
        }
        if (blocked) {
            btn.disabled = true;
            btn.textContent = 'Start';
            note.textContent = blocked + ' isn\'t on disk and isn\'t auto-downloaded — fetch it ' +
                'with brosoundml\'s download-qwen-tts.sh, or pick another voice.';
        } else {
            btn.disabled = false;
            btn.textContent = dlBytes > 0 ? 'Download & start · ' + humanBytes(dlBytes) : 'Start';
            note.textContent = dlBytes > 0
                ? 'First run downloads ' + humanBytes(dlBytes) + ' into a shared cache.'
                : '';
        }
    }

    async function startSelected() {
        const btn = document.getElementById('startBtn');
        const prog = document.getElementById('startProg');
        const fill = document.getElementById('startFill');
        const note = document.getElementById('startNote');
        btn.disabled = true;

        const keys = requiredKeys();
        let grandTotal = 0;
        for (const k of keys) {
            const s = VoiceModels.groupStatus(k);
            if (s && !s.present && s.downloadable) grandTotal += s.bytes || 0;
        }
        if (grandTotal > 0) {
            prog.hidden = false;
            let curFile = null, completed = 0, received = 0;
            const onProgress = (q) => {
                if (q.file !== curFile) { if (curFile !== null) completed += received; curFile = q.file; received = 0; }
                received = q.received;
                const frac = Math.min(1, (completed + received) / grandTotal);
                fill.style.width = Math.round(frac * 100) + '%';
                note.textContent = 'downloading ' + q.label + ' — ' + humanBytes(completed + received) +
                    ' / ' + humanBytes(grandTotal);
            };
            try {
                await VoiceModels.downloadKeys(keys, onProgress);
            } catch (e) {
                note.textContent = 'download failed: ' + ((e && e.message) || e);
                btn.disabled = false; btn.textContent = 'Retry';
                return;
            }
        }

        $setup.hidden = true;
        $convo.hidden = false;
        onStart({
            backend: sel.backend,
            speaker: sel.speaker,
            language: sel.language,
            description: (sel.description || '').trim(),
            wake: !!sel.wake,
        });
    }

    return { showSetup };
}
