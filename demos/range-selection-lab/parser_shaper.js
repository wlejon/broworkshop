// parser_shaper.js — DOMParser HTML/SVG/XML string parsing & bro.text HarfBuzz cluster mapping and glyph analysis.

/**
 * DOMParser interactive suite: parses strings and inspects resulting DOM trees.
 */
export class DomParserSuite {
    constructor() {
        this.parser = new DOMParser();
        this.serializer = new XMLSerializer();
    }

    /**
     * Parses a string with DOMParser and returns detailed structural analysis.
     * @param {string} markup
     * @param {DOMParserSupportedType} mimeType 'text/html' | 'image/svg+xml' | 'application/xml'
     */
    parse(markup, mimeType = 'text/html') {
        const startTime = performance.now();
        let doc = null;
        let hasError = false;
        let errorMessage = null;

        try {
            doc = this.parser.parseFromString(markup, mimeType);

            // Check for XML / SVG parse errors
            const parseError = doc.querySelector('parsererror');
            if (parseError) {
                hasError = true;
                errorMessage = parseError.textContent;
            }
        } catch (e) {
            hasError = true;
            errorMessage = e.message;
        }

        const elapsedMs = Math.round((performance.now() - startTime) * 100) / 100;

        if (hasError || !doc) {
            return {
                success: false,
                mimeType,
                elapsedMs,
                error: errorMessage || 'Unknown parser error',
                tree: null,
                metrics: null
            };
        }

        const rootNode = mimeType === 'text/html' ? doc.body : doc.documentElement;
        const metrics = this._collectMetrics(rootNode);
        const tree = this._buildNodeTree(rootNode);
        let serialized = '';
        try {
            serialized = this.serializer.serializeToString(doc);
        } catch (e) {
            serialized = `(serialization error: ${e.message})`;
        }

        return {
            success: true,
            mimeType,
            elapsedMs,
            error: null,
            doc,
            metrics,
            tree,
            serialized
        };
    }

    _collectMetrics(node) {
        let totalElements = 0;
        let totalTextNodes = 0;
        let totalAttributes = 0;
        let maxDepth = 0;

        function walk(current, depth) {
            if (!current) return;
            if (depth > maxDepth) maxDepth = depth;

            if (current.nodeType === Node.ELEMENT_NODE) {
                totalElements++;
                totalAttributes += current.attributes ? current.attributes.length : 0;
                for (let i = 0; i < current.childNodes.length; i++) {
                    walk(current.childNodes[i], depth + 1);
                }
            } else if (current.nodeType === Node.TEXT_NODE && current.textContent.trim().length > 0) {
                totalTextNodes++;
            }
        }

        walk(node, 1);

        return {
            totalElements,
            totalTextNodes,
            totalAttributes,
            maxDepth
        };
    }

    _buildNodeTree(node, depth = 0) {
        if (!node) return null;

        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (!text) return null;
            return {
                type: 'text',
                depth,
                content: text.length > 50 ? text.slice(0, 50) + '...' : text
            };
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            const attrs = {};
            if (node.attributes) {
                for (let i = 0; i < node.attributes.length; i++) {
                    const attr = node.attributes[i];
                    attrs[attr.name] = attr.value;
                }
            }

            const children = [];
            for (let i = 0; i < node.childNodes.length; i++) {
                const childTree = this._buildNodeTree(node.childNodes[i], depth + 1);
                if (childTree) children.push(childTree);
            }

            return {
                type: 'element',
                tag: node.nodeName.toLowerCase(),
                attributes: attrs,
                depth,
                children
            };
        }

        return null;
    }
}

/**
 * HarfBuzz Text Shaper & Cluster Inspector.
 * Uses bro.text.shape when available in the bro engine; falls back to canvas-assisted shaping metrics.
 */
export class TextShaperInspector {
    constructor() {
        this.isNativeBro = typeof bro !== 'undefined' && bro.text && typeof bro.text.shape === 'function';
    }

