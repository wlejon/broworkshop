// app.js — Main entry and layout wiring for Range & Selection Lab.

import { RangeOps } from './range_ops.js';
import { MutationAuditor } from './observer.js';
import { DomParserSuite, TextShaperInspector } from './parser_shaper.js';

class RangeSelectionLabApp {
    constructor() {
        this.dom = {
            tabs: document.querySelectorAll('.tab-btn'),
            views: document.querySelectorAll('.view-panel'),
            editorCanvas: document.getElementById('editorCanvas'),
            caretHud: document.getElementById('caretHud'),
            caretCoords: document.getElementById('caretCoords'),
            caretHeight: document.getElementById('caretHeight'),

            // Selection & Range Inspector elements
            selAnchorNode: document.getElementById('selAnchorNode'),
            selAnchorOffset: document.getElementById('selAnchorOffset'),
            selFocusNode: document.getElementById('selFocusNode'),
            selFocusOffset: document.getElementById('selFocusOffset'),
            selDirection: document.getElementById('selDirection'),
            selCollapsed: document.getElementById('selCollapsed'),
            selRangeCount: document.getElementById('selRangeCount'),
            selType: document.getElementById('selType'),

            rangeStartContainer: document.getElementById('rangeStartContainer'),
            rangeStartOffset: document.getElementById('rangeStartOffset'),
            rangeEndContainer: document.getElementById('rangeEndContainer'),
            rangeEndOffset: document.getElementById('rangeEndOffset'),
            rangeAncestor: document.getElementById('rangeAncestor'),
            rangeLength: document.getElementById('rangeLength'),
            rangeRectsCount: document.getElementById('rangeRectsCount'),
            rangeBounding: document.getElementById('rangeBounding'),
            rangeFragmentPreview: document.getElementById('rangeFragmentPreview'),
            lastFragmentBox: document.getElementById('lastFragmentBox'),

            // Toolbar buttons
            btnBold: document.getElementById('btnBold'),
            btnItalic: document.getElementById('btnItalic'),
            btnCode: document.getElementById('btnCode'),
            btnHighlight: document.getElementById('btnHighlight'),
            btnBadge: document.getElementById('btnBadge'),
            btnExtract: document.getElementById('btnExtract'),
            btnClone: document.getElementById('btnClone'),
            btnInsertNode: document.getElementById('btnInsertNode'),
            btnDelete: document.getElementById('btnDelete'),
            btnCollapseStart: document.getElementById('btnCollapseStart'),
            btnCollapseEnd: document.getElementById('btnCollapseEnd'),
            btnSelectSentence: document.getElementById('btnSelectSentence'),
            btnSelectParagraph: document.getElementById('btnSelectParagraph'),
            btnSelectAll: document.getElementById('btnSelectAll'),

            // MutationObserver elements
            obsFilterType: document.getElementById('obsFilterType'),
            obsTotalCount: document.getElementById('obsTotalCount'),
            obsTogglePause: document.getElementById('obsTogglePause'),
            obsClearBtn: document.getElementById('obsClearBtn'),
            obsExportBtn: document.getElementById('obsExportBtn'),
            mutationLogStream: document.getElementById('mutationLogStream'),

            // DOMParser elements
            parserPresetSelect: document.getElementById('parserPresetSelect'),
            parserMimeSelect: document.getElementById('parserMimeSelect'),
            btnRunParser: document.getElementById('btnRunParser'),
            parserInputText: document.getElementById('parserInputText'),
            parserTreeView: document.getElementById('parserTreeView'),
            parserStats: document.getElementById('parserStats'),

            // HarfBuzz Shaper elements
            shaperTextInput: document.getElementById('shaperTextInput'),
            shaperPresetSelect: document.getElementById('shaperPresetSelect'),
            shaperFamilySelect: document.getElementById('shaperFamilySelect'),
            shaperSizeSlider: document.getElementById('shaperSizeSlider'),
            shaperSizeVal: document.getElementById('shaperSizeVal'),
            btnRunShaper: document.getElementById('btnRunShaper'),
            shaperCanvas: document.getElementById('shaperCanvas'),
            shaperEngineName: document.getElementById('shaperEngineName'),
            shaperTotalWidth: document.getElementById('shaperTotalWidth'),
            shaperGlyphCount: document.getElementById('shaperGlyphCount'),
            shaperClusterCount: document.getElementById('shaperClusterCount'),
            shaperLigaturesCount: document.getElementById('shaperLigaturesCount'),
            clustersTableBody: document.getElementById('clustersTableBody'),
            kerningTableBody: document.getElementById('kerningTableBody'),

            // Status bar
            statusSelectionActive: document.getElementById('statusSelectionActive'),
            statusCaretOffset: document.getElementById('statusCaretOffset'),
            statusMutationCount: document.getElementById('statusMutationCount')
        };

        this.initTabs();
        this.initRangeOps();
        this.initMutationObserver();
        this.initDomParser();
        this.initTextShaper();
    }

