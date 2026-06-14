// Vision Lab — the image stage.
//
// One in-DOM <canvas> shows the input image, an optional result image (output
// or overlay), and interactive vector layers: SAM prompt points/box, MLSD line
// segments, OpenPose skeletons. Everything is drawn in a single contain-fit
// rect so screen<->image coordinate mapping is one shared transform — which the
// SAM controller needs to turn clicks into original-image pixel prompts.
  // COCO-18 skeleton bone pairs + per-keypoint colours (OpenPose convention).
  var POSE_BONES = [
    [1,2],[1,5],[2,3],[3,4],[5,6],[6,7],[1,8],[8,9],[9,10],
    [1,11],[11,12],[12,13],[1,0],[0,14],[14,16],[0,15],[15,17],
  ];
  var POSE_COLORS = [
    '#ff0000','#ff5500','#ffaa00','#ffff00','#aaff00','#55ff00','#00ff00',
    '#00ff55','#00ffaa','#00ffff','#00aaff','#0055ff','#0000ff','#5500ff',
    '#aa00ff','#ff00ff','#ff00aa','#ff0055',
  ];

  function create(canvasEl) {
    var ctx = canvasEl.getContext('2d');

    var input = null;        // input ImageBitmap (owned by app)
    var result = null;       // result ImageBitmap (owned by app)
    var mode = 'input';      // 'input' | 'output' | 'overlay'
    var opacity = 0.7;
    var vectors = null;      // { kind:'sam'|'mlsd'|'pose', ... } overlay data
    var rect = null;         // last contain-fit rect (screen px)

    function syncSize() {
      var w = canvasEl.clientWidth || (canvasEl.parentElement &&
              canvasEl.parentElement.clientWidth) || 640;
      var h = canvasEl.clientHeight || (canvasEl.parentElement &&
              canvasEl.parentElement.clientHeight) || 480;
      if (canvasEl.width !== w) canvasEl.width = w;
      if (canvasEl.height !== h) canvasEl.height = h;
    }

    // Contain-fit the *input* image inside the drawing buffer. Result images
    // share the input's dimensions (dense maps are same-aspect), so one rect
    // serves both the bitmap draw and the vector overlays.
    function fitRect() {
      var iw = input ? input.width : (result ? result.width : 1);
      var ih = input ? input.height : (result ? result.height : 1);
      var cw = canvasEl.width, ch = canvasEl.height;
      var scale = Math.min(cw / iw, ch / ih);
      var dw = iw * scale, dh = ih * scale;
      return { x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh,
               sx: scale, iw: iw, ih: ih };
    }

    function redraw() {
      syncSize();
      ctx.fillStyle = '#0a0b0f';
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
      if (!input && !result) { rect = null; return; }
      var r = rect = fitRect();
      ctx.imageSmoothingEnabled = true;

      if (mode === 'output' && result) {
        ctx.drawImage(result, r.x, r.y, r.w, r.h);
      } else {
        if (input) ctx.drawImage(input, r.x, r.y, r.w, r.h);
        if (mode === 'overlay' && result) {
          ctx.save();
          ctx.globalAlpha = opacity;
          ctx.drawImage(result, r.x, r.y, r.w, r.h);
          ctx.restore();
        }
      }
      if (vectors) drawVectors(r);
    }

    // image-pixel (x,y) -> screen px
    function toScreen(r, x, y) {
      return { x: r.x + x * r.sx, y: r.y + y * r.sx };
    }
    // screen px -> image-pixel, or null if outside the fit rect
    function toImage(px, py) {
      if (!rect) return null;
      var x = (px - rect.x) / rect.sx, y = (py - rect.y) / rect.sx;
      if (x < 0 || y < 0 || x > rect.iw || y > rect.ih) return null;
      return { x: x, y: y };
    }

    function drawVectors(r) {
      if (vectors.kind === 'sam') drawSamPrompts(r);
      else if (vectors.kind === 'mlsd') drawMlsd(r);
      else if (vectors.kind === 'pose') drawPose(r);
    }

    function drawSamPrompts(r) {
      var pts = vectors.points || [], labels = vectors.labels || [];
      var box = vectors.box;   // image-space [x1,y1,x2,y2] (pending or live drag)
      if (box) {
        var a = toScreen(r, box[0], box[1]), b = toScreen(r, box[2], box[3]);
        ctx.save();
        ctx.strokeStyle = '#4a6cf0'; ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y),
                       Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.restore();
      }
      for (var i = 0; i < pts.length; i++) {
        var s = toScreen(r, pts[i][0], pts[i][1]);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = labels[i] ? '#4fd06a' : '#e0556a';
        ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#0a0b0f'; ctx.stroke();
      }
    }

    function drawMlsd(r) {
      var segs = vectors.segments || [];
      ctx.save();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(240,200,74,0.9)';
      ctx.beginPath();
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        var a = toScreen(r, s.x1, s.y1), b = toScreen(r, s.x2, s.y2);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawPose(r) {
      // keypoints normalized [0,1] over the detect canvas → scale to image dims.
      var bodies = vectors.bodies || [];
      ctx.save();
      for (var bi = 0; bi < bodies.length; bi++) {
        var kp = bodies[bi].keypoints;
        var P = function (i) {
          var k = kp[i];
          if (!k || !k.present) return null;
          return toScreen(r, k.x * r.iw, k.y * r.ih);
        };
        ctx.lineWidth = 3;
        for (var bn = 0; bn < POSE_BONES.length; bn++) {
          var p = P(POSE_BONES[bn][0]), q = P(POSE_BONES[bn][1]);
          if (!p || !q) continue;
          ctx.strokeStyle = POSE_COLORS[bn % POSE_COLORS.length];
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
        for (var ki = 0; ki < kp.length; ki++) {
          var s = P(ki); if (!s) continue;
          ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, 2 * Math.PI);
          ctx.fillStyle = POSE_COLORS[ki % POSE_COLORS.length]; ctx.fill();
        }
      }
      ctx.restore();
    }

    return {
      setInput: function (bmp) { input = bmp; redraw(); },
      setResult: function (bmp) { result = bmp; redraw(); },
      setMode: function (m) { mode = m; redraw(); },
      setOpacity: function (o) { opacity = o; if (mode === 'overlay') redraw(); },
      setVectors: function (v) { vectors = v; redraw(); },
      clearVectors: function () { vectors = null; redraw(); },
      redraw: redraw,
      toImage: toImage,
      hasInput: function () { return !!input; },
    };
  }

  export const Stage = { create: create };