    /**
     * Shapes text and extracts HarfBuzz clusters and metrics.
     */
    shape(text, options = {}) {
        const family = options.family || 'Calibri';
        const size = options.size || 36;
        const weight = options.weight || 'normal';
        const italic = options.italic || false;

        const textStr = String(text ?? '');
        const utf8Bytes = new TextEncoder().encode(textStr).length;
        const utf16Length = textStr.length;

        if (this.isNativeBro) {
            try {
                const res = bro.text.shape(textStr, { family, size, weight, italic });
                if (res) {
                    return this._formatNativeShapedResult(textStr, res, { family, size, weight, italic, utf8Bytes, utf16Length });
                }
            } catch (e) {
                console.warn('Native bro.text.shape failed, using fallback shaper:', e);
            }
        }

        return this._fallbackShape(textStr, { family, size, weight, italic, utf8Bytes, utf16Length });
    }

    _formatNativeShapedResult(text, res, meta) {
        const clusters = (res.clusters || []).map((c, idx) => {
            const spanBytes = c.end - c.start;
            return {
                index: idx,
                byteStart: c.start,
                byteEnd: c.end,
                glyphs: c.glyphs ?? 1,
                width: c.width ?? (res.width / Math.max(1, res.clusters.length)),
                isLigature: spanBytes > 1 && c.glyphs === 1,
                isExpanded: c.glyphs > spanBytes
            };
        });

        const ligaturesFound = clusters.filter(c => c.isLigature).length;

        return {
            engine: 'bro.text (HarfBuzz)',
            text,
            width: res.width,
            glyphCount: res.glyphCount ?? clusters.reduce((acc, c) => acc + c.glyphs, 0),
            clusterCount: clusters.length,
            clusters,
            ligaturesFound,
            meta
        };
    }

    _fallbackShape(text, meta) {
        // Fallback cluster simulator when running in standard browser
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = `${meta.italic ? 'italic ' : ''}${meta.weight} ${meta.size}px "${meta.family}", sans-serif`;

        const totalWidth = ctx.measureText(text).width;
        const encoder = new TextEncoder();

        // Grapheme segmentation
        let segments = [];
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
            segments = Array.from(segmenter.segment(text));
        } else {
            segments = Array.from(text).map((char, index) => ({ segment: char, index }));
        }

        let currentByte = 0;
        let cumulativeWidth = 0;
        const clusters = [];

        // Known ligature patterns under Calibri/OpenType
        const ligatures = ['ffi', 'ffl', 'fi', 'fl', 'ff', 'st', 'ct', 'ae', 'oe'];

        let i = 0;
        while (i < segments.length) {
            const char = segments[i].segment;
            const charBytes = encoder.encode(char).length;
            const byteStart = currentByte;
            const byteEnd = currentByte + charBytes;

            // Check if upcoming sequence forms a ligature
            let isLigature = false;
            let combinedText = char;
            let step = 1;

            if (i + 1 < segments.length) {
                const next2 = char + segments[i + 1].segment;
                if (ligatures.includes(next2.toLowerCase())) {
                    isLigature = true;
                    combinedText = next2;
                    step = 2;
                } else if (i + 2 < segments.length) {
                    const next3 = next2 + segments[i + 2].segment;
                    if (ligatures.includes(next3.toLowerCase())) {
                        isLigature = true;
                        combinedText = next3;
                        step = 3;
                    }
                }
            }

            const stepBytes = encoder.encode(combinedText).length;
            const clusterWidth = ctx.measureText(combinedText).width;

            clusters.push({
                index: clusters.length,
                text: combinedText,
                byteStart: currentByte,
                byteEnd: currentByte + stepBytes,
                glyphs: isLigature ? 1 : step,
                width: Math.round(clusterWidth * 100) / 100,
                isLigature: isLigature,
                isExpanded: false
            });

            currentByte += stepBytes;
            cumulativeWidth += clusterWidth;
            i += step;
        }

        const glyphCount = clusters.reduce((sum, c) => sum + c.glyphs, 0);
        const ligaturesFound = clusters.filter(c => c.isLigature).length;

