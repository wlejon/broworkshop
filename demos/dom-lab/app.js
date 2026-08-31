// demos/dom-lab/app.js
import { registerCustomElements } from './custom-elements.js';
import { registerShadowComponents } from './shadow-dom.js';
import { MutationWatcher } from './mutation-watcher.js';
import { RangeSelectionLab } from './range-selection.js';
import { WebAnimationsLab } from './web-animations.js';

class DomStandardsLabApp {
    constructor() {
        this.dom = {
            tabs: document.querySelectorAll('.tab-btn'),
            tabContents: document.querySelectorAll('.tab-content'),
            customLifecycleLog: document.getElementById('customLifecycleLog'),
            customComponentsContainer: document.getElementById('customComponentsContainer'),
            addStatBtn: document.getElementById('addStatBtn'),
            randomizeStatsBtn: document.getElementById('randomizeStatsBtn'),
            removeStatBtn: document.getElementById('removeStatBtn'),
            shadowHostContainer: document.getElementById('shadowHostContainer'),
            toggleShadowThemeBtn: document.getElementById('toggleShadowThemeBtn'),
            updateShadowContentBtn: document.getElementById('updateShadowContentBtn'),
            shadowInspectLog: document.getElementById('shadowInspectLog'),
            mutationTargetBox: document.getElementById('mutationTargetBox'),
            observedList: document.getElementById('observedList'),
            appendItemBtn: document.getElementById('appendItemBtn'),
            mutateAttrBtn: document.getElementById('mutateAttrBtn'),
            clearChildrenBtn: document.getElementById('clearChildrenBtn'),
            clearMutationLogBtn: document.getElementById('clearMutationLogBtn'),
            mutationLog: document.getElementById('mutationLog'),
            editableArticle: document.getElementById('editableArticle'),
            selectFirstSentenceBtn: document.getElementById('selectFirstSentenceBtn'),
            surroundSelectionBtn: document.getElementById('surroundSelectionBtn'),
            collapseRangeBtn: document.getElementById('collapseRangeBtn'),
            rangeStartNode: document.getElementById('rangeStartNode'),
            rangeStartOffset: document.getElementById('rangeStartOffset'),
            rangeEndNode: document.getElementById('rangeEndNode'),
            rangeEndOffset: document.getElementById('rangeEndOffset'),
            rangeCollapsed: document.getElementById('rangeCollapsed'),
            animOrb: document.getElementById('animOrb'),
            animCard: document.getElementById('animCard'),
            animPlayPauseBtn: document.getElementById('animPlayPauseBtn'),
            animReverseBtn: document.getElementById('animReverseBtn'),
            animCancelBtn: document.getElementById('animCancelBtn'),
            animSpeedSelect: document.getElementById('animSpeedSelect'),
            animPlayState: document.getElementById('animPlayState'),
            animCurrentTime: document.getElementById('animCurrentTime'),
            animRate: document.getElementById('animRate'),
            animCount: document.getElementById('animCount'),
        };

        this.initTabs();
        this.initCustomElements();
        this.initShadowDom();
        this.initMutationObserver();
        this.initRangeSelection();
        this.initWebAnimations();
    }

