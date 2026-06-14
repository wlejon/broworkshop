// CLIP BPE tokenizer — a faithful JS port of brodiffusion's tokenizer_clip.cpp.
//
// The native pipeline tokenizes the prompt the same way; mirroring it here
// lets the attention panel label each of the 77 context slots with the exact
// token the trace's K dimension refers to. Encode order matches CLIP:
//   [ <|startoftext|>=49406, ...content..., <|endoftext|>=49407, pad... ]
//
// Pre-tokenization is ASCII-focused (lowercase, contraction split, letter
// runs, single digits, punctuation runs) — same approximation the C++ uses,
// exact for English prompts.
  var BOS = 49406, EOS = 49407, MAX_LEN = 77;

  // ── byte ↔ GPT-2/CLIP unicode mapping ────────────────────────────────
  function cpToUtf8(cp, out) {
    if (cp < 0x80) { out.push(cp); }
    else if (cp < 0x800) { out.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) {
      out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    } else {
      out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
               0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    }
  }

  function buildByteToUnicode() {
    var self = new Array(256);
    for (var i = 0; i < 256; i++) self[i] = false;
    function mark(lo, hi) { for (var b = lo; b <= hi; b++) self[b] = true; }
    mark(33, 126); mark(161, 172); mark(174, 255);

    var fwd = new Array(256);   // byte -> binary-string (UTF-8 of mapped cp)
    var rev = {};               // binary-string -> byte
    var next = 256;
    for (var b = 0; b < 256; b++) {
      var cp = self[b] ? b : next++;
      var bytes = [];
      cpToUtf8(cp, bytes);
      var s = String.fromCharCode.apply(null, bytes);
      fwd[b] = s;
      rev[s] = b;
    }
    return { fwd: fwd, rev: rev };
  }

  // A "binary string" carries one byte per char (charCode 0..255), so it can
  // key the vocab/merge maps the same way the C++ std::string does.
  function toBinary(jsStr) {
    var bytes = new TextEncoder().encode(jsStr);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  // Walk a binary string as a sequence of UTF-8 codepoint chunks.
  function splitCodepoints(s) {
    var out = [], i = 0;
    while (i < s.length) {
      var c = s.charCodeAt(i), n = 1;
      if ((c & 0x80) === 0x00) n = 1;
      else if ((c & 0xE0) === 0xC0) n = 2;
      else if ((c & 0xF0) === 0xE0) n = 3;
      else if ((c & 0xF8) === 0xF0) n = 4;
      out.push(s.substr(i, n));
      i += n;
    }
    return out;
  }

  // ── pre-tokenization ─────────────────────────────────────────────────
  function isLetter(c) { return (c >= 97 && c <= 122) || (c >= 65 && c <= 90); }
  function isDigit(c) { return c >= 48 && c <= 57; }
  function isSpace(c) {
    return c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11;
  }

  function asciiLower(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 65 && c <= 90) c += 32;
      out += String.fromCharCode(c);
    }
    return out;
  }

  function collapseWs(s) {
    var out = '', prevSpace = true;
    for (var i = 0; i < s.length; i++) {
      if (isSpace(s.charCodeAt(i))) {
        if (!prevSpace) out += ' ';
        prevSpace = true;
      } else { out += s[i]; prevSpace = false; }
    }
    if (out.length && out[out.length - 1] === ' ') out = out.slice(0, -1);
    return out;
  }

  var CONTRACTIONS = ["'re", "'ve", "'ll", "'s", "'t", "'m", "'d"];
  function matchContraction(s, i) {
    for (var k = 0; k < CONTRACTIONS.length; k++) {
      var c = CONTRACTIONS[k];
      if (s.substr(i, c.length) === c) return c;
    }
    return null;
  }

  function preTokenize(text) {
    var pieces = [], i = 0;
    while (i < text.length) {
      var c = text.charCodeAt(i);
      if (isSpace(c)) { i++; continue; }

      if (c === 39 /* ' */) {
        var ct = matchContraction(text, i);
        if (ct) { pieces.push(ct); i += ct.length; continue; }
      }
      if (isLetter(c)) {
        var j = i;
        while (j < text.length && isLetter(text.charCodeAt(j))) j++;
        pieces.push(text.substring(i, j)); i = j; continue;
      }
      if (isDigit(c)) { pieces.push(text.substr(i, 1)); i++; continue; }

      // run of non-space, non-letter, non-digit
      var k = i;
      while (k < text.length) {
        var u = text.charCodeAt(k);
        if (isSpace(u) || isLetter(u) || isDigit(u)) break;
        if (u === 39 && k !== i && matchContraction(text, k)) break;
        k++;
      }
      pieces.push(text.substring(i, k)); i = k;
    }
    return pieces;
  }

  // ── BPE ──────────────────────────────────────────────────────────────
  function bpe(token, ranks) {
    if (!token) return [];
    var word = splitCodepoints(token);
    if (!word.length) return [];
    word[word.length - 1] += '</w>';
    if (word.length === 1) return word;

    while (true) {
      var bestRank = -1, bestI = 0;
      for (var i = 0; i + 1 < word.length; i++) {
        var r = ranks[word[i] + '\x01' + word[i + 1]];
        if (r !== undefined && (bestRank < 0 || r < bestRank)) {
          bestRank = r; bestI = i;
        }
      }
      if (bestRank < 0) break;
      var a = word[bestI], b = word[bestI + 1], next = [], j = 0;
      while (j < word.length) {
        if (j + 1 < word.length && word[j] === a && word[j + 1] === b) {
          next.push(a + b); j += 2;
        } else { next.push(word[j]); j += 1; }
      }
      word = next;
      if (word.length === 1) break;
    }
    return word;
  }

  // ── Tokenizer object ─────────────────────────────────────────────────
  // vocabText  — raw contents of tokenizer/vocab.json
  // mergesText — raw contents of tokenizer/merges.txt
  function create(vocabText, mergesText) {
    var b2u = buildByteToUnicode();

    var vocab = {};              // binary-string token -> id
    var idToTok = {};            // id -> binary-string token
    var raw = JSON.parse(vocabText);
    for (var key in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
      var bin = toBinary(key);
      var id = raw[key] | 0;
      vocab[bin] = id;
      idToTok[id] = bin;
    }

    var ranks = {};
    var lines = mergesText.split('\n');
    var rank = 0, first = true;
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (line.length && line[line.length - 1] === '\r') line = line.slice(0, -1);
      if (!line) continue;
      if (first) { first = false; if (line[0] === '#') continue; }
      var sp = line.indexOf(' ');
      if (sp < 0) continue;
      var ka = toBinary(line.substring(0, sp));
      var kb = toBinary(line.substring(sp + 1));
      ranks[ka + '\x01' + kb] = rank++;
    }

    function encodePiece(piece, out) {
      if (!piece) return;
      var encoded = '';
      for (var i = 0; i < piece.length; i++) {
        encoded += b2u.fwd[piece.charCodeAt(i)];
      }
      var units = bpe(encoded, ranks);
      for (var u = 0; u < units.length; u++) {
        var id = vocab[units[u]];
        if (id !== undefined) out.push(id);
      }
    }

    // Decode a binary-string vocab token back to displayable text.
    function decodeTok(bin) {
      var endsWord = bin.length >= 4 && bin.slice(-4) === '</w>';
      var core = endsWord ? bin.slice(0, -4) : bin;
      var cps = splitCodepoints(core), bytes = [];
      for (var i = 0; i < cps.length; i++) {
        var byte = b2u.rev[cps[i]];
        if (byte !== undefined) bytes.push(byte);
      }
      var text;
      try { text = new TextDecoder().decode(new Uint8Array(bytes)); }
      catch (e) { text = core; }
      return { text: text, endsWord: endsWord };
    }

    // Content token ids only (no BOS/EOS/padding).
    function tokenize(prompt) {
      var cleaned = collapseWs(asciiLower(toBinary(prompt || '')));
      var pieces = preTokenize(cleaned);
      var ids = [];
      for (var i = 0; i < pieces.length; i++) encodePiece(pieces[i], ids);
      return ids;
    }

    // Full 77-slot context plus a per-token descriptor list. Each content
    // token's `contextIndex` is its column in the cross-attention K axis.
    function encodeContext(prompt) {
      var content = tokenize(prompt);
      var cap = MAX_LEN - 2;
      if (content.length > cap) content = content.slice(0, cap);

      var ids = new Int32Array(MAX_LEN);
      ids[0] = BOS;
      for (var i = 0; i < content.length; i++) ids[i + 1] = content[i];
      var eosIndex = content.length + 1;
      for (var p = eosIndex; p < MAX_LEN; p++) ids[p] = EOS;

      var tokens = [];
      for (var t = 0; t < content.length; t++) {
        var d = decodeTok(idToTok[content[t]] || '');
        tokens.push({
          id: content[t],
          text: d.text,
          endsWord: d.endsWord,
          contextIndex: t + 1,
        });
      }
      return { ids: ids, tokens: tokens, bosIndex: 0, eosIndex: eosIndex };
    }

    return {
      tokenize: tokenize,
      encodeContext: encodeContext,
      vocabCount: function () { return Object.keys(vocab).length; },
      mergeCount: function () { return rank; },
    };
  }

  export const Tokenizer = { create: create, MAX_LEN: MAX_LEN, BOS: BOS, EOS: EOS };
