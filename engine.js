/* Lernapp – kleine Excel-Formel-Engine (deutsche Funktionsnamen, Semikolon als Trenner).
   Rechnet Formeln wie =WENN(F8="gekauft";"OK";"es wird Zeit") oder =SVERWEIS(A15;$A$4:$D$12;2;FALSCH)
   auf einem kleinen Tabellenblatt aus. Wird von checker.js (Antworten prüfen) und app.js (Anzeige) benutzt. */
(function (root) {
  'use strict';

  // ---------- Fehlerwerte ----------
  class XLError {
    constructor(code) { this.code = code; }
    toString() { return this.code; }
  }
  const E = {
    NV: new XLError('#NV'),
    WERT: new XLError('#WERT!'),
    DIV0: new XLError('#DIV/0!'),
    NAME: new XLError('#NAME?'),
    BEZUG: new XLError('#BEZUG!'),
    ZAHL: new XLError('#ZAHL!'),
    ZIRKEL: new XLError('#ZIRKEL!')
  };
  const isErr = (v) => v instanceof XLError;

  class ParseError extends Error {
    constructor(msg, pos, code, extra) {
      super(msg);
      this.pos = pos;
      this.code = code || 'syntax';
      this.extra = extra || {};
    }
  }

  // ---------- Adressen ----------
  function colToNum(s) { let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
  function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  const REF_RE = /^(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]{0,6})$/;
  function parseRef(s) {
    const m = REF_RE.exec(String(s).toUpperCase());
    if (!m) return null;
    return { absC: m[1] === '$', col: colToNum(m[2]), absR: m[3] === '$', row: parseInt(m[4], 10) };
  }
  function refStr(r) { return (r.absC ? '$' : '') + numToCol(r.col) + (r.absR ? '$' : '') + r.row; }
  function addr(col, row) { return numToCol(col) + row; }
  function parseRange(s) {
    const parts = String(s).split(':');
    const a = parseRef(parts[0]);
    const b = parts[1] ? parseRef(parts[1]) : a;
    if (!a || !b) return null;
    return { c1: Math.min(a.col, b.col), r1: Math.min(a.row, b.row), c2: Math.max(a.col, b.col), r2: Math.max(a.row, b.row) };
  }
  function rangeCells(rg) {
    const out = [];
    for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) out.push({ col: c, row: r });
    return out;
  }

  // ---------- Zahlen und Texte (deutsches Format) ----------
  function approxEq(a, b) {
    if (a === b) return true;
    const d = Math.abs(a - b);
    return d <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  function roundHalfAway(x, n) {
    const f = Math.pow(10, n || 0);
    const y = Math.abs(x) * f;
    const r = Math.round(y + 1e-9 * Math.max(1, y));
    return Math.sign(x) * r / f;
  }
  // "1,5" -> 1.5 ; "1.000" -> 1000 ; "12" -> 12 ; sonst null
  function parseNumDE(s) {
    s = String(s).trim();
    if (s === '') return null;
    let m = /^([+-]?)(\d{1,3}(?:\.\d{3})+)(,\d+)?$/.exec(s);
    if (m) return parseFloat(m[1] + m[2].replace(/\./g, '') + (m[3] ? '.' + m[3].slice(1) : ''));
    m = /^([+-]?)(\d*)(,(\d+))?$/.exec(s);
    if (m && (m[2] !== '' || m[4])) return parseFloat(m[1] + (m[2] || '0') + (m[4] ? '.' + m[4] : ''));
    m = /^([+-]?\d+(?:,\d+)?)\s?%$/.exec(s);
    if (m) return parseFloat(m[1].replace(',', '.')) / 100;
    return null;
  }
  function fmtNum(v, dec, thousands) {
    if (!isFinite(v)) return String(v);
    let s;
    if (dec == null) {
      // "Standard"-Format: bis 10 signifikante Nachkommastellen, ohne unnötige Nullen
      const r = Math.round(v * 1e10) / 1e10;
      s = String(r);
      if (/e/i.test(s)) s = r.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
    } else {
      s = roundHalfAway(v, dec).toFixed(dec);
    }
    let [i, f] = s.split('.');
    let neg = false;
    if (i[0] === '-') { neg = true; i = i.slice(1); }
    if (thousands) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const out = (neg && /[1-9]/.test(i + (f || '')) ? '-' : '') + i + (f ? ',' + f : '');
    return out;
  }
  // Excel-Datum (Seriennummer) <-> JS
  function serialToDate(n) { const d = new Date(Date.UTC(1899, 11, 30)); d.setUTCDate(d.getUTCDate() + Math.floor(n)); return d; }
  function dateToSerial(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); }
  function fmtDate(n, long) {
    const d = serialToDate(n);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yy = long ? String(d.getUTCFullYear()) : String(d.getUTCFullYear()).slice(2);
    return dd + '.' + mm + '.' + yy;
  }
  // Anzeige eines Werts mit Zellformat
  function formatValue(v, fmt) {
    if (v === null || v === undefined) return '';
    if (isErr(v)) return v.code;
    if (typeof v === 'boolean') return v ? 'WAHR' : 'FALSCH';
    if (typeof v === 'string') return v;
    switch (fmt) {
      case 'eur': return fmtNum(v, 2, true) + ' €';
      case 'eur0': return fmtNum(v, 0, true) + ' €';
      case 'chf': return fmtNum(v, 2, true) + ' CHF';
      case 'pct': return fmtNum(v * 100, 2, true) + ' %';
      case 'pct0': return fmtNum(v * 100, 0, true) + ' %';
      case 'pct1': return fmtNum(v * 100, 1, true) + ' %';
      case 'dec1': return fmtNum(v, 1, true);
      case 'dec2': return fmtNum(v, 2, true);
      case 'int': return fmtNum(v, 0, true);
      case 'kg': return fmtNum(v, 1, true) + ' kg';
      case 'date': return fmtDate(v, false);
      case 'date4': return fmtDate(v, true);
      case 'days': return fmtNum(v, 0, true);
      default: return fmtNum(v, null, false);
    }
  }
  function toText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? 'WAHR' : 'FALSCH';
    if (isErr(v)) return v.code;
    return fmtNum(v, null, false);
  }

  // ---------- Eingabe säubern ----------
  function normalize(raw) {
    let s = String(raw == null ? '' : raw);
    const notes = [];
    if (/[„“”‟″«»]/.test(s)) notes.push('smartquotes');
    s = s.replace(/[„“”‟″«»]/g, '"');
    s = s.replace(/[‘’‚‛′´`]/g, "'");
    s = s.replace(/[−–—]/g, '-');
    s = s.replace(/×/g, '*').replace(/÷/g, '/');
    s = s.replace(/[   ]/g, ' ');
    s = s.replace(/；/g, ';');
    s = s.trim();
    let out = '';
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') { inStr = !inStr; out += ch; continue; }
      if (!inStr && /\s/.test(ch)) continue;
      out += ch;
    }
    return { text: out, notes };
  }

  // ---------- Tokenizer ----------
  const CMP_OPS = ['=', '<>', '<', '>', '<=', '>='];
  function tokenize(s) {
    const toks = [];
    let i = 0;
    const prevAllowsValue = () => {
      const p = toks[toks.length - 1];
      return !p || p.t === 'op' || p.t === 'lp' || p.t === 'sep' || p.t === 'comma';
    };
    while (i < s.length) {
      const ch = s[i];
      const rest = s.slice(i);
      if (ch === '"') {
        let j = i + 1;
        let val = '';
        for (;;) {
          if (j >= s.length) throw new ParseError('Ein Text ist nicht geschlossen. Es fehlt ein Anführungszeichen ".', i, 'quote');
          if (s[j] === '"') {
            if (s[j + 1] === '"') { val += '"'; j += 2; continue; }
            break;
          }
          val += s[j];
          j++;
        }
        toks.push({ t: 'str', v: val, pos: i, len: j + 1 - i });
        i = j + 1;
        continue;
      }
      if (ch === "'") {
        throw new ParseError("Text gehört in doppelte Anführungszeichen \" – nicht in einfache '.", i, 'singlequote');
      }
      if (/[0-9]/.test(ch) || (ch === ',' && /[0-9]/.test(s[i + 1] || '') && prevAllowsValue())) {
        let txt = (/^[0-9]*(,[0-9]+)?/.exec(rest) || [''])[0];
        let flag = null;
        const md = /^[0-9]+(\.[0-9]+)+/.exec(rest);
        if (md && md[0].length > txt.length) {
          txt = md[0];
          flag = /^\d{1,3}(\.\d{3})+$/.test(txt) ? 'thousands' : 'dot';
        }
        let v;
        if (flag === 'thousands') v = parseFloat(txt.replace(/\./g, ''));
        else if (flag === 'dot') v = parseFloat(txt);
        else v = parseFloat(txt.replace(',', '.'));
        toks.push({ t: 'num', v, pos: i, len: txt.length, flag });
        i += txt.length;
        continue;
      }
      if (ch === '$' || /[A-Za-zÄÖÜäöüß_]/.test(ch)) {
        const m = /^[$A-Za-zÄÖÜäöüß_][$A-Za-z0-9ÄÖÜäöüß_.]*/.exec(rest);
        const word = m[0];
        const up = word.toUpperCase();
        if (s[i + word.length] === '(') {
          toks.push({ t: 'fn', v: up, pos: i, len: word.length, raw: word });
        } else if (REF_RE.test(up)) {
          toks.push({ t: 'ref', v: up, pos: i, len: word.length });
        } else if (up === 'WAHR' || up === 'FALSCH') {
          toks.push({ t: 'bool', v: up === 'WAHR', pos: i, len: word.length });
        } else if (/^\$?[A-Z]{1,3}\$?0+$/.test(up)) {
          throw new ParseError('Zeile 0 gibt es nicht. Zeilen beginnen bei 1.', i, 'row0');
        } else {
          toks.push({ t: 'name', v: word, pos: i, len: word.length });
        }
        i += word.length;
        continue;
      }
      const two = rest.slice(0, 2);
      if (two === '<=' || two === '>=' || two === '<>') { toks.push({ t: 'op', v: two, pos: i, len: 2 }); i += 2; continue; }
      if (two === '=<' || two === '=>' || two === '><') {
        const fix = two === '=<' ? '<=' : two === '=>' ? '>=' : '<>';
        throw new ParseError('Vergleichszeichen in der falschen Reihenfolge: Schreibe ' + fix + ' statt ' + two + '.', i, 'opOrder', { fix, wrong: two });
      }
      if ('+-*/^&=<>'.includes(ch)) { toks.push({ t: 'op', v: ch, pos: i, len: 1 }); i++; continue; }
      if (ch === '%') { toks.push({ t: 'pct', pos: i, len: 1 }); i++; continue; }
      if (ch === '(') { toks.push({ t: 'lp', pos: i, len: 1 }); i++; continue; }
      if (ch === ')') { toks.push({ t: 'rp', pos: i, len: 1 }); i++; continue; }
      if (ch === ';') { toks.push({ t: 'sep', pos: i, len: 1 }); i++; continue; }
      if (ch === ':') { toks.push({ t: 'colon', pos: i, len: 1 }); i++; continue; }
      if (ch === ',') { toks.push({ t: 'comma', pos: i, len: 1 }); i++; continue; }
      if (ch === '!') throw new ParseError('Verweise auf andere Tabellenblätter (mit !) gibt es in dieser Übung nicht.', i, 'sheetref');
      throw new ParseError('Das Zeichen „' + ch + '“ gehört nicht in eine Formel.', i, 'char', { ch });
    }
    return toks;
  }

  // ---------- Parser ----------
  function parse(toks) {
    let p = 0;
    const info = { usedComma: false };
    const peek = () => toks[p];
    const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
    const posOf = () => (toks[p] ? toks[p].pos : (toks.length ? toks[toks.length - 1].pos + toks[toks.length - 1].len : 0));

    function parseComparison() {
      let l = parseConcat();
      while (toks[p] && toks[p].t === 'op' && CMP_OPS.includes(toks[p].v)) {
        const op = toks[p++].v;
        const r = parseConcat();
        l = { k: 'bin', op, l, r };
      }
      return l;
    }
    function parseConcat() {
      let l = parseAdd();
      while (isOp('&')) { p++; l = { k: 'bin', op: '&', l, r: parseAdd() }; }
      return l;
    }
    function parseAdd() {
      let l = parseMul();
      while (isOp('+') || isOp('-')) { const op = toks[p++].v; l = { k: 'bin', op, l, r: parseMul() }; }
      return l;
    }
    function parseMul() {
      let l = parsePow();
      while (isOp('*') || isOp('/')) { const op = toks[p++].v; l = { k: 'bin', op, l, r: parsePow() }; }
      return l;
    }
    function parsePow() {
      let l = parsePct();
      while (isOp('^')) { p++; l = { k: 'bin', op: '^', l, r: parsePct() }; }
      return l;
    }
    function parsePct() {
      let e = parseUnary();
      while (toks[p] && toks[p].t === 'pct') { p++; e = { k: 'pct', e }; }
      return e;
    }
    function parseUnary() {
      if (isOp('-')) { p++; return { k: 'neg', e: parseUnary() }; }
      if (isOp('+')) { p++; return parseUnary(); }
      return parsePrimary();
    }
    function parseArgs(name, fnPos) {
      const args = [];
      // toks[p] ist '('
      p++;
      if (toks[p] && toks[p].t === 'rp') { p++; return args; }
      for (;;) {
        const t = toks[p];
        if (!t) throw new ParseError('Es fehlt eine schließende Klammer ) bei ' + name + '(.', posOf(), 'paren', { fn: name });
        if (t.t === 'sep' || t.t === 'comma' || t.t === 'rp') {
          args.push({ k: 'empty' });
        } else {
          args.push(parseComparison());
        }
        const n = toks[p];
        if (!n) throw new ParseError('Es fehlt eine schließende Klammer ) bei ' + name + '(.', posOf(), 'paren', { fn: name });
        if (n.t === 'sep') { p++; continue; }
        if (n.t === 'comma') { info.usedComma = true; p++; continue; }
        if (n.t === 'rp') { p++; break; }
        if (n.t === 'op' && CMP_OPS.includes(n.v) === false) {
          throw new ParseError('Hier fehlt ein Semikolon ; zwischen den Teilen von ' + name + '(.', n.pos, 'missingSep', { fn: name });
        }
        throw new ParseError('Hier fehlt ein Semikolon ; oder eine Klammer ) bei ' + name + '(.', n.pos, 'missingSep', { fn: name });
      }
      return args;
    }
    function parsePrimary() {
      const t = toks[p];
      if (!t) throw new ParseError('Die Formel hört zu früh auf.', posOf(), 'end');
      switch (t.t) {
        case 'num': p++; return { k: 'num', v: t.v, flag: t.flag };
        case 'str': p++; return { k: 'str', v: t.v };
        case 'bool': p++; return { k: 'bool', v: t.v };
        case 'ref': {
          p++;
          const a = parseRef(t.v);
          if (toks[p] && toks[p].t === 'colon') {
            p++;
            const t2 = toks[p];
            if (!t2 || t2.t !== 'ref') throw new ParseError('Nach dem Doppelpunkt : fehlt die zweite Zelle des Bereichs (z. B. A1:A10).', posOf(), 'range');
            p++;
            return { k: 'range', a, b: parseRef(t2.v) };
          }
          return { k: 'ref', r: a };
        }
        case 'fn': {
          p++;
          const name = t.v;
          const args = parseArgs(name, t.pos);
          return { k: 'fn', name, args, raw: t.raw, pos: t.pos };
        }
        case 'lp': {
          p++;
          const e = parseComparison();
          if (!toks[p] || toks[p].t !== 'rp') throw new ParseError('Es fehlt eine schließende Klammer ).', posOf(), 'paren');
          p++;
          return { k: 'group', e };
        }
        case 'name': {
          p++;
          if (toks[p] && toks[p].t === 'colon') throw new ParseError('„' + t.v + '“ ist keine Zelle. Bereiche schreibt man wie B8:B15.', t.pos, 'badRange');
          return { k: 'name', v: t.v, pos: t.pos };
        }
        case 'op':
          if (CMP_OPS.includes(t.v)) {
            throw new ParseError('Ein Vergleich wie ' + t.v + '… als Suchkriterium muss in Anführungszeichen stehen, z. B. "' + t.v + '100".', t.pos, 'critNoQuotes', { op: t.v });
          }
          throw new ParseError('Hier fehlt ein Wert vor „' + t.v + '“.', t.pos, 'missingValue');
        case 'rp': throw new ParseError('Eine Klammer ) zu viel oder an der falschen Stelle.', t.pos, 'paren');
        case 'sep': throw new ParseError('Hier fehlt ein Wert vor dem Semikolon ;.', t.pos, 'missingValue');
        case 'comma': throw new ParseError('Hier fehlt ein Wert vor dem Komma.', t.pos, 'missingValue');
        case 'colon': throw new ParseError('Vor dem Doppelpunkt : fehlt die erste Zelle des Bereichs.', t.pos, 'range');
        case 'pct': throw new ParseError('Das %-Zeichen steht hinter einer Zahl, z. B. 19%.', t.pos, 'pct');
        default: throw new ParseError('Unerwarteter Teil in der Formel.', t.pos, 'syntax');
      }
    }

    if (!toks.length) throw new ParseError('Die Formel ist leer.', 0, 'empty');
    const ast = parseComparison();
    if (p < toks.length) {
      const t = toks[p];
      if (t.t === 'rp') throw new ParseError('Eine Klammer ) zu viel.', t.pos, 'paren');
      if (t.t === 'sep') throw new ParseError('Das Semikolon ; steht außerhalb einer Funktion. Prüfe die Klammern.', t.pos, 'parenSep');
      if (t.t === 'comma') { throw new ParseError('Das Komma steht an einer Stelle, wo Excel nichts damit anfangen kann. Trenne Funktionsteile mit Semikolon ;.', t.pos, 'comma'); }
      if (t.t === 'lp') throw new ParseError('Vor der Klammer ( fehlt ein Rechenzeichen oder ein Funktionsname.', t.pos, 'missingOp');
      throw new ParseError('Zwischen zwei Teilen fehlt ein Rechenzeichen oder ein Semikolon.', t.pos, 'missingOp');
    }
    ast.info = info;
    return ast;
  }

  // ---------- Bereich als Wert ----------
  class RangeVal {
    constructor(rg, sheet) { this.c1 = rg.c1; this.r1 = rg.r1; this.c2 = rg.c2; this.r2 = rg.r2; this.sheet = sheet; }
    get rows() { return this.r2 - this.r1 + 1; }
    get cols() { return this.c2 - this.c1 + 1; }
    at(i, j) { return this.sheet.value(this.c1 + j, this.r1 + i); }
    *values() { for (let r = this.r1; r <= this.r2; r++) for (let c = this.c1; c <= this.c2; c++) yield this.sheet.value(c, r); }
  }
  const isRange = (v) => v instanceof RangeVal;

  // ---------- Umwandlungen ----------
  function scalar(v) {
    if (isRange(v)) {
      if (v.rows === 1 && v.cols === 1) return v.at(0, 0);
      return E.WERT;
    }
    return v;
  }
  function toNum(v) {
    v = scalar(v);
    if (isErr(v)) return v;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = parseNumDE(v);
    return n === null ? E.WERT : n;
  }
  function toBool(v) {
    v = scalar(v);
    if (isErr(v)) return v;
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const u = String(v).toUpperCase();
    if (u === 'WAHR') return true;
    if (u === 'FALSCH') return false;
    return E.WERT;
  }
  const typeRank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  function cmpText(a, b) {
    const x = a.toLocaleLowerCase('de'), y = b.toLocaleLowerCase('de');
    return x.localeCompare(y, 'de', { sensitivity: 'base' });
  }
  function compare(a, b) {
    if (a === null || a === undefined) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b === null || b === undefined) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    const ta = typeRank(a), tb = typeRank(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (ta === 0) return approxEq(a, b) ? 0 : (a < b ? -1 : 1);
    if (ta === 1) { const c = cmpText(a, b); return c < 0 ? -1 : c > 0 ? 1 : 0; }
    return a === b ? 0 : (a ? 1 : -1);
  }

  // ---------- Suchkriterium (ZÄHLENWENN, SUMMEWENN) ----------
  function wildcardRe(s) {
    let re = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '~' && i + 1 < s.length) { re += s[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++; continue; }
      if (ch === '*') re += '.*';
      else if (ch === '?') re += '.';
      else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$', 'i');
  }
  function makeCriterion(c) {
    c = scalar(c);
    if (isErr(c)) return () => false;
    if (c === null || c === undefined) return (v) => v === null || v === '' || v === 0;
    if (typeof c === 'number') return (v) => typeof v === 'number' && approxEq(v, c);
    if (typeof c === 'boolean') return (v) => v === c;
    let s = String(c);
    let op = '=';
    const m = /^(<=|>=|<>|<|>|=)/.exec(s);
    if (m) { op = m[1]; s = s.slice(op.length); }
    const num = parseNumDE(s);
    if (num !== null && s.trim() !== '') {
      return (v) => {
        if (typeof v !== 'number') return op === '<>';
        const r = approxEq(v, num) ? 0 : (v < num ? -1 : 1);
        switch (op) {
          case '=': return r === 0;
          case '<>': return r !== 0;
          case '<': return r < 0;
          case '>': return r > 0;
          case '<=': return r <= 0;
          default: return r >= 0;
        }
      };
    }
    const sl = s.toUpperCase();
    if (sl === 'WAHR' || sl === 'FALSCH') {
      const b = sl === 'WAHR';
      return (v) => (op === '<>' ? v !== b : v === b);
    }
    const re = wildcardRe(s);
    return (v) => {
      const vs = v === null || v === undefined ? '' : (typeof v === 'string' ? v : null);
      if (op === '=') return vs !== null && (s === '' ? vs === '' : re.test(vs));
      if (op === '<>') return !(vs !== null && (s === '' ? vs === '' : re.test(vs)));
      if (vs === null || vs === '') return false;
      const r = cmpText(vs, s);
      switch (op) {
        case '<': return r < 0;
        case '>': return r > 0;
        case '<=': return r <= 0;
        default: return r >= 0;
      }
    };
  }

  // ---------- Funktionen ----------
  function numbersOf(args, ctx, mode) {
    // mode 'sum': Zahlen aus Bereichen, direkte Argumente werden umgewandelt
    const out = [];
    for (const a of args) {
      if (a.k === 'empty') { out.push(0); continue; }
      const v = ev(a, ctx);
      if (isErr(v)) return v;
      if (isRange(v)) {
        for (const x of v.values()) {
          if (isErr(x)) return x;
          if (typeof x === 'number') out.push(x);
        }
      } else {
        const n = toNum(v);
        if (isErr(n)) return n;
        out.push(n);
      }
    }
    return out;
  }
  function needRange(v) {
    if (isRange(v)) return v;
    return null;
  }
  function boolsOf(args, ctx) {
    const out = [];
    for (const a of args) {
      const v = ev(a, ctx);
      if (isErr(v)) return v;
      if (isRange(v)) {
        for (const x of v.values()) {
          if (isErr(x)) return x;
          if (typeof x === 'boolean') out.push(x);
          else if (typeof x === 'number') out.push(x !== 0);
        }
      } else {
        const b = toBool(v);
        if (isErr(b)) return b;
        out.push(b);
      }
    }
    return out;
  }

  const FN = {
    SUMME(args, ctx) { const n = numbersOf(args, ctx); if (isErr(n)) return n; return n.reduce((s, x) => s + x, 0); },
    MITTELWERT(args, ctx) { const n = numbersOf(args, ctx); if (isErr(n)) return n; if (!n.length) return E.DIV0; return n.reduce((s, x) => s + x, 0) / n.length; },
    MIN(args, ctx) { const n = numbersOf(args, ctx); if (isErr(n)) return n; return n.length ? Math.min(...n) : 0; },
    MAX(args, ctx) { const n = numbersOf(args, ctx); if (isErr(n)) return n; return n.length ? Math.max(...n) : 0; },
    ANZAHL(args, ctx) {
      let c = 0;
      for (const a of args) {
        if (a.k === 'empty') continue;
        const v = ev(a, ctx);
        if (isRange(v)) { for (const x of v.values()) if (typeof x === 'number') c++; }
        else if (typeof v === 'number' || typeof v === 'boolean') c++;
        else if (typeof v === 'string' && parseNumDE(v) !== null) c++;
      }
      return c;
    },
    ANZAHL2(args, ctx) {
      let c = 0;
      for (const a of args) {
        if (a.k === 'empty') continue;
        const v = ev(a, ctx);
        if (isRange(v)) { for (const x of v.values()) if (x !== null && x !== undefined) c++; }
        else c++;
      }
      return c;
    },
    ANZAHLLEEREZELLEN(args, ctx) {
      const v = ev(args[0], ctx);
      if (!isRange(v)) return E.WERT;
      let c = 0;
      for (const x of v.values()) if (x === null || x === undefined || x === '') c++;
      return c;
    },
    RUNDEN(args, ctx) {
      if (args.length < 2) return E.WERT;
      const x = toNum(ev(args[0], ctx)); if (isErr(x)) return x;
      const n = toNum(ev(args[1], ctx)); if (isErr(n)) return n;
      return roundHalfAway(x, Math.trunc(n));
    },
    AUFRUNDEN(args, ctx) {
      const x = toNum(ev(args[0], ctx)); if (isErr(x)) return x;
      const n = args[1] ? toNum(ev(args[1], ctx)) : 0; if (isErr(n)) return n;
      const f = Math.pow(10, Math.trunc(n));
      return Math.sign(x) * Math.ceil(Math.abs(x) * f - 1e-9) / f;
    },
    ABRUNDEN(args, ctx) {
      const x = toNum(ev(args[0], ctx)); if (isErr(x)) return x;
      const n = args[1] ? toNum(ev(args[1], ctx)) : 0; if (isErr(n)) return n;
      const f = Math.pow(10, Math.trunc(n));
      return Math.sign(x) * Math.floor(Math.abs(x) * f + 1e-9) / f;
    },
    ABS(args, ctx) { const x = toNum(ev(args[0], ctx)); return isErr(x) ? x : Math.abs(x); },
    GANZZAHL(args, ctx) { const x = toNum(ev(args[0], ctx)); return isErr(x) ? x : Math.floor(x); },
    REST(args, ctx) {
      const a = toNum(ev(args[0], ctx)); if (isErr(a)) return a;
      const b = toNum(ev(args[1], ctx)); if (isErr(b)) return b;
      if (b === 0) return E.DIV0;
      return a - b * Math.floor(a / b);
    },
    WENN(args, ctx) {
      if (args.length < 1 || args[0].k === 'empty') return E.WERT;
      const c = toBool(ev(args[0], ctx));
      if (isErr(c)) return c;
      if (c) {
        if (args.length < 2) return true;
        if (args[1].k === 'empty') return 0;
        return scalar(ev(args[1], ctx));
      }
      if (args.length < 3) return false;
      if (args[2].k === 'empty') return 0;
      return scalar(ev(args[2], ctx));
    },
    WENNS(args, ctx) {
      for (let i = 0; i + 1 < args.length; i += 2) {
        const c = toBool(ev(args[i], ctx));
        if (isErr(c)) return c;
        if (c) return scalar(ev(args[i + 1], ctx));
      }
      return E.NV;
    },
    WENNFEHLER(args, ctx) {
      const v = scalar(ev(args[0], ctx));
      if (isErr(v)) return args[1] ? scalar(ev(args[1], ctx)) : 0;
      return v;
    },
    UND(args, ctx) { const b = boolsOf(args, ctx); if (isErr(b)) return b; if (!b.length) return E.WERT; return b.every(Boolean); },
    ODER(args, ctx) { const b = boolsOf(args, ctx); if (isErr(b)) return b; if (!b.length) return E.WERT; return b.some(Boolean); },
    NICHT(args, ctx) { const b = toBool(ev(args[0], ctx)); return isErr(b) ? b : !b; },
    WAHR() { return true; },
    FALSCH() { return false; },
    'ZÄHLENWENN'(args, ctx) {
      if (args.length !== 2) return E.WERT;
      const rg = needRange(ev(args[0], ctx));
      if (!rg) return E.WERT;
      const crit = makeCriterion(ev(args[1], ctx));
      let c = 0;
      for (const x of rg.values()) if (crit(x)) c++;
      return c;
    },
    'ZÄHLENWENNS'(args, ctx) {
      if (args.length < 2 || args.length % 2) return E.WERT;
      const pairs = [];
      for (let i = 0; i < args.length; i += 2) {
        const rg = needRange(ev(args[i], ctx));
        if (!rg) return E.WERT;
        pairs.push([rg, makeCriterion(ev(args[i + 1], ctx))]);
      }
      const R = pairs[0][0].rows, C = pairs[0][0].cols;
      if (pairs.some(([rg]) => rg.rows !== R || rg.cols !== C)) return E.WERT;
      let c = 0;
      for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) if (pairs.every(([rg, cr]) => cr(rg.at(i, j)))) c++;
      return c;
    },
    SUMMEWENN(args, ctx) {
      if (args.length < 2 || args.length > 3) return E.WERT;
      const rg = needRange(ev(args[0], ctx));
      if (!rg) return E.WERT;
      const crit = makeCriterion(ev(args[1], ctx));
      let sr = rg;
      if (args.length === 3 && args[2].k !== 'empty') {
        const s = needRange(ev(args[2], ctx));
        if (!s) return E.WERT;
        sr = new RangeVal({ c1: s.c1, r1: s.r1, c2: s.c1 + rg.cols - 1, r2: s.r1 + rg.rows - 1 }, ctx.sheet);
      }
      let sum = 0;
      for (let i = 0; i < rg.rows; i++) for (let j = 0; j < rg.cols; j++) {
        if (crit(rg.at(i, j))) {
          const x = sr.at(i, j);
          if (isErr(x)) return x;
          if (typeof x === 'number') sum += x;
        }
      }
      return sum;
    },
    SUMMEWENNS(args, ctx) {
      if (args.length < 3 || args.length % 2 === 0) return E.WERT;
      const sr = needRange(ev(args[0], ctx));
      if (!sr) return E.WERT;
      const pairs = [];
      for (let i = 1; i < args.length; i += 2) {
        const rg = needRange(ev(args[i], ctx));
        if (!rg || rg.rows !== sr.rows || rg.cols !== sr.cols) return E.WERT;
        pairs.push([rg, makeCriterion(ev(args[i + 1], ctx))]);
      }
      let sum = 0;
      for (let i = 0; i < sr.rows; i++) for (let j = 0; j < sr.cols; j++) {
        if (pairs.every(([rg, cr]) => cr(rg.at(i, j)))) { const x = sr.at(i, j); if (typeof x === 'number') sum += x; }
      }
      return sum;
    },
    MITTELWERTWENN(args, ctx) {
      if (args.length < 2) return E.WERT;
      const rg = needRange(ev(args[0], ctx));
      if (!rg) return E.WERT;
      const crit = makeCriterion(ev(args[1], ctx));
      let sr = rg;
      if (args.length === 3) {
        const s = needRange(ev(args[2], ctx));
        if (!s) return E.WERT;
        sr = new RangeVal({ c1: s.c1, r1: s.r1, c2: s.c1 + rg.cols - 1, r2: s.r1 + rg.rows - 1 }, ctx.sheet);
      }
      let sum = 0, n = 0;
      for (let i = 0; i < rg.rows; i++) for (let j = 0; j < rg.cols; j++) {
        if (crit(rg.at(i, j))) { const x = sr.at(i, j); if (typeof x === 'number') { sum += x; n++; } }
      }
      return n ? sum / n : E.DIV0;
    },
    SVERWEIS(args, ctx) {
      if (args.length < 3 || args.length > 4) return E.WERT;
      const key = scalar(ev(args[0], ctx));
      if (isErr(key)) return key;
      const m = needRange(ev(args[1], ctx));
      if (!m) return E.WERT;
      const idx = toNum(ev(args[2], ctx));
      if (isErr(idx)) return idx;
      const col = Math.trunc(idx);
      if (col < 1) return E.WERT;
      if (col > m.cols) return E.BEZUG;
      let approx = true;
      if (args.length === 4 && args[3].k !== 'empty') {
        const b = toBool(ev(args[3], ctx));
        if (isErr(b)) return b;
        approx = b;
      }
      if (!approx) {
        for (let i = 0; i < m.rows; i++) {
          const v = m.at(i, 0);
          if (v === null || v === undefined) continue;
          if (typeof key === 'string' && typeof v === 'string') {
            if (/[*?]/.test(key) ? wildcardRe(key).test(v) : cmpText(v, key) === 0) { const r = m.at(i, col - 1); return r === null ? 0 : r; }
          } else if (typeof key === typeof v && compare(v, key) === 0) {
            const r = m.at(i, col - 1); return r === null ? 0 : r;
          }
        }
        return E.NV;
      }
      // ungefähre Suche: größter Wert <= Suchkriterium (erste Spalte aufsteigend sortiert)
      let found = -1;
      for (let i = 0; i < m.rows; i++) {
        const v = m.at(i, 0);
        if (v === null || v === undefined) continue;
        if (typeRank(v) !== typeRank(key)) continue;
        if (compare(v, key) <= 0) found = i;
        else break;
      }
      if (found < 0) return E.NV;
      const r = m.at(found, col - 1);
      return r === null ? 0 : r;
    },
    WVERWEIS(args, ctx) {
      if (args.length < 3) return E.WERT;
      const key = scalar(ev(args[0], ctx));
      const m = needRange(ev(args[1], ctx));
      if (!m) return E.WERT;
      const row = Math.trunc(toNum(ev(args[2], ctx)));
      if (row < 1) return E.WERT;
      if (row > m.rows) return E.BEZUG;
      let approx = true;
      if (args.length === 4) approx = toBool(ev(args[3], ctx)) === true;
      let found = -1;
      for (let j = 0; j < m.cols; j++) {
        const v = m.at(0, j);
        if (v === null) continue;
        if (!approx) { if (typeRank(v) === typeRank(key) && compare(v, key) === 0) { found = j; break; } }
        else { if (typeRank(v) !== typeRank(key)) continue; if (compare(v, key) <= 0) found = j; else break; }
      }
      if (found < 0) return E.NV;
      const r = m.at(row - 1, found);
      return r === null ? 0 : r;
    },
    HEUTE(args, ctx) { return ctx.sheet.today != null ? ctx.sheet.today : dateToSerial(2026, 12, 3); },
    JAHR(args, ctx) { const n = toNum(ev(args[0], ctx)); return isErr(n) ? n : serialToDate(n).getUTCFullYear(); },
    MONAT(args, ctx) { const n = toNum(ev(args[0], ctx)); return isErr(n) ? n : serialToDate(n).getUTCMonth() + 1; },
    TAG(args, ctx) { const n = toNum(ev(args[0], ctx)); return isErr(n) ? n : serialToDate(n).getUTCDate(); },
    ISTLEER(args, ctx) { const v = ev(args[0], ctx); const s = scalar(v); return s === null || s === undefined; },
    ISTZAHL(args, ctx) { return typeof scalar(ev(args[0], ctx)) === 'number'; },
    ISTTEXT(args, ctx) { return typeof scalar(ev(args[0], ctx)) === 'string'; },
    VERKETTEN(args, ctx) { return args.map((a) => toText(scalar(ev(a, ctx)))).join(''); },
    'LÄNGE'(args, ctx) { return toText(scalar(ev(args[0], ctx))).length; },
    GROSS(args, ctx) { return toText(scalar(ev(args[0], ctx))).toUpperCase(); },
    KLEIN(args, ctx) { return toText(scalar(ev(args[0], ctx))).toLowerCase(); }
  };
  const ALIASES = { 'ZAEHLENWENN': 'ZÄHLENWENN', 'ZAEHLENWENNS': 'ZÄHLENWENNS', 'LAENGE': 'LÄNGE' };
  const ENGLISH = { SUM: 'SUMME', IF: 'WENN', AND: 'UND', OR: 'ODER', NOT: 'NICHT', COUNTIF: 'ZÄHLENWENN', SUMIF: 'SUMMEWENN',
    VLOOKUP: 'SVERWEIS', AVERAGE: 'MITTELWERT', COUNT: 'ANZAHL', COUNTA: 'ANZAHL2', ROUND: 'RUNDEN', TODAY: 'HEUTE', IFS: 'WENNS',
    COUNTIFS: 'ZÄHLENWENNS', SUMIFS: 'SUMMEWENNS', IFERROR: 'WENNFEHLER', AVERAGEIF: 'MITTELWERTWENN', XLOOKUP: 'XVERWEIS' };
  function canonicalFn(name) { return ALIASES[name] || name; }

  // ---------- Auswerten ----------
  function ev(node, ctx) {
    switch (node.k) {
      case 'num': return node.v;
      case 'str': return node.v;
      case 'bool': return node.v;
      case 'empty': return null;
      case 'group': return ev(node.e, ctx);
      case 'ref': {
        const v = ctx.sheet.value(node.r.col, node.r.row);
        return v;
      }
      case 'range': {
        const rg = { c1: Math.min(node.a.col, node.b.col), r1: Math.min(node.a.row, node.b.row), c2: Math.max(node.a.col, node.b.col), r2: Math.max(node.a.row, node.b.row) };
        return new RangeVal(rg, ctx.sheet);
      }
      case 'name': return E.NAME;
      case 'neg': { const v = toNum(ev(node.e, ctx)); return isErr(v) ? v : -v; }
      case 'pct': { const v = toNum(ev(node.e, ctx)); return isErr(v) ? v : v / 100; }
      case 'bin': {
        const op = node.op;
        if (op === '&') {
          const a = scalar(ev(node.l, ctx)); if (isErr(a)) return a;
          const b = scalar(ev(node.r, ctx)); if (isErr(b)) return b;
          return toText(a) + toText(b);
        }
        if (CMP_OPS.includes(op)) {
          const a = scalar(ev(node.l, ctx)); if (isErr(a)) return a;
          const b = scalar(ev(node.r, ctx)); if (isErr(b)) return b;
          const c = compare(a, b);
          switch (op) {
            case '=': return c === 0;
            case '<>': return c !== 0;
            case '<': return c < 0;
            case '>': return c > 0;
            case '<=': return c <= 0;
            default: return c >= 0;
          }
        }
        const a = toNum(ev(node.l, ctx)); if (isErr(a)) return a;
        const b = toNum(ev(node.r, ctx)); if (isErr(b)) return b;
        switch (op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': return b === 0 ? E.DIV0 : a / b;
          case '^': { const r = Math.pow(a, b); return isFinite(r) ? r : E.ZAHL; }
        }
        return E.WERT;
      }
      case 'fn': {
        const name = canonicalFn(node.name);
        const f = FN[name];
        if (!f) return E.NAME;
        try {
          return f(node.args, ctx);
        } catch (e) {
          return E.WERT;
        }
      }
    }
    return E.WERT;
  }

  // ---------- Formel-Cache ----------
  const astCache = new Map();
  function compile(text) {
    if (astCache.has(text)) return astCache.get(text);
    const n = normalize(text);
    let body = n.text;
    if (body.startsWith('=')) body = body.slice(1);
    const toks = tokenize(body);
    const ast = parse(toks);
    if (astCache.size > 3000) astCache.clear();
    astCache.set(text, ast);
    return ast;
  }
  function evalFormula(text, sheet) {
    let ast;
    try { ast = compile(text); } catch (e) { return E.NAME; }
    let v = ev(ast, { sheet });
    v = scalar(v);
    if (v === null || v === undefined) v = 0;
    return v;
  }
  function evalAst(ast, sheet) {
    let v = scalar(ev(ast, { sheet }));
    if (v === null || v === undefined) v = 0;
    return v;
  }

  // ---------- Tabellenblatt ----------
  // cells: { 'A1': 5 | 'Text' | {v:..., f:'=...', fmt:'eur', ...} }
  class Sheet {
    constructor(cells, opts) {
      this.cells = cells || {};
      this.today = opts && opts.today != null ? opts.today : null;
      this.cache = new Map();
      this.stack = new Set();
    }
    raw(a) { return this.cells[a]; }
    value(col, row) {
      const a = addr(col, row);
      if (this.cache.has(a)) return this.cache.get(a);
      const c = this.cells[a];
      let v;
      if (c === undefined || c === null) v = null;
      else if (typeof c === 'object') {
        if (c.f) {
          if (this.stack.has(a)) return E.ZIRKEL;
          this.stack.add(a);
          v = evalFormula(c.f, this);
          this.stack.delete(a);
        } else v = c.v === undefined ? null : c.v;
      } else v = c;
      if (v === '') v = v; // leere Texte bleiben leer
      this.cache.set(a, v);
      return v;
    }
    valueAt(a) { const r = parseRef(a); return this.value(r.col, r.row); }
    clone(overrides) {
      const cells = Object.assign({}, this.cells);
      if (overrides) for (const k of Object.keys(overrides)) cells[k] = overrides[k];
      return new Sheet(cells, { today: this.today });
    }
  }

  // ---------- Formeln verschieben (Herunterziehen) ----------
  function shiftFormula(text, dr, dc) {
    const n = normalize(text);
    let body = n.text;
    const hasEq = body.startsWith('=');
    if (hasEq) body = body.slice(1);
    const toks = tokenize(body);
    let out = '';
    let last = 0;
    for (const t of toks) {
      if (t.t === 'ref') {
        const r = parseRef(t.v);
        if (!r.absC) r.col += dc;
        if (!r.absR) r.row += dr;
        if (r.col < 1 || r.row < 1) return null;
        out += body.slice(last, t.pos) + refStr(r);
        last = t.pos + t.len;
      }
    }
    out += body.slice(last);
    return (hasEq ? '=' : '') + out;
  }
  function shiftAst(node, dr, dc) {
    const sh = (r) => ({ absC: r.absC, absR: r.absR, col: r.absC ? r.col : r.col + dc, row: r.absR ? r.row : r.row + dr });
    switch (node.k) {
      case 'ref': return { k: 'ref', r: sh(node.r) };
      case 'range': return { k: 'range', a: sh(node.a), b: sh(node.b) };
      case 'group': return { k: 'group', e: shiftAst(node.e, dr, dc) };
      case 'neg': return { k: 'neg', e: shiftAst(node.e, dr, dc) };
      case 'pct': return { k: 'pct', e: shiftAst(node.e, dr, dc) };
      case 'bin': return { k: 'bin', op: node.op, l: shiftAst(node.l, dr, dc), r: shiftAst(node.r, dr, dc) };
      case 'fn': return { k: 'fn', name: node.name, args: node.args.map((a) => shiftAst(a, dr, dc)) };
      default: return node;
    }
  }
  function astValid(node) {
    switch (node.k) {
      case 'ref': return node.r.col >= 1 && node.r.row >= 1;
      case 'range': return node.a.col >= 1 && node.a.row >= 1 && node.b.col >= 1 && node.b.row >= 1;
      case 'group': case 'neg': case 'pct': return astValid(node.e);
      case 'bin': return astValid(node.l) && astValid(node.r);
      case 'fn': return node.args.every(astValid);
      default: return true;
    }
  }

  // ---------- AST -> Formeltext ----------
  const PREC = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
  function numText(v) {
    let s = fmtNum(v, null, false);
    return s;
  }
  function toFormula(node, top) {
    const s = ser(node);
    return top === false ? s : '=' + s;
  }
  function precOf(n) {
    if (n.k === 'bin') return PREC[n.op];
    if (n.k === 'pct') return 6;
    if (n.k === 'neg') return 7;
    return 9;
  }
  function ser(n) {
    switch (n.k) {
      case 'num': return numText(n.v);
      case 'str': return '"' + n.v.replace(/"/g, '""') + '"';
      case 'bool': return n.v ? 'WAHR' : 'FALSCH';
      case 'empty': return '';
      case 'ref': return refStr(n.r);
      case 'range': return refStr(n.a) + ':' + refStr(n.b);
      case 'name': return n.v;
      case 'group': return '(' + ser(n.e) + ')';
      case 'neg': { const s = ser(n.e); return '-' + (precOf(n.e) < 7 ? '(' + s + ')' : s); }
      case 'pct': { const s = ser(n.e); return (precOf(n.e) < 6 ? '(' + s + ')' : s) + '%'; }
      case 'bin': {
        const p = PREC[n.op];
        let l = ser(n.l), r = ser(n.r);
        if (precOf(n.l) < p) l = '(' + l + ')';
        if (precOf(n.r) <= p && n.r.k === 'bin') r = '(' + r + ')';
        return l + n.op + r;
      }
      case 'fn': return n.name + '(' + n.args.map(ser).join(';') + ')';
    }
    return '';
  }

  // ---------- Hilfen für die Prüfung ----------
  function walk(node, fn) {
    fn(node);
    switch (node.k) {
      case 'group': case 'neg': case 'pct': walk(node.e, fn); break;
      case 'bin': walk(node.l, fn); walk(node.r, fn); break;
      case 'fn': node.args.forEach((a) => walk(a, fn)); break;
    }
  }
  function functionsUsed(ast) { const s = new Set(); walk(ast, (n) => { if (n.k === 'fn') s.add(canonicalFn(n.name)); }); return s; }
  function refsUsed(ast) { const out = []; walk(ast, (n) => { if (n.k === 'ref' || n.k === 'range') out.push(n); }); return out; }
  function cloneAst(n) { return JSON.parse(JSON.stringify(n)); }
  function knownFunction(name) { return !!FN[canonicalFn(name)]; }
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i].concat(new Array(n).fill(0)));
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[m][n];
  }
  function suggestFunction(name) {
    const up = String(name).toUpperCase();
    if (ENGLISH[up]) return { name: ENGLISH[up], english: true };
    let best = null, bestD = 99;
    for (const k of Object.keys(FN)) {
      const dd = levenshtein(up, k);
      if (dd < bestD) { bestD = dd; best = k; }
    }
    return bestD <= Math.max(2, Math.floor(up.length / 4)) ? { name: best, english: false } : null;
  }

  const api = {
    XLError, E, isErr, ParseError,
    colToNum, numToCol, parseRef, refStr, addr, parseRange, rangeCells,
    parseNumDE, fmtNum, formatValue, toText, fmtDate, dateToSerial, serialToDate, roundHalfAway, approxEq,
    normalize, tokenize, parse, compile, evalFormula, evalAst, ev,
    Sheet, RangeVal, isRange, shiftFormula, shiftAst, astValid,
    toFormula, ser, walk, functionsUsed, refsUsed, cloneAst, knownFunction, suggestFunction, canonicalFn, levenshtein,
    compare, makeCriterion, FN
  };
  root.XL = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