    initTabs() {
        this.dom.tabs.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.tab;
                this.dom.tabs.forEach(b => b.classList.remove('active'));
                this.dom.tabContents.forEach(c => c.classList.remove('active'));

                btn.classList.add('active');
                const content = document.getElementById('tab-' + target);
                if (content) content.classList.add('active');
            });
        });
    }

    initCustomElements() {
        registerCustomElements((event, tag, data) => {
            const time = new Date().toLocaleTimeString();
            const logEntry = `[${time}] <${tag}> ${event}: ${JSON.stringify(data)}\n`;
            this.dom.customLifecycleLog.textContent = logEntry + this.dom.customLifecycleLog.textContent;
        });

        this.dom.addStatBtn.addEventListener('click', () => {
            const el = document.createElement('stat-meter');
            const randVal = Math.floor(Math.random() * 100);
            el.setAttribute('label', 'Dynamic Metric');
            el.setAttribute('value', randVal.toString());
            el.setAttribute('unit', 'pt');
            this.dom.customComponentsContainer.appendChild(el);
        });

        this.dom.randomizeStatsBtn.addEventListener('click', () => {
            const meters = this.dom.customComponentsContainer.querySelectorAll('stat-meter');
            meters.forEach(m => {
                m.setAttribute('value', Math.floor(Math.random() * 100).toString());
            });
        });

        this.dom.removeStatBtn.addEventListener('click', () => {
            const last = this.dom.customComponentsContainer.lastElementChild;
            if (last) last.remove();
        });
    }

    initShadowDom() {
        registerShadowComponents((card) => {
            const theme = card.getAttribute('theme');
            const titleSlot = card.querySelector('[slot="title"]');
            const log = `[Shadow Host <card-box>]:
  Theme attribute: "${theme}"
  Shadow root: active (${card.shadowRoot ? 'open' : 'closed'})
  Slotted Title: "${titleSlot ? titleSlot.textContent : ''}"\n\n`;
            this.dom.shadowInspectLog.textContent = log;
        });

        this.dom.toggleShadowThemeBtn.addEventListener('click', () => {
            const cards = this.dom.shadowHostContainer.querySelectorAll('card-box');
            cards.forEach(c => {
                const cur = c.getAttribute('theme');
                c.setAttribute('theme', cur === 'ocean' ? 'sunset' : 'ocean');
            });
        });

        this.dom.updateShadowContentBtn.addEventListener('click', () => {
            const body = this.dom.shadowHostContainer.querySelector('card-box [slot="body"]');
            if (body) {
                body.textContent = 'Updated slotted text at ' + new Date().toLocaleTimeString();
            }
        });
    }

    initMutationObserver() {
        this.mutationWatcher = new MutationWatcher(this.dom.mutationTargetBox, (record) => {
            const time = new Date().toLocaleTimeString();
            let detail = '';
            if (record.type === 'childList') {
                detail = `added: ${record.addedNodes.length}, removed: ${record.removedNodes.length}`;
            } else if (record.type === 'attributes') {
                detail = `attribute "${record.attributeName}" (old: "${record.oldValue}")`;
            }
            const logLine = `[${time}] Mutation: ${record.type} -> ${detail}\n`;
            this.dom.mutationLog.textContent = logLine + this.dom.mutationLog.textContent;
        });

        let itemCounter = 3;
        this.dom.appendItemBtn.addEventListener('click', () => {
            const li = document.createElement('li');
            li.className = 'item';
            li.textContent = `Node Item #${itemCounter++}`;
            this.dom.observedList.appendChild(li);
        });

        this.dom.mutateAttrBtn.addEventListener('click', () => {
            const statuses = ['active', 'processing', 'completed', 'idle'];
            const cur = this.dom.mutationTargetBox.getAttribute('data-status');
            const next = statuses[(statuses.indexOf(cur) + 1) % statuses.length];
            this.dom.mutationTargetBox.setAttribute('data-status', next);
        });

        this.dom.clearChildrenBtn.addEventListener('click', () => {
            this.dom.observedList.innerHTML = '';
        });

        this.dom.clearMutationLogBtn.addEventListener('click', () => {
            this.dom.mutationLog.textContent = '';
        });
    }

    initRangeSelection() {
        this.rangeLab = new RangeSelectionLab(this.dom.editableArticle, (diag) => {
            this.dom.rangeStartNode.textContent = diag.startContainerName;
            this.dom.rangeStartOffset.textContent = diag.startOffset.toString();
            this.dom.rangeEndNode.textContent = diag.endContainerName;
            this.dom.rangeEndOffset.textContent = diag.endOffset.toString();
            this.dom.rangeCollapsed.textContent = diag.collapsed ? 'Yes' : 'No';
        });

        this.dom.selectFirstSentenceBtn.addEventListener('click', () => {
            this.rangeLab.selectDefaultRange();
        });

        this.dom.surroundSelectionBtn.addEventListener('click', () => {
            this.rangeLab.surroundWithMark();
        });

        this.dom.collapseRangeBtn.addEventListener('click', () => {
            this.rangeLab.collapseToStart();
        });
    }

    initWebAnimations() {
        this.animLab = new WebAnimationsLab(this.dom.animOrb, this.dom.animCard);

        this.dom.animPlayPauseBtn.addEventListener('click', () => {
            const isPaused = this.animLab.togglePlay();
            this.dom.animPlayPauseBtn.textContent = isPaused ? '▶ Play' : '⏸ Pause';
        });

        this.dom.animReverseBtn.addEventListener('click', () => {
            this.animLab.reverse();
        });

        this.dom.animCancelBtn.addEventListener('click', () => {
            this.animLab.cancel();
        });

        this.dom.animSpeedSelect.addEventListener('change', (e) => {
            this.animLab.setPlaybackRate(e.target.value);
        });

        // Telemetry updater loop
        setInterval(() => {
            const telem = this.animLab.getTelemetry();
            this.dom.animPlayState.textContent = telem.playState;
            this.dom.animCurrentTime.textContent = telem.currentTime + ' ms';
            this.dom.animRate.textContent = telem.playbackRate.toFixed(1) + 'x';
            this.dom.animCount.textContent = telem.count.toString();
        }, 100);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new DomStandardsLabApp();
});
