// tools/media-inspector/metadata.js
export class MetadataInspector {
    constructor() {
        this.dom = {
            sampleRate: document.getElementById('metaSampleRate'),
            channels: document.getElementById('metaChannels'),
            audioDuration: document.getElementById('metaAudioDuration'),
            buckets: document.getElementById('metaBuckets'),
            peakMax: document.getElementById('metaPeakMax'),
            rmsAvg: document.getElementById('metaRmsAvg'),
            thumbSize: document.getElementById('metaThumbSize'),
            thumbCount: document.getElementById('metaThumbCount'),
            rotation: document.getElementById('metaRotation'),
            bufferSize: document.getElementById('metaBufferSize'),
            badgeDuration: document.getElementById('badgeDuration'),
            badgeSampleRate: document.getElementById('badgeSampleRate'),
            badgeChannels: document.getElementById('badgeChannels'),
            badgeAvailable: document.getElementById('badgeAvailable'),
        };

        this.checkAvailability();
    }

    checkAvailability() {
        const available = typeof bro !== 'undefined' && bro.media && bro.media.available;
        if (this.dom.badgeAvailable) {
            this.dom.badgeAvailable.textContent = available ? 'bro.media: ON' : 'bro.media: OFF';
            this.dom.badgeAvailable.className = available ? 'badge ok' : 'badge';
        }
    }

    update(peaks, thumbs) {
        // Audio peaks info
        if (peaks) {
            this.dom.sampleRate.textContent = (peaks.sampleRate || 0) + ' Hz';
            this.dom.channels.textContent = (peaks.channels || 0) + (peaks.channels === 2 ? ' (Stereo)' : peaks.channels === 1 ? ' (Mono)' : '');
            this.dom.audioDuration.textContent = (peaks.duration || 0).toFixed(3) + ' s';
            this.dom.buckets.textContent = (peaks.buckets || (peaks.max ? peaks.max.length : 0)) + ' buckets';

            let maxVal = 0;
            let rmsSum = 0;
            if (peaks.max) {
                for (let i = 0; i < peaks.max.length; i++) {
                    if (peaks.max[i] > maxVal) maxVal = peaks.max[i];
                }
            }
            if (peaks.rms) {
                for (let i = 0; i < peaks.rms.length; i++) {
                    rmsSum += peaks.rms[i];
                }
                const rmsAvg = peaks.rms.length > 0 ? (rmsSum / peaks.rms.length) : 0;
                this.dom.rmsAvg.textContent = rmsAvg.toFixed(4);
            } else {
                this.dom.rmsAvg.textContent = '—';
            }

            this.dom.peakMax.textContent = maxVal.toFixed(4);

            // Badges
            this.dom.badgeDuration.textContent = (peaks.duration || 0).toFixed(2) + 's';
            this.dom.badgeSampleRate.textContent = (peaks.sampleRate || 0) + ' Hz';
            this.dom.badgeChannels.textContent = (peaks.channels || 0) + ' ch';
        } else {
            this.dom.sampleRate.textContent = '—';
            this.dom.channels.textContent = '—';
            this.dom.audioDuration.textContent = '—';
            this.dom.buckets.textContent = '—';
            this.dom.peakMax.textContent = '—';
            this.dom.rmsAvg.textContent = '—';
        }

        // Thumbnails info
        if (thumbs && thumbs.count > 0) {
            this.dom.thumbSize.textContent = thumbs.width + ' × ' + thumbs.height + ' px';
            this.dom.thumbCount.textContent = thumbs.count + ' frames';
            this.dom.rotation.textContent = (thumbs.rotation || 0) + '°';
            const byteSize = thumbs.data ? thumbs.data.byteLength || thumbs.data.length : 0;
            this.dom.bufferSize.textContent = (byteSize / 1024).toFixed(1) + ' KB';
        } else {
            this.dom.thumbSize.textContent = '—';
            this.dom.thumbCount.textContent = '0 frames';
            this.dom.rotation.textContent = '—';
            this.dom.bufferSize.textContent = '—';
        }
    }
}