        return {
            engine: 'Canvas Emulated (Browser)',
            text,
            width: Math.round(totalWidth * 100) / 100,
            glyphCount,
            clusterCount: clusters.length,
            clusters,
            ligaturesFound,
            meta
        };
    }

    /**
     * Measures kerning between a pair of characters.
     */
    measureKerning(pair, family = 'Calibri', size = 48) {
        if (pair.length < 2) return null;
        const c1 = pair[0];
        const c2 = pair[1];

        const shaper1 = this.shape(c1, { family, size });
        const shaper2 = this.shape(c2, { family, size });
        const shaperPair = this.shape(pair, { family, size });

        const unkernedSum = Math.round((shaper1.width + shaper2.width) * 100) / 100;
        const pairedWidth = Math.round(shaperPair.width * 100) / 100;
        const delta = Math.round((pairedWidth - unkernedSum) * 100) / 100;

        return {
            pair,
            c1,
            c2,
            width1: shaper1.width,
            width2: shaper2.width,
            unkernedSum,
            pairedWidth,
            delta,
            hasKerning: Math.abs(delta) > 0.05
        };
    }

    /**
     * Draws shaped clusters and glyph boxes onto an HTML Canvas.
     */
    renderClustersToCanvas(canvas, shapedResult) {
        if (!canvas || !shapedResult) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        const width = canvas.clientWidth || 800;
        const height = canvas.clientHeight || 200;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = '#12161f';
        ctx.fillRect(0, 0, width, height);

        const { text, clusters, meta } = shapedResult;
        const fontSize = meta.size || 36;
        const baselineY = Math.round(height * 0.58);
        const startX = 24;

        // Baseline guide line
        ctx.strokeStyle = '#2a3547';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, baselineY);
        ctx.lineTo(width, baselineY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Font settings
        ctx.font = `${meta.italic ? 'italic ' : ''}${meta.weight || 'normal'} ${fontSize}px "${meta.family}", sans-serif`;
        ctx.textBaseline = 'alphabetic';

        let curX = startX;

        // Colors palette for clusters
        const palette = [
            { fill: 'rgba(88, 166, 255, 0.12)', stroke: '#58a6ff', text: '#58a6ff' },
            { fill: 'rgba(63, 185, 80, 0.12)', stroke: '#3fb950', text: '#3fb950' },
            { fill: 'rgba(210, 153, 34, 0.12)', stroke: '#d29922', text: '#d29922' },
            { fill: 'rgba(163, 113, 247, 0.12)', stroke: '#a371f7', text: '#a371f7' },
            { fill: 'rgba(248, 81, 73, 0.12)', stroke: '#f85149', text: '#f85149' },
            { fill: 'rgba(56, 189, 248, 0.12)', stroke: '#38bdf8', text: '#38bdf8' }
        ];

        // Draw each cluster bounding box and info
        clusters.forEach((c, idx) => {
            const color = palette[idx % palette.length];
            const cWidth = c.width || (fontSize * 0.6);
            const boxTop = baselineY - fontSize * 0.85;
            const boxHeight = fontSize * 1.15;

            // Cluster Box
            ctx.fillStyle = c.isLigature ? 'rgba(255, 110, 199, 0.18)' : color.fill;
            ctx.strokeStyle = c.isLigature ? '#ff6ec7' : color.stroke;
            ctx.lineWidth = c.isLigature ? 2 : 1;
            ctx.fillRect(curX, boxTop, cWidth, boxHeight);
            ctx.strokeRect(curX, boxTop, cWidth, boxHeight);

            // Cluster Index Badge
            ctx.fillStyle = c.isLigature ? '#ff6ec7' : color.text;
            ctx.font = '10px monospace';
            ctx.fillText(`#${c.index}`, curX + 3, boxTop - 4);

            // Byte offset indicator
            ctx.fillStyle = '#8b949e';
            ctx.fillText(`b${c.byteStart}–${c.byteEnd}`, curX + 3, boxTop + boxHeight + 14);

            // Ligature tag if applicable
            if (c.isLigature) {
                ctx.fillStyle = '#ff6ec7';
                ctx.fillText('LIG', curX + 3, boxTop + boxHeight + 26);
            }

            curX += cWidth;
        });

        // Draw actual text on top
        ctx.font = `${meta.italic ? 'italic ' : ''}${meta.weight || 'normal'} ${fontSize}px "${meta.family}", sans-serif`;
        ctx.fillStyle = '#f0f6fc';
        ctx.fillText(text, startX, baselineY);
    }
}
