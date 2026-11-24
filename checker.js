/* Lernapp – prüft eingegebene Formeln.
   Idee: Die Formel wird nicht als Text verglichen, sondern ausgerechnet – in der Zielzelle, beim Herunterziehen
   (alle Zeilen des Bereichs) und auf veränderten Kopien des Blatts (andere Zahlen, Grenzwerte).
   Stimmt alles mit der Musterlösung überein, ist sie richtig – egal wie sie geschrieben ist.
   Stimmt sie nicht, werden typische Fehler ausprobiert (z. B. $ vergessen, > statt >=, UND statt ODER),
   um einen genauen Hinweis zu geben. */
(function (root) {
  'use strict';
  const XL = root.XL;

  // ---------- Zufall mit festem Startwert (gleiche Varianten bei jedem Versuch) ----------
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  const isErr = XL.isErr;
  // Zahl aus einem Knoten wie 5, 20% oder -3 (sonst null)
  function constVal(n) {
    if (!n) return null;
    if (n.k === 'num') return n.v;
    if (n.k === 'pct') { const v = constVal(n.e); return v === null ? null : v / 100; }
    if (n.k === 'neg') { const v = constVal(n.e); return v === null ? null : -v; }
    if (n.k === 'group') return constVal(n.e);
    return null;
  }
  function rawVal(c) { if (c === undefined || c === null) return null; if (typeof c === 'object') return c.f ? undefined : (c.v === undefined ? null : c.v); return c; }
  function isFormulaCell(c) { return c && typeof c === 'object' && !!c.f; }

  // ---------- Werte vergleichen ----------
  function same(a, b) {
    if (isErr(a) || isErr(b)) return isErr(a) && isErr(b) && a.code === b.code;
    if (typeof a === 'number' && typeof b === 'number') return XL.approxEq(a, b);
    if (typeof a === 'string' && typeof b === 'string') return a.trim().toLocaleLowerCase('de') === b.trim().toLocaleLowerCase('de');
    return a === b;
  }
  function exactCase(a, b) { return !(typeof a === 'string' && typeof b === 'string') || a.trim() === b.trim(); }
  function vecSame(u, s) { if (u.length !== s.length) return false; for (let i = 0; i < u.length; i++) if (!same(u[i], s[i])) return false; return true; }

  // ---------- Fälle (Blatt-Varianten x Zellen des Ausfüllbereichs) ----------
  function solutionRefInfo(ex) {
    // Sammelt, welche Zellen die Musterlösung liest – getrennt nach Rolle.
    const sol = XL.compile(ex.solution);
    const tgt = XL.parseRef(ex.target);
    const fill = ex.fill ? XL.rangeCells(XL.parseRange(ex.fill)) : [{ col: tgt.col, row: tgt.row }];
    const data = new Set();      // Zahlen-/Textzellen, die variiert werden dürfen
    const keys = [];             // Suchkriterien von SVERWEIS: {cells:Set, matrix, approx}
    const crits = new Set();     // Kriterien-Zellen (nicht variieren)
    const fixed = new Set();     // 2D-Bereiche (Nachschlagetabellen) nicht variieren
    const cmps = [];             // Vergleiche ref OP Zahl: {cellsByRow:[addr], k}
    const critStrs = [];         // "ZÄHLENWENN(B:B;">=100")": {cells:[addr], k}
    const cats = new Set();      // Zellen, die wie Kategorien behandelt werden (mischen statt Zahlen verändern)
    for (const fc of fill) {
      const ast = XL.shiftAst(sol, fc.row - tgt.row, fc.col - tgt.col);
      const visit = (n, role) => {
        if (!n) return;
        switch (n.k) {
          case 'ref': {
            const a = XL.addr(n.r.col, n.r.row);
            if (role === 'key' || role === 'crit') { if (role === 'crit') crits.add(a); }
            else data.add(a);
            return;
          }
          case 'range': {
            const rg = { c1: Math.min(n.a.col, n.b.col), r1: Math.min(n.a.row, n.b.row), c2: Math.max(n.a.col, n.b.col), r2: Math.max(n.a.row, n.b.row) };
            const cells = XL.rangeCells(rg).map((c) => XL.addr(c.col, c.row));
            if (rg.c1 !== rg.c2 && rg.r1 !== rg.r2) cells.forEach((a) => fixed.add(a));
            else if (role !== 'crit') cells.forEach((a) => data.add(a));
            return;
          }
          case 'group': case 'neg': case 'pct': visit(n.e, role); return;
          case 'bin': {
            if (['<', '>', '<=', '>='].includes(n.op)) {
              const refSide = n.l.k === 'ref' ? n.l : n.r.k === 'ref' ? n.r : null;
              const k = constVal(n.l) !== null ? constVal(n.l) : constVal(n.r);
              if (refSide && k !== null && !refSide.r.absR) cmps.push({ a: XL.addr(refSide.r.col, refSide.r.row), k, fc });
            }
            visit(n.l, role); visit(n.r, role); return;
          }
          case 'fn': {
            const name = XL.canonicalFn(n.name);
            if (name === 'SVERWEIS' && n.args.length >= 3) {
              const keyArg = n.args[0];
              const m = n.args[1];
              let approx = true;
              if (n.args[3] && n.args[3].k !== 'empty') approx = !(n.args[3].k === 'bool' ? !n.args[3].v : (n.args[3].k === 'num' && n.args[3].v === 0));
              if (keyArg.k === 'ref' && m.k === 'range') keys.push({ a: XL.addr(keyArg.r.col, keyArg.r.row), m, approx });
              else visit(keyArg, role);
              visit(m, role);
              for (let i = 2; i < n.args.length; i++) visit(n.args[i], role);
              return;
            }
            if ((name === 'ZÄHLENWENN' || name === 'SUMMEWENN' || name === 'MITTELWERTWENN') && n.args.length >= 2) {
              visit(n.args[0], role);
              const c = n.args[1];
              // Suchbereich mit Gleichheits-Kriterium: Zahlen darin sind Kennungen (z. B. Art.-Nr.) -> mischen statt verändern
              const isOpCrit = c.k === 'str' && /^(<=|>=|<>|<|>)/.test(c.v);
              const isOpConcat = c.k === 'bin' && c.op === '&';
              if (!isOpCrit && !isOpConcat && n.args[0].k === 'range') {
                const r0 = n.args[0];
                const rg0 = { c1: Math.min(r0.a.col, r0.b.col), r1: Math.min(r0.a.row, r0.b.row), c2: Math.max(r0.a.col, r0.b.col), r2: Math.max(r0.a.row, r0.b.row) };
                XL.rangeCells(rg0).forEach((cc) => cats.add(XL.addr(cc.col, cc.row)));
              }
              if (c.k === 'ref') crits.add(XL.addr(c.r.col, c.r.row));
              else if (c.k === 'str') {
                const mm = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(c.v);
                const k = XL.parseNumDE(mm[2]);
                if (mm[1] && k !== null && n.args[0].k === 'range') critStrs.push({ range: n.args[0], k });
              } else visit(c, 'crit');
              for (let i = 2; i < n.args.length; i++) visit(n.args[i], role);
              return;
            }
            n.args.forEach((x) => visit(x, role));
            return;
          }
          default: return;
        }
      };
      visit(ast, 'data');
    }
    return { sol, tgt, fill, data, keys, crits, fixed, cmps, critStrs, cats };
  }

  function buildCases(ex) {
    if (ex._cases) return ex._cases;
    const info = solutionRefInfo(ex);
    const cells = ex.sheet.cells;
    const base = new XL.Sheet(cells, { today: ex.sheet.today });
    const sheets = [base];
    const R = rng(hashStr(ex.id || ex.solution));
    const noVary = ex.vary === false;
    const keySet = new Set(info.keys.map((k) => k.a));
    if (!noVary) {
      // Zahlen- und Textspalten bestimmen
      const numCells = [], textGroups = new Map();
      for (const a of info.data) {
        if (info.fixed.has(a) || info.crits.has(a) || keySet.has(a)) continue;
        if (ex.keep && ex.keep.includes(a)) continue;
        const c = cells[a];
        if (isFormulaCell(c)) continue;
        const v = rawVal(c);
        if (typeof v === 'number' && !info.cats.has(a)) numCells.push(a);
        else if ((typeof v === 'string' && v !== '') || (typeof v === 'number' && info.cats.has(a))) {
          const col = a.replace(/\d+/g, '');
          if (!textGroups.has(col)) textGroups.set(col, []);
          textGroups.get(col).push(a);
        }
      }
      const variants = ex.variants || 5;
      for (let k = 0; k < variants; k++) {
        const over = {};
        for (const a of numCells) {
          const v = rawVal(cells[a]);
          const isInt = Number.isInteger(v);
          const f = 0.35 + R() * 1.5;
          let nv = v * f + (R() < 0.2 ? (R() < 0.5 ? -1 : 1) : 0);
          if (v >= 0 && nv < 0) nv = Math.abs(nv);
          nv = isInt ? Math.round(nv) : Math.round(nv * 100) / 100;
          over[a] = keepFmt(cells[a], nv);
        }
        for (const [, group] of textGroups) {
          if (group.length < 2) continue;
          const vals = group.map((a) => rawVal(cells[a]));
          for (let i = vals.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; }
          // Sicherstellen, dass sich etwas ändert
          group.forEach((a, i) => { over[a] = keepFmt(cells[a], vals[i]); });
        }
        for (const key of info.keys) {
          const m = key.m;
          const colVals = [];
          for (let r = Math.min(m.a.row, m.b.row); r <= Math.max(m.a.row, m.b.row); r++) {
            const v = rawVal(cells[XL.addr(Math.min(m.a.col, m.b.col), r)]);
            if (v !== null && v !== undefined) colVals.push(v);
          }
          if (!colVals.length) continue;
          if (key.approx && typeof colVals[0] === 'number') {
            const lo = Math.min(...colVals), hi = Math.max(...colVals);
            const isInt = colVals.every(Number.isInteger) && Number.isInteger(rawVal(cells[key.a]));
            let nv = lo + R() * (hi - lo) * 1.3;
            nv = isInt ? Math.round(nv) : Math.round(nv * 10) / 10;
            if (R() < 0.3) nv = colVals[Math.floor(R() * colVals.length)];
            over[key.a] = keepFmt(cells[key.a], nv);
          } else {
            over[key.a] = keepFmt(cells[key.a], colVals[Math.floor(R() * colVals.length)]);
          }
        }
        sheets.push(base.clone(over));
      }
      // Grenzwerte: ref OP k  -> Werte k, k-1, k+1 in den Zeilen
      const byCell = new Map();
      for (const c of info.cmps) {
        const orig = rawVal(cells[c.a]);
        if (typeof orig !== 'number' || info.fixed.has(c.a)) continue;
        if (!byCell.has(c.a)) byCell.set(c.a, new Set());
        const step = Number.isInteger(c.k) && Number.isInteger(orig) ? 1 : 0.01;
        [c.k, c.k - step, c.k + step].forEach((x) => byCell.get(c.a).add(Math.round(x * 100) / 100));
      }
      if (byCell.size) {
        // Werte pro Spalte sammeln und über die Zeilen verteilen
        const colVals = new Map();
        for (const [a, set] of byCell) {
          const col = a.replace(/\d+/g, '');
          if (!colVals.has(col)) colVals.set(col, { cells: new Set(), vals: new Set() });
          colVals.get(col).cells.add(a);
          set.forEach((v) => colVals.get(col).vals.add(v));
        }
        for (let shiftK = 0; shiftK < 3; shiftK++) {
          const over = {};
          for (const [, g] of colVals) {
            const cellsArr = Array.from(g.cells).sort((x, y) => XL.parseRef(x).row - XL.parseRef(y).row);
            const vals = Array.from(g.vals);
            cellsArr.forEach((a, i) => { over[a] = keepFmt(cells[a], vals[(i + shiftK) % vals.length]); });
          }
          sheets.push(base.clone(over));
        }
        // alle genau auf dem Grenzwert / alle darüber / alle darunter (trennt UND, ODER, > und >=)
        for (const mode of [0, 1, -1]) {
          const over = {};
          for (const c of info.cmps) {
            const orig = rawVal(cells[c.a]);
            if (typeof orig !== 'number' || info.fixed.has(c.a)) continue;
            const step = Number.isInteger(c.k) && Number.isInteger(orig) ? 1 : 0.01;
            over[c.a] = keepFmt(cells[c.a], Math.round((c.k + mode * step) * 100) / 100);
          }
          sheets.push(base.clone(over));
        }
      }
      // Grenzwerte in Kriterien wie ">=100"
      for (const cs of info.critStrs) {
        const rg = { c1: Math.min(cs.range.a.col, cs.range.b.col), r1: Math.min(cs.range.a.row, cs.range.b.row), c2: Math.max(cs.range.a.col, cs.range.b.col), r2: Math.max(cs.range.a.row, cs.range.b.row) };
        const list = XL.rangeCells(rg).map((c) => XL.addr(c.col, c.row)).filter((a) => typeof rawVal(cells[a]) === 'number');
        if (list.length < 3) continue;
        const step = Number.isInteger(cs.k) ? 1 : 0.01;
        const over = {};
        over[list[0]] = keepFmt(cells[list[0]], cs.k);
        over[list[1]] = keepFmt(cells[list[1]], cs.k - step);
        over[list[2]] = keepFmt(cells[list[2]], cs.k + step);
        sheets.push(base.clone(over));
      }
    }
    // zusätzliche Fälle aus dem Inhalt (z. B. Bestand genau gleich Mindestbestand)
    for (const ov of ex.cases || []) sheets.push(base.clone(ov));
    ex._cases = { sheets, info };
    return ex._cases;
  }
  function keepFmt(c, v) { if (c && typeof c === 'object') { const o = Object.assign({}, c); o.v = v; delete o.f; return o; } return v; }

  // Vektor aller Ergebnisse einer Formel (AST) über alle Fälle
  function vector(ast, ex) {
    const { sheets, info } = buildCases(ex);
    const out = [];
    for (const s of sheets) {
      for (const fc of info.fill) {
        const sh = XL.shiftAst(ast, fc.row - info.tgt.row, fc.col - info.tgt.col);
        if (!XL.astValid(sh)) { out.push(XL.E.BEZUG); continue; }
        s.cache.clear();
        out.push(XL.evalAst(sh, s));
      }
    }
    return out;
  }
  function baseVector(ast, ex) {
    const { sheets, info } = buildCases(ex);
    const s = sheets[0];
    return info.fill.map((fc) => {
      const sh = XL.shiftAst(ast, fc.row - info.tgt.row, fc.col - info.tgt.col);
      if (!XL.astValid(sh)) return XL.E.BEZUG;
      return XL.evalAst(sh, s);
    });
  }

  // ---------- typische Fehler als "Mutanten" der Musterlösung ----------
  const OP_TEXT = { '>': 'größer als', '<': 'kleiner als', '>=': 'größer oder gleich (ab / mindestens)', '<=': 'kleiner oder gleich (bis / höchstens)', '=': 'gleich', '<>': 'ungleich' };
  function mutants(ex) {
    if (ex._mutants) return ex._mutants;
    const sol = XL.compile(ex.solution);
    const list = [];
    const add = (ast, mid, hint) => { try { list.push({ ast, mid, hint }); } catch (e) { /* ignorieren */ } };
    // Fehler aus dem Inhalt zuerst (genauere Hinweise)
    for (const m of ex.mistakes || []) {
      try { add(XL.compile(m.f), m.mid || 'sonstiges', m.hint || ''); } catch (e) { /* ungültig */ }
    }
    // Alle Knoten durchnummerieren, damit wir gezielt einen ändern können
    const nodes = [];
    XL.walk(sol, (n) => nodes.push(n));
    const mutate = (idx, fn) => {
      const copy = XL.cloneAst(sol);
      const cn = [];
      XL.walk(copy, (n) => cn.push(n));
      fn(cn[idx], copy);
      return copy;
    };
    nodes.forEach((n, i) => {
      if (n.k === 'bin' && ['<', '>', '<=', '>='].includes(n.op)) {
        const swapEq = { '>': '>=', '>=': '>', '<': '<=', '<=': '<' }[n.op];
        add(mutate(i, (m) => { m.op = swapEq; }), 'grenze',
          'Prüfe den Grenzfall: Hier gehört „' + n.op + '“ hin (' + OP_TEXT[n.op] + '), nicht „' + swapEq + '“. Teste im Kopf genau den Grenzwert.');
        const flip = { '>': '<', '<': '>', '>=': '<=', '<=': '>=' }[n.op];
        add(mutate(i, (m) => { m.op = flip; }), 'vergleich-richtung',
          'Das Vergleichszeichen zeigt in die falsche Richtung: Gesucht ist „' + n.op + '“ (' + OP_TEXT[n.op] + ').');
        const flip2 = { '>': '<=', '<': '>=', '>=': '<', '<=': '>' }[n.op];
        add(mutate(i, (m) => { m.op = flip2; }), 'dann-sonst',
          'Deine Bedingung ist genau umgedreht. Entweder Vergleichszeichen umkehren oder Dann- und Sonst-Wert tauschen.');
      }
      if (n.k === 'bin' && (n.op === '=' || n.op === '<>')) {
        add(mutate(i, (m) => { m.op = n.op === '=' ? '<>' : '='; }), 'dann-sonst', 'Deine Bedingung ist genau umgedreht (= statt <> oder umgekehrt).');
      }
      if (n.k === 'fn') {
        const name = XL.canonicalFn(n.name);
        if (name === 'UND' || name === 'ODER') {
          const other = name === 'UND' ? 'ODER' : 'UND';
          add(mutate(i, (m) => { m.name = other; }), 'und-oder',
            name === 'ODER' ? 'Hier reicht es, wenn EINE Bedingung stimmt – das ist ODER, nicht UND.' : 'Hier müssen ALLE Bedingungen stimmen – das ist UND, nicht ODER.');
        }
        if (name === 'WENN' && n.args.length === 3) {
          add(mutate(i, (m) => { const t = m.args[1]; m.args[1] = m.args[2]; m.args[2] = t; }), 'dann-sonst',
            'Dann-Wert und Sonst-Wert sind vertauscht: Zuerst kommt, was passiert, wenn die Bedingung WAHR ist.');
          // verschachteltes WENN: Reihenfolge der Bedingungen
          const inner = n.args[2];
          if (inner.k === 'fn' && XL.canonicalFn(inner.name) === 'WENN' && inner.args.length === 3) {
            add(mutate(i, (m) => {
              const inn = m.args[2];
              const c1 = m.args[0], v1 = m.args[1], c2 = inn.args[0], v2 = inn.args[1];
              m.args[0] = c2; m.args[1] = v2; inn.args[0] = c1; inn.args[1] = v1;
            }), 'verschachtelt-reihenfolge',
            'Die Reihenfolge der Bedingungen stimmt nicht. Excel prüft von links nach rechts und nimmt den ersten Treffer – prüfe zuerst die strengste Bedingung (z. B. erst ≥ 5, dann ≥ 3).');
          }
        }
        if (name === 'SUMMEWENN') {
          if (n.args.length === 3) {
            add(mutate(i, (m) => { const t = m.args[0]; m.args[0] = m.args[2]; m.args[2] = t; }), 'sw-reihenfolge',
              'Bei SUMMEWENN kommt zuerst der Bereich, in dem gesucht wird, dann das Kriterium und zuletzt der Bereich, der addiert wird.');
            add(mutate(i, (m) => { m.args.pop(); }), 'sw-ohne-summe',
              'Bei SUMMEWENN fehlt der dritte Teil: der Bereich, der addiert werden soll (Summe_Bereich).');
            add(mutate(i, (m) => { m.name = 'ZÄHLENWENN'; m.args.pop(); }), 'zw-sw',
              'Hier soll addiert werden (SUMMEWENN), nicht gezählt (ZÄHLENWENN).');
          }
        }
        if (name === 'ZÄHLENWENN' && n.args.length === 2) {
          add(mutate(i, (m) => { m.name = 'SUMMEWENN'; }), 'zw-sw', 'Hier soll gezählt werden, wie oft etwas vorkommt (ZÄHLENWENN), nicht addiert (SUMMEWENN).');
        }
        if (name === 'SVERWEIS' && n.args.length >= 3) {
          const isFalse = n.args[3] && ((n.args[3].k === 'bool' && !n.args[3].v) || (n.args[3].k === 'num' && n.args[3].v === 0));
          if (isFalse) {
            add(mutate(i, (m) => { m.args[3] = { k: 'bool', v: true }; }), 'sv-falsch',
              'Für eine genaue Suche braucht SVERWEIS als 4. Teil FALSCH. Mit WAHR (oder ohne 4. Teil) sucht Excel nur ungefähr.');
            add(mutate(i, (m) => { m.args.length = 3; }), 'sv-falsch',
              'Der 4. Teil fehlt: Ohne FALSCH sucht SVERWEIS nur ungefähr. Für eine genaue Suche: ;FALSCH am Ende.');
          } else {
            add(mutate(i, (m) => { m.args[3] = { k: 'bool', v: false }; }), 'sv-wahr',
              'Hier gibt es keine exakten Treffer, sondern Stufen (z. B. „ab 5 kg“). Dafür braucht SVERWEIS WAHR (ungefähre Suche).');
          }
          const idxArg = n.args[2];
          if (idxArg.k === 'num') {
            const v = idxArg.v;
            add(mutate(i, (m) => { m.args[2] = { k: 'num', v: v + 1 }; }), 'sv-spalte', 'Der Spaltenindex ist um eins zu groß. Zähle die Spalten in der Matrix: Die erste Spalte (mit dem Suchwert) ist 1.');
            if (v > 1) add(mutate(i, (m) => { m.args[2] = { k: 'num', v: v - 1 }; }), 'sv-spalte', 'Der Spaltenindex ist um eins zu klein. Die erste Spalte der Matrix (mit dem Suchwert) zählt schon als 1.');
            const mat = n.args[1];
            if (mat.k === 'range') {
              const c1 = Math.min(mat.a.col, mat.b.col);
              if (c1 > 1) add(mutate(i, (m) => { m.args[2] = { k: 'num', v: v + c1 - 1 }; }), 'sv-spalte-a',
                'Der Spaltenindex zählt ab dem Anfang der Matrix, nicht ab Spalte A. Die erste Spalte der Matrix ist 1.');
            }
          }
        }
      }
    });
    // alle Vergleiche auf einmal umgedreht bzw. alle Grenzen verschoben
    const cmpCount = nodes.filter((n) => n.k === 'bin' && ['<', '>', '<=', '>='].includes(n.op)).length;
    if (cmpCount > 1) {
      const flipAll = XL.cloneAst(sol);
      XL.walk(flipAll, (n) => { if (n.k === 'bin' && ['<', '>', '<=', '>='].includes(n.op)) n.op = { '>': '<', '<': '>', '>=': '<=', '<=': '>=' }[n.op]; });
      add(flipAll, 'vergleich-richtung', 'Deine Vergleichszeichen zeigen in die falsche Richtung. Setze eine Beispielzahl ein und prüfe, ob WAHR herauskommt (bei Noten: schlechter als 4 heißt >4).');
      const edgeAll = XL.cloneAst(sol);
      XL.walk(edgeAll, (n) => { if (n.k === 'bin' && ['<', '>', '<=', '>='].includes(n.op)) n.op = { '>': '>=', '>=': '>', '<': '<=', '<=': '<' }[n.op]; });
      add(edgeAll, 'grenze', 'Prüfe die Grenzfälle: „ab / mindestens“ heißt >=, „mehr als / über“ heißt >, „bis / höchstens“ heißt <=, „unter“ heißt <.');
    }
    // $ vergessen: alle Bezüge relativ
    const rel = XL.cloneAst(sol);
    let hadAbs = false;
    XL.walk(rel, (n) => {
      if (n.k === 'ref' && (n.r.absC || n.r.absR)) { hadAbs = true; n.r.absC = false; n.r.absR = false; }
      if (n.k === 'range') { if (n.a.absC || n.a.absR || n.b.absC || n.b.absR) hadAbs = true; n.a.absC = n.a.absR = n.b.absC = n.b.absR = false; }
    });
    if (hadAbs && ex.fill) add(rel, 'dollar', 'Beim Herunterziehen verrutschen deine Bereiche. Halte feste Bereiche und Zellen mit $ fest, z. B. $B$8:$B$15.');
    // Prozent mal 100
    add({ k: 'bin', op: '*', l: { k: 'group', e: XL.cloneAst(sol) }, r: { k: 'num', v: 100 } }, 'prozent', '');
    ex._mutants = list;
    return list;
  }

  // ---------- Syntaxfehler in Hinweise übersetzen ----------
  const SYNTAX_MID = { critNoQuotes: 'krit-anf', quote: 'anfuehrung', singlequote: 'anfuehrung', paren: 'klammer', parenSep: 'klammer', missingSep: 'semikolon', comma: 'semikolon', opOrder: 'op-reihenfolge', range: 'bereich', badRange: 'bereich' };
  function syntaxResult(e, text) {
    const mid = SYNTAX_MID[e.code] || 'syntax';
    const msgs = [e.message];
    // Klammern zählen
    const open = (text.match(/\(/g) || []).length, close = (text.match(/\)/g) || []).length;
    if ((e.code === 'paren' || e.code === 'end') && open !== close) msgs.push('Du hast ' + open + '× „(“ und ' + close + '× „)“ – es müssen gleich viele sein.');
    if (e.code === 'missingSep' && /"[^"]*;[^"]*"/.test(text)) msgs.push('Tipp: Steht das Semikolon vielleicht innerhalb der Anführungszeichen? Jeder Text braucht ein " am Anfang und am Ende.');
    return { status: 'syntax', title: 'Excel würde diese Formel nicht annehmen', msgs, mids: [mid], pos: e.pos };
  }

  // ---------- Hauptfunktion ----------
  function checkFormula(ex, input, opts) {
    opts = opts || {};
    const n = XL.normalize(input);
    let text = n.text;
    if (!text) return { status: 'leer', title: 'Noch leer', msgs: ['Gib zuerst eine Formel ein.'], mids: [] };
    // UND / ODER als Wort zwischen zwei Bedingungen (z. B. B3>4 ODER B4>4)
    const noStr = String(input).toUpperCase().replace(/"[^"]*("|$)/g, '""');
    const mw = /(^|[^A-ZÄÖÜ])(UND|ODER)(?!\s*\()/.exec(noStr);
    if (mw) {
      const w = mw[2];
      return { status: 'syntax', title: 'UND/ODER sind Funktionen', mids: ['und-oder-syntax'],
        msgs: [w + ' schreibt man nicht zwischen die Bedingungen. Richtig: ' + w + '(Bedingung1;Bedingung2), z. B. =WENN(' + w + '(B3>4;B4>4);"…";"…").'] };
    }
    const style = [];
    if (!text.startsWith('=')) {
      if (/^[+-]?\d+([.,]\d+)?$/.test(text)) {
        return { status: 'falsch', title: 'Das ist eine Zahl, keine Formel', msgs: ['Gefragt ist die Formel, die Excel rechnen lässt. Eine Formel beginnt mit = und benutzt Zellbezüge.'], mids: ['konstante'] };
      }
      style.push({ mid: 'gleich', msg: 'Eine Formel beginnt immer mit =. Ohne = hält Excel deine Eingabe für Text.' });
      text = '=' + text;
    }
    let ast;
    try { ast = XL.compile(text); } catch (e) { if (e instanceof XL.ParseError) return syntaxResult(e, text); throw e; }
    if (ast.info && ast.info.usedComma) style.push({ mid: 'semikolon', msg: 'In deutschem Excel trennt man die Teile einer Funktion mit Semikolon ; – nicht mit Komma.' });
    XL.walk(ast, (x) => {
      if (x.k === 'num' && x.flag === 'dot') style.push({ mid: 'komma-zahl', msg: 'Dezimalzahlen schreibt man im deutschen Excel mit Komma: 0,15 statt 0.15.' });
      if (x.k === 'num' && x.flag === 'thousands') style.push({ mid: 'tausender', msg: 'In Formeln schreibt man Zahlen ohne Tausenderpunkt: 10000 statt 10.000.' });
    });
    // unbekannte Funktionen
    let unknown = null;
    XL.walk(ast, (x) => { if (!unknown && x.k === 'fn' && !XL.knownFunction(x.name)) unknown = x.name; });
    if (unknown) {
      const sug = XL.suggestFunction(unknown);
      return { status: 'falsch', title: 'Diese Funktion kennt Excel nicht', mids: ['fn-name'],
        msgs: ['„' + unknown + '“ gibt es nicht.' + (sug ? (sug.english ? ' Im deutschen Excel heißt sie ' + sug.name + '.' : ' Meinst du ' + sug.name + '?') : '')] };
    }
    // Text ohne Anführungszeichen (oder Funktion ohne Klammern)
    let name = null;
    XL.walk(ast, (x) => { if (!name && x.k === 'name') name = x.v; });
    if (name && XL.knownFunction(name.toUpperCase())) {
      return { status: 'syntax', title: 'Klammern fehlen', mids: ['klammer'],
        msgs: ['Nach einem Funktionsnamen kommen immer Klammern, z. B. ' + name.toUpperCase() + '(' + (name.toUpperCase() === 'HEUTE' ? '' : '…') + ').'] };
    }
    if (name && /^(UND|ODER)$/i.test(name)) {
      return { status: 'syntax', title: 'UND/ODER sind Funktionen', mids: ['und-oder-syntax'],
        msgs: ['UND und ODER schreibt man wie eine Funktion: ODER(Bedingung1;Bedingung2).'] };
    }
    // Bereich mit Minus oder Semikolon statt Doppelpunkt (z. B. SUMME(B5-B14))
    let rangeHint = null;
    XL.walk(ast, (x) => {
      if (rangeHint || x.k !== 'fn') return;
      const nm = XL.canonicalFn(x.name);
      if (!['SUMME', 'MITTELWERT', 'MIN', 'MAX', 'ANZAHL', 'ANZAHL2', 'ZÄHLENWENN', 'SUMMEWENN'].includes(nm)) return;
      for (const a of x.args) {
        if (a.k === 'bin' && a.op === '-' && a.l.k === 'ref' && a.r.k === 'ref') { rangeHint = XL.refStr(a.l.r) + ':' + XL.refStr(a.r.r); return; }
      }
    });
    if (rangeHint) {
      return { status: 'falsch', title: 'Bereich falsch geschrieben', mids: ['bereich'],
        msgs: ['Ein Bereich wird mit Doppelpunkt geschrieben: ' + rangeHint + '. Mit Minus rechnet Excel die eine Zelle minus die andere.'] };
    }
    if (name) {
      return { status: 'falsch', title: 'Text ohne Anführungszeichen', mids: ['text-anf'],
        msgs: ['„' + name + '“ ist für Excel weder eine Zahl noch eine Zelle. Text muss in Anführungszeichen stehen: "' + name + '".'] };
    }
    // Ausrechnen
    const solAst = XL.compile(ex.solution);
    const sVec = vector(solAst, ex);
    const uVec = vector(ast, ex);
    const { info } = buildCases(ex);
    const nFill = info.fill.length;
    const uBase = uVec.slice(0, nFill), sBase = sVec.slice(0, nFill);
    const tIdx = info.fill.findIndex((c) => c.col === info.tgt.col && c.row === info.tgt.row);
    const show = { got: uBase[tIdx], exp: sBase[tIdx] };

    if (vecSame(uVec, sVec)) {
      const msgs = [];
      const mids = [];
      let status = 'richtig';
      if (ex.requireFn && ex.requireFn.length) {
        const used = XL.functionsUsed(ast);
        const missing = ex.requireFn.filter((f) => !used.has(f));
        if (missing.length) { status = 'fast'; msgs.push('Rechnet richtig – aber die Aufgabe verlangt ' + missing.join(' und ') + '. In der Klausur gäbe das Abzug.'); }
      }
      if (style.length) { status = 'fast'; style.forEach((s) => { msgs.push(s.msg); mids.push(s.mid); }); }
      let caseNote = false;
      for (let i = 0; i < uVec.length; i++) if (!exactCase(uVec[i], sVec[i])) { caseNote = true; break; }
      if (caseNote) msgs.push('Achte auf die genaue Schreibweise des Textes (Groß-/Kleinschreibung), wie in der Aufgabe.');
      return { status, title: status === 'richtig' ? 'Richtig' : 'Fast richtig', msgs, mids, show };
    }

    // Prozent: *100 oder /100
    const times = (vec, f) => vec.map((v) => (typeof v === 'number' ? v * f : v));
    if (vecSame(uVec, times(sVec, 100)) || vecSame(times(uVec, 100), sVec)) {
      if (ex.pct) {
        const withHundred = vecSame(uVec, times(sVec, 100));
        return { status: 'richtig', title: 'Richtig', mids: [], show,
          msgs: [withHundred
            ? 'Mit *100 bekommst du die Prozentzahl als normale Zahl (z. B. 24,55). Ist die Zelle als Prozent formatiert, lässt man *100 weg.'
            : 'Ohne *100 musst du die Zelle als Prozent (%) formatieren, damit 24,55 % angezeigt wird.'] };
      }
      return { status: 'falsch', title: 'Fast: Faktor 100', mids: ['prozent'], show,
        msgs: ['Dein Ergebnis ist genau 100-mal zu groß oder zu klein. Prüfe *100 bzw. das Prozentformat.'] };
    }

    // Feste Werte statt Zellbezügen?
    const konst = constantProblem(ex, ast, solAst);
    if (konst) return { status: 'falsch', title: konst.title, mids: ['konstante'], show, msgs: [konst.msg] };

    // $ vergessen? -> Bezüge im Benutzer-Ast festhalten und neu prüfen
    if (ex.fill && same(uBase[tIdx], sBase[tIdx])) {
      const fixes = [];
      const all = XL.cloneAst(ast);
      XL.walk(all, (x) => { if (x.k === 'range') { x.a.absC = x.a.absR = x.b.absC = x.b.absR = true; } });
      fixes.push({ ast: all, what: 'Bereiche' });
      const singles = [];
      XL.walk(ast, (x) => { if (x.k === 'ref' && !(x.r.absC && x.r.absR)) singles.push(x); });
      singles.forEach((sref, i) => {
        const c = XL.cloneAst(ast);
        let j = -1;
        XL.walk(c, (x) => { if (x.k === 'ref' && !(x.r.absC && x.r.absR)) { j++; if (j === i) { x.r.absC = true; x.r.absR = true; } } });
        fixes.push({ ast: c, what: XL.refStr(sref.r) });
      });
      // zu viele $: eine feste Zelle soll eigentlich mitwandern
      const absSingles = [];
      XL.walk(ast, (x) => { if (x.k === 'ref' && x.r.absR) absSingles.push(x); });
      absSingles.forEach((sref, i) => {
        const c = XL.cloneAst(ast);
        let j = -1;
        XL.walk(c, (x) => { if (x.k === 'ref' && x.r.absR) { j++; if (j === i) { x.r.absC = false; x.r.absR = false; } } });
        fixes.push({ ast: c, what: XL.refStr(sref.r), tooMuch: true });
      });
      for (const fx of fixes) {
        if (vecSame(vector(fx.ast, ex), sVec)) {
          let msg;
          if (fx.tooMuch) {
            const r = XL.parseRef(fx.what.replace(/\$/g, ''));
            msg = 'In ' + ex.target + ' stimmt es – aber ' + fx.what + ' soll beim Herunterziehen mitwandern (jede Zeile hat ihren eigenen Wert). Schreibe es ohne $: ' + XL.refStr(r) + '.';
          } else if (fx.what === 'Bereiche') {
            const ranges = [];
            XL.walk(ast, (x) => { if (x.k === 'range' && !(x.a.absR && x.b.absR)) ranges.push(XL.refStr(x.a) + ':' + XL.refStr(x.b)); });
            const r0 = ranges[0] || '';
            const fixed = r0 ? r0.split(':').map((p) => { const r = XL.parseRef(p); r.absC = true; r.absR = true; return XL.refStr(r); }).join(':') : '';
            msg = 'In ' + ex.target + ' stimmt es – aber beim Herunterziehen verrutscht der Bereich' + (r0 ? ' ' + r0 : '') + '. Halte ihn mit $ fest' + (fixed ? ': ' + fixed : '') + '.';
          } else {
            const r = XL.parseRef(fx.what); r.absC = true; r.absR = true;
            msg = 'In ' + ex.target + ' stimmt es – aber beim Herunterziehen verrutscht ' + fx.what + '. Diese Zelle muss fest bleiben: ' + XL.refStr(r) + '.';
          }
          return { status: 'fast', title: 'Fast: $ fehlt', mids: ['dollar'], show, msgs: [msg], fillProblem: true };
        }
      }
    }

    // Typische Fehler (Mutanten) vergleichen – bei mehreren Treffern den ähnlichsten nehmen
    const userSer = XL.ser(ast).toUpperCase();
    let bestM = null, bestD = Infinity;
    for (const m of mutants(ex)) {
      if (m.mid === 'prozent') continue;
      let mv;
      try { mv = vector(m.ast, ex); } catch (e) { continue; }
      if (vecSame(uVec, mv) && !vecSame(mv, sVec)) {
        const d = XL.levenshtein(userSer, XL.ser(m.ast).toUpperCase());
        if (d < bestD) { bestD = d; bestM = m; }
      }
    }
    if (bestM) {
      return { status: 'falsch', title: 'Typischer Fehler', mids: [bestM.mid], show, msgs: [bestM.hint || 'Das ist ein typischer Fehler bei dieser Aufgabe.'] };
    }

    // Funktionen verwechselt (auch wenn sonst noch etwas anders ist)
    const fs = XL.functionsUsed(solAst), fu = XL.functionsUsed(ast);
    if (fs.has('ZÄHLENWENN') && !fs.has('SUMMEWENN') && fu.has('SUMMEWENN') && !fu.has('ZÄHLENWENN')) {
      return { status: 'falsch', title: 'Zählen oder addieren?', mids: ['zw-sw'], show, msgs: ['Gefragt ist, WIE VIELE es sind – das zählt ZÄHLENWENN. SUMMEWENN würde Werte addieren.'] };
    }
    if (fs.has('SUMMEWENN') && !fs.has('ZÄHLENWENN') && fu.has('ZÄHLENWENN') && !fu.has('SUMMEWENN')) {
      return { status: 'falsch', title: 'Zählen oder addieren?', mids: ['zw-sw'], show, msgs: ['Gefragt ist eine SUMME (z. B. Euro oder Stück) – das macht SUMMEWENN. ZÄHLENWENN zählt nur, wie oft etwas vorkommt.'] };
    }
    if (fs.has('UND') && !fs.has('ODER') && fu.has('ODER') && !fu.has('UND')) {
      return { status: 'falsch', title: 'UND oder ODER?', mids: ['und-oder'], show, msgs: ['Hier müssen ALLE Bedingungen erfüllt sein – das ist UND. Bei ODER reicht schon eine.'] };
    }
    if (fs.has('ODER') && !fs.has('UND') && fu.has('UND') && !fu.has('ODER')) {
      return { status: 'falsch', title: 'UND oder ODER?', mids: ['und-oder'], show, msgs: ['Hier reicht es, wenn EINE Bedingung stimmt – das ist ODER. UND verlangt, dass alle stimmen.'] };
    }
    if (fs.has('SVERWEIS') && fu.has('SVERWEIS')) {
      const fourth = (a) => { let r = null; XL.walk(a, (x) => { if (r === null && x.k === 'fn' && XL.canonicalFn(x.name) === 'SVERWEIS') r = x.args[3] ? (x.args[3].k === 'bool' ? x.args[3].v : x.args[3].k === 'num' ? x.args[3].v !== 0 : null) : true; }); return r; };
      const sf = fourth(solAst), uf = fourth(ast);
      if (sf === false && uf === true) return { status: 'falsch', title: 'Genaue Suche fehlt', mids: ['sv-falsch'], show, msgs: ['Für eine genaue Suche braucht SVERWEIS am Ende FALSCH. Ohne FALSCH (oder mit WAHR) sucht Excel nur ungefähr.'] };
      if (sf === true && uf === false) return { status: 'falsch', title: 'Stufen brauchen WAHR', mids: ['sv-wahr'], show, msgs: ['Die Tabelle enthält Stufen – der genaue Wert steht meist nicht darin. Mit WAHR nimmt SVERWEIS die passende Stufe darunter.'] };
    }

    // Stimmt auf dem Original, aber nicht auf veränderten Zahlen -> Zufall
    if (vecSame(uBase, sBase)) {
      return { status: 'falsch', title: 'Passt nur zufällig', mids: ['grenze'], show,
        msgs: ['Deine Formel liefert hier das richtige Ergebnis, aber nicht bei anderen Zahlen oder genau auf dem Grenzwert. Prüfe Vergleichszeichen (> oder >=) und Bezüge.'] };
    }
    // Nur Grenzfälle falsch?
    if (same(uBase[tIdx], sBase[tIdx]) && !ex.fill) {
      return { status: 'falsch', title: 'Fast', mids: ['grenze'], show,
        msgs: ['Für diese Zahlen stimmt es, aber nicht in allen Fällen. Prüfe besonders die Grenzwerte (> oder >=?).'] };
    }
    // Rundung
    if (uVec.every((v, i) => typeof v === 'number' && typeof sVec[i] === 'number' && Math.abs(v - sVec[i]) < 0.01 + 1e-9)) {
      return { status: 'fast', title: 'Fast: Rundung', mids: ['runden'], show, msgs: ['Die Ergebnisse weichen nur in der Rundung ab. Prüfe RUNDEN oder die Nachkommastellen.'] };
    }
    // Herunterziehen falsch, Ziel richtig
    let hasRelative = false;
    XL.walk(ast, (x) => { if ((x.k === 'ref' && !x.r.absR) || (x.k === 'range' && (!x.a.absR || !x.b.absR))) hasRelative = true; });
    if (ex.fill && hasRelative && same(uBase[tIdx], sBase[tIdx])) {
      return { status: 'fast', title: 'Fast: Herunterziehen', mids: ['dollar'], show, fillProblem: true,
        msgs: ['In ' + ex.target + ' stimmt es, aber nicht in den anderen Zellen des Bereichs. Prüfe, welche Bezüge beim Herunterziehen fest bleiben müssen ($) und welche mitwandern sollen.'] };
    }
    const msgs = [];
    if (isErr(show.got)) msgs.push(errorExplain(show.got, ast));
    else msgs.push('Dein Ergebnis in ' + ex.target + ': ' + XL.formatValue(show.got, cellFmt(ex)) + '.');
    if (opts.attempt >= 2) msgs.push('Erwartet wäre: ' + XL.formatValue(show.exp, cellFmt(ex)) + '.');
    return { status: 'falsch', title: 'Noch nicht richtig', mids: [], show, msgs };
  }

  // Erkennt eingetippte Werte, die eigentlich ein Zellbezug sein sollten (z. B. 15 statt C8, "Kinder" statt A16)
  function constantProblem(ex, ast, solAst) {
    const userRefs = XL.refsUsed(ast);
    const solRefs = XL.refsUsed(solAst);
    if (!userRefs.length && solRefs.length) {
      return { title: 'Feste Werte statt Formel', msg: 'Du hast das Ergebnis fest eingetippt. Nutze Zellbezüge (z. B. C8*D8), damit Excel neu rechnet, wenn sich die Zahlen ändern – und damit man die Formel herunterziehen kann.' };
    }
    const solNums = [], solStrs = [];
    XL.walk(solAst, (x) => { if (x.k === 'num') solNums.push(x.v); if (x.k === 'str') solStrs.push(x.v.toLocaleLowerCase('de')); });
    const base = buildCases(ex).sheets[0];
    const solCells = [];
    XL.walk(solAst, (x) => { if (x.k === 'ref') solCells.push(XL.addr(x.r.col, x.r.row)); });
    const cellVal = (a) => { const r = XL.parseRef(a); return base.value(r.col, r.row); };
    const userCells = new Set();
    XL.walk(ast, (x) => { if (x.k === 'ref') userCells.add(XL.addr(x.r.col, x.r.row)); });
    let hit = null;
    const lits = [];
    const collect = (x) => {
      if (!x) return;
      if (x.k === 'pct' && constVal(x) !== null) { lits.push({ k: 'num', v: constVal(x), txt: XL.fmtNum(constVal(x) * 100) + '%' }); return; }
      if (x.k === 'num') { lits.push({ k: 'num', v: x.v, txt: XL.fmtNum(x.v) }); return; }
      if (x.k === 'str') { lits.push({ k: 'str', v: x.v, txt: '"' + x.v + '"' }); return; }
      if (x.k === 'group' || x.k === 'neg' || x.k === 'pct') collect(x.e);
      else if (x.k === 'bin') { collect(x.l); collect(x.r); }
      else if (x.k === 'fn') x.args.forEach(collect);
    };
    collect(ast);
    for (const l of lits) {
      if (hit) break;
      if (l.k === 'num' && ![0, 1, 100].includes(l.v) && !solNums.some((n) => XL.approxEq(n, l.v))) {
        for (const a of solCells) { const v = cellVal(a); if (!userCells.has(a) && typeof v === 'number' && XL.approxEq(v, l.v)) { hit = { a, lit: l.txt }; break; } }
      }
      if (l.k === 'str' && l.v !== '' && !solStrs.includes(l.v.toLocaleLowerCase('de'))) {
        for (const a of solCells) { const v = cellVal(a); if (!userCells.has(a) && typeof v === 'string' && v.toLocaleLowerCase('de') === l.v.toLocaleLowerCase('de')) { hit = { a, lit: l.txt }; break; } }
      }
    }
    if (hit) {
      return { title: 'Fester Wert statt Zellbezug', msg: 'Statt ' + hit.lit + ' gehört der Zellbezug ' + hit.a + ' in die Formel. Sonst stimmt sie nur in dieser Zeile und nicht mehr, wenn sich Werte ändern oder du sie herunterziehst.' };
    }
    return null;
  }

  function cellFmt(ex) { const c = ex.sheet.cells[ex.target]; return (c && typeof c === 'object' && c.fmt) || ex.fmt || null; }
  function errorExplain(err, ast) {
    switch (err.code) {
      case '#NV': return 'Ergebnis #NV: SVERWEIS hat den Suchwert nicht gefunden. Stimmt die Matrix (beginnt sie bei der Spalte mit dem Suchwert?) und steht FALSCH am Ende?';
      case '#BEZUG!': return 'Ergebnis #BEZUG!: Der Spaltenindex ist größer als die Matrix breit ist – oder ein Bezug zeigt ins Nichts.';
      case '#WERT!': return 'Ergebnis #WERT!: Excel kann hier nicht rechnen, z. B. weil Text statt einer Zahl oder ein Bereich statt einer Zelle benutzt wird.';
      case '#DIV/0!': return 'Ergebnis #DIV/0!: Es wird durch 0 oder eine leere Zelle geteilt.';
      case '#NAME?': return 'Ergebnis #NAME?: Excel kennt einen Namen in der Formel nicht – oft fehlen Anführungszeichen um einen Text.';
      default: return 'Ergebnis ' + err.code + '.';
    }
  }

  // Ergebnis einer fertigen Formel auf dem Blatt (für "Was kommt raus?")
  function resultOf(ex, formula, at) {
    const s = new XL.Sheet(ex.sheet.cells, { today: ex.sheet.today });
    const ast = XL.compile(formula);
    let a = ast;
    if (at && ex.target) {
      const t = XL.parseRef(ex.target), c = XL.parseRef(at);
      a = XL.shiftAst(ast, c.row - t.row, c.col - t.col);
    }
    return XL.evalAst(a, s);
  }

  // Antwort auf "Was kommt raus?" vergleichen (Zahl oder Text)
  function checkValue(expected, input) {
    const raw = String(input || '').trim();
    if (!raw) return { status: 'leer', msgs: ['Gib zuerst ein Ergebnis ein.'] };
    if (typeof expected === 'number') {
      let s = raw.replace(/€|EUR|CHF|kg|Stk\.?|Tage?/gi, '').trim();
      let pct = false;
      if (/%$/.test(s)) { pct = true; s = s.replace(/%$/, '').trim(); }
      let v = XL.parseNumDE(s);
      if (v === null) v = XL.parseNumDE(s.replace(/\./g, ','));
      if (v === null) return { status: 'falsch', msgs: ['Das ist keine Zahl.'] };
      if (pct) v = v / 100;
      if (XL.approxEq(v, expected) || Math.abs(v - expected) < 0.005 + 1e-9 || (pct === false && Math.abs(v / 100 - expected) < 0.00005)) return { status: 'richtig', msgs: [] };
      return { status: 'falsch', msgs: [] };
    }
    if (typeof expected === 'boolean') {
      const u = raw.toUpperCase();
      return { status: (u === 'WAHR') === expected && (u === 'WAHR' || u === 'FALSCH') ? 'richtig' : 'falsch', msgs: [] };
    }
    if (isErr(expected)) return { status: raw.toUpperCase().replace(/\s/g, '') === expected.code ? 'richtig' : 'falsch', msgs: [] };
    return { status: raw.replace(/^"|"$/g, '').trim().toLocaleLowerCase('de') === String(expected).trim().toLocaleLowerCase('de') ? 'richtig' : 'falsch', msgs: [] };
  }

  const api = { checkFormula, checkValue, resultOf, buildCases, mutants, vector, same };
  root.Checker = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