    initTabs() {
        this.dom.tabs.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                this.dom.tabs.forEach(b => b.classList.remove('active'));
                this.dom.views.forEach(v => v.classList.remove('active'));

                btn.classList.add('active');
                const targetView = document.getElementById(targetTab);
                if (targetView) targetView.classList.add('active');

                if (targetTab === 'shaper-view') {
                    this.runShaperAnalysis();
                }
            });
        });
    }

    initRangeOps() {
        this.rangeOps = new RangeOps(this.dom.editorCanvas, (metrics) => {
            this.updateRangeTelemetry(metrics);
        });

        // Toolbar bindings
        this.dom.btnBold.addEventListener('click', () => this.rangeOps.surroundSelection('strong'));
        this.dom.btnItalic.addEventListener('click', () => this.rangeOps.surroundSelection('em'));
        this.dom.btnCode.addEventListener('click', () => this.rangeOps.surroundSelection('code'));
        this.dom.btnHighlight.addEventListener('click', () => this.rangeOps.surroundSelection('mark'));
        this.dom.btnBadge.addEventListener('click', () => this.rangeOps.surroundSelection('span', 'custom-tag'));

        this.dom.btnExtract.addEventListener('click', () => {
            const res = this.rangeOps.extractSelection();
            if (res) this.dom.lastFragmentBox.textContent = `[EXTRACTED]\n${res.html}`;
        });

        this.dom.btnClone.addEventListener('click', () => {
            const res = this.rangeOps.cloneSelection();
            if (res) this.dom.lastFragmentBox.textContent = `[CLONED]\n${res.html}`;
        });

        let stampCounter = 1;
        this.dom.btnInsertNode.addEventListener('click', () => {
            const stamp = document.createElement('span');
            stamp.className = 'custom-tag';
            stamp.textContent = `[STAMP #${stampCounter++} ${new Date().toLocaleTimeString()}]`;
            this.rangeOps.insertNode(stamp);
        });

        this.dom.btnDelete.addEventListener('click', () => this.rangeOps.deleteContents());

        this.dom.btnCollapseStart.addEventListener('click', () => this.rangeOps.collapse(true));
        this.dom.btnCollapseEnd.addEventListener('click', () => this.rangeOps.collapse(false));

        this.dom.btnSelectSentence.addEventListener('click', () => this.rangeOps.selectSentence());
        this.dom.btnSelectParagraph.addEventListener('click', () => this.rangeOps.selectParagraph());
        this.dom.btnSelectAll.addEventListener('click', () => this.rangeOps.selectAll());

        // Trigger initial metrics
        this.rangeOps.notify();
    }

    updateRangeTelemetry(metrics) {
        if (!metrics || !metrics.hasSelection || !metrics.selection || !metrics.range) {
            this.dom.selCollapsed.textContent = 'true';
            this.dom.selDirection.textContent = 'none';
            this.dom.statusSelectionActive.textContent = 'Inactive';
            this.dom.statusSelectionActive.style.color = 'var(--text-muted)';
            return;
        }

        this.dom.statusSelectionActive.textContent = 'Active';
        this.dom.statusSelectionActive.style.color = 'var(--success)';

        const { selection, range, caret } = metrics;

        // Selection table
        this.dom.selAnchorNode.textContent = selection.anchorNode;
        this.dom.selAnchorOffset.textContent = selection.anchorOffset.toString();
        this.dom.selFocusNode.textContent = selection.focusNode;
        this.dom.selFocusOffset.textContent = selection.focusOffset.toString();
        this.dom.selDirection.textContent = selection.direction;
        this.dom.selCollapsed.textContent = selection.isCollapsed ? 'true' : 'false';
        this.dom.selCollapsed.className = `val-tag ${selection.isCollapsed ? '' : 'ok'}`;
        this.dom.selRangeCount.textContent = selection.rangeCount.toString();
        this.dom.selType.textContent = selection.type;

        // Range table
        this.dom.rangeStartContainer.textContent = range.startContainerName;
        this.dom.rangeStartOffset.textContent = range.startOffset.toString();
        this.dom.rangeEndContainer.textContent = range.endContainerName;
        this.dom.rangeEndOffset.textContent = range.endOffset.toString();
        this.dom.rangeAncestor.textContent = range.commonAncestor;
        this.dom.rangeLength.textContent = `${range.textLength} chars`;
        this.dom.rangeRectsCount.textContent = `${range.clientRectsCount} rect(s)`;

        const bbox = range.boundingRect;
        this.dom.rangeBounding.textContent = `(${bbox.x}, ${bbox.y}) ${bbox.width}x${bbox.height}`;
        this.dom.rangeFragmentPreview.textContent = range.htmlPreview || '(empty)';

        // Caret HUD
        if (caret) {
            this.dom.caretCoords.textContent = `x: ${caret.editorRelativeX}, y: ${caret.editorRelativeY} (vw: ${caret.viewportX}, ${caret.viewportY})`;
            this.dom.caretHeight.textContent = caret.height.toString();
            this.dom.statusCaretOffset.textContent = `Offset ${range.startOffset}`;
        }
    }

    initMutationObserver() {
        this.auditor = new MutationAuditor(this.dom.editorCanvas, (_records, stats) => {
            this.dom.obsTotalCount.textContent = stats.total.toString();
            this.dom.statusMutationCount.textContent = `${stats.total} events`;
            this.renderMutationLog();
        });

        this.dom.obsFilterType.addEventListener('change', () => this.renderMutationLog());

        this.dom.obsTogglePause.addEventListener('click', () => {
            const isPaused = this.auditor.togglePause();
            this.dom.obsTogglePause.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
            document.getElementById('observerBadge').textContent = isPaused ? 'Observer: Paused' : 'Observer: Active';
            document.getElementById('observerBadge').className = isPaused ? 'badge' : 'badge active';
        });

        this.dom.obsClearBtn.addEventListener('click', () => {
            this.auditor.clear();
            this.dom.mutationLogStream.innerHTML = `
                <div class="log-entry" style="justify-content:center; color:var(--text-muted);">
                    Log cleared. Waiting for mutations...
                </div>`;
        });

        this.dom.obsExportBtn.addEventListener('click', () => {
            const json = this.auditor.exportJson();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mutation-log-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    renderMutationLog() {
        const filter = this.dom.obsFilterType.value;
        const records = this.auditor.records;

        const filtered = filter === 'all'
            ? records
            : records.filter(r => r.type === filter);

        if (filtered.length === 0) {
            this.dom.mutationLogStream.innerHTML = `
                <div class="log-entry" style="justify-content:center; color:var(--text-muted);">
                    No mutations match current filter "${filter}".
                </div>`;
            return;
        }

        const html = filtered.slice(0, 80).map(r => `
            <div class="log-entry">
                <span class="log-time">${r.timestamp}</span>
                <span class="log-badge ${r.type}">${r.type}</span>
                <div class="log-body">${this.escapeHtml(r.summary)}</div>
            </div>
        `).join('');

        this.dom.mutationLogStream.innerHTML = html;
    }

    initDomParser() {
        this.domParser = new DomParserSuite();

        const samples = {
            sampleHtml: `<div class="card" id="user-123">
  <h3 class="title">Web Standards <span>2026</span></h3>
  <p>DOMParser parses strings into robust DOM documents.</p>
  <ul class="tag-list">
    <li data-status="ready">Range API</li>
    <li data-status="ready">MutationObserver</li>
    <li data-status="active">HarfBuzz Text</li>
  </ul>
</div>`,
            sampleSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" width="240" height="120">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#58a6ff" />
      <stop offset="100%" stop-color="#a371f7" />
    </linearGradient>
  </defs>
  <rect width="240" height="120" rx="12" fill="url(#grad)" />
  <circle cx="60" cy="60" r="32" fill="#ffffff" opacity="0.8" />
  <text x="110" y="68" fill="#ffffff" font-size="20" font-weight="bold">DOM SVG</text>
</svg>`,
            sampleXml: `<?xml version="1.0" encoding="UTF-8"?>
<application id="app-demo" version="2.4.0">
  <metadata>
    <author>Google DeepMind</author>
    <engine>bro-platform</engine>
  </metadata>
  <features>
    <feature enabled="true">RangeSelection</feature>
    <feature enabled="true">HarfBuzzShaper</feature>
  </features>
</application>`,
            sampleError: `<xml>
  <unclosedTag>
    <message>This is intentionally malformed to trigger <parsererror></message>
</xml>`
        };

        this.dom.parserInputText.value = samples.sampleHtml;

        this.dom.parserPresetSelect.addEventListener('change', (e) => {
            const key = e.target.value;
            if (samples[key]) {
                this.dom.parserInputText.value = samples[key];
                if (key === 'sampleSvg') this.dom.parserMimeSelect.value = 'image/svg+xml';
                else if (key === 'sampleXml' || key === 'sampleError') this.dom.parserMimeSelect.value = 'application/xml';
                else this.dom.parserMimeSelect.value = 'text/html';
                this.runParser();
            }
        });

        this.dom.btnRunParser.addEventListener('click', () => this.runParser());

        // Run initial parse
        this.runParser();
    }

    runParser() {
        const text = this.dom.parserInputText.value;
        const mime = this.dom.parserMimeSelect.value;
        const res = this.domParser.parse(text, mime);

        if (!res.success) {
            this.dom.parserStats.textContent = `Parse Error (${res.elapsedMs} ms)`;
            this.dom.parserStats.className = 'badge';
            this.dom.parserStats.style.color = 'var(--danger)';
            this.dom.parserTreeView.innerHTML = `
                <div style="color:var(--danger); padding:10px; background:rgba(248,81,73,0.1); border-radius:6px;">
                    <b>Parser Error:</b><br>${this.escapeHtml(res.error)}
                </div>`;
            return;
        }

        const m = res.metrics;
        this.dom.parserStats.textContent = `${m.totalElements} elements, ${m.totalAttributes} attrs, depth ${m.maxDepth} (${res.elapsedMs} ms)`;
        this.dom.parserStats.className = 'badge active';

        const treeHtml = this.renderTreeNodeHtml(res.tree);
        this.dom.parserTreeView.innerHTML = treeHtml;
    }

    renderTreeNodeHtml(node) {
        if (!node) return '';
        if (node.type === 'text') {
            return `<div class="tree-node"><span class="tree-text">"${this.escapeHtml(node.content)}"</span></div>`;
        }

        let attrStr = '';
        for (const [k, v] of Object.entries(node.attributes)) {
            attrStr += ` <span class="tree-attr">${k}</span>=<span class="tree-val">"${this.escapeHtml(v)}"</span>`;
        }

        let childrenHtml = '';
        if (node.children && node.children.length > 0) {
            childrenHtml = node.children.map(c => this.renderTreeNodeHtml(c)).join('');
        }

        return `
            <div class="tree-node">
                <span class="tree-tag">&lt;${node.tag}${attrStr}&gt;</span>
                ${childrenHtml}
                <span class="tree-tag">&lt;/${node.tag}&gt;</span>
            </div>`;
    }

    initTextShaper() {
        this.shaper = new TextShaperInspector();

        this.dom.shaperSizeSlider.addEventListener('input', (e) => {
            this.dom.shaperSizeVal.textContent = `${e.target.value}px`;
            this.runShaperAnalysis();
        });

        this.dom.shaperPresetSelect.addEventListener('change', (e) => {
            const presets = {
                office: 'office fluffy',
                difficult: 'difficult affine',
                kerning: 'AV AW To Yo LT P.',
                astral: 'a😀b🎉c',
                hindi: 'हिन्दी',
                arabic: 'العربية'
            };
            const val = presets[e.target.value];
            if (val) {
                this.dom.shaperTextInput.value = val;
                this.runShaperAnalysis();
            }
        });

        this.dom.shaperFamilySelect.addEventListener('change', () => this.runShaperAnalysis());
        this.dom.btnRunShaper.addEventListener('click', () => this.runShaperAnalysis());
        this.dom.shaperTextInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') this.runShaperAnalysis();
        });

        // Run initial shaper analysis
        this.runShaperAnalysis();
    }

    runShaperAnalysis() {
        const text = this.dom.shaperTextInput.value;
        const family = this.dom.shaperFamilySelect.value;
        const size = parseInt(this.dom.shaperSizeSlider.value, 10);

        const res = this.shaper.shape(text, { family, size });

        this.dom.shaperEngineName.textContent = res.engine;
        this.dom.shaperTotalWidth.textContent = `${res.width}px`;
        this.dom.shaperGlyphCount.textContent = res.glyphCount.toString();
        this.dom.shaperClusterCount.textContent = res.clusterCount.toString();
        this.dom.shaperLigaturesCount.textContent = res.ligaturesFound.toString();

        // Render Canvas
        this.shaper.renderClustersToCanvas(this.dom.shaperCanvas, res);

        // Render Clusters Table
        if (res.clusters && res.clusters.length > 0) {
            this.dom.clustersTableBody.innerHTML = res.clusters.map(c => `
                <tr class="${c.isLigature ? 'ligature-row' : ''}">
                    <td>#${c.index}</td>
                    <td><b>${this.escapeHtml(c.text || '(span)')}</b></td>
                    <td>b${c.byteStart}–${c.byteEnd} (${c.byteEnd - c.byteStart}B)</td>
                    <td>${c.glyphs}</td>
                    <td>${c.width}px</td>
                    <td>${c.isLigature ? '<span style="color:var(--pink); font-weight:bold;">Ligature</span>' : 'Standard'}</td>
                </tr>
            `).join('');
        }

        // Render Kerning Table
        const pairs = ['AV', 'AW', 'To', 'Yo', 'LT', 'P,'];
        this.dom.kerningTableBody.innerHTML = pairs.map(p => {
            const k = this.shaper.measureKerning(p, family, size);
            if (!k) return '';
            const deltaColor = k.delta < 0 ? 'var(--success)' : (k.delta > 0 ? 'var(--warning)' : 'var(--text-muted)');
            return `
                <tr>
                    <td><b>${p}</b></td>
                    <td>${k.width1}px ('${k.c1}')</td>
                    <td>${k.width2}px ('${k.c2}')</td>
                    <td>${k.unkernedSum}px</td>
                    <td>${k.pairedWidth}px</td>
                    <td style="color:${deltaColor}; font-weight:bold;">${k.delta > 0 ? '+' : ''}${k.delta}px</td>
                </tr>
            `;
        }).join('');
    }

    escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new RangeSelectionLabApp();
});
