/* Lernapp – Bausteine der Oberfläche: Tabellenblatt, Formel-Eingabe, Struktogramm, kleine Helfer. */
(function (root) {
  'use strict';
  const XL = root.XL;

  // ---------- DOM-Helfer ----------
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') {
          // eigene CSS-Variablen (--c) gehen nur über setProperty
          for (const sk of Object.keys(v)) {
            if (v[sk] === null || v[sk] === undefined) continue;
            if (sk.startsWith('--')) n.style.setProperty(sk, v[sk]); else n.style[sk] = v[sk];
          }
        }
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      n.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return n;
  }
  function svgEl(tag, attrs) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k of Object.keys(attrs || {})) n.setAttribute(k, attrs[k]);
    return n;
  }
  const ICONS = {
    back: '<path d="M15 5l-7 7 7 7" />',
    close: '<path d="M6 6l12 12M18 6L6 18" />',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />',
    repeat: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" /><path d="M18 3v4h-4M6 21v-4h4" />',
    exam: '<rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" />',
    alert: '<path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17v.5" />',
    gear: '<circle cx="12" cy="12" r="3" /><path d="M10.3 3h3.4l.5 2.4 1.7 1 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7 1-.5 2.4h-3.4l-.5-2.4-1.7-1-2.3.8-1.7-2.9 1.8-1.6v-2L3.8 8.5l1.7-2.9 2.3.8 1.7-1z" />',
    play: '<path d="M8 5v14l11-7z" />',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5" />',
    cards: '<rect x="3" y="6" width="14" height="12" rx="2" /><path d="M7 3h12a2 2 0 0 1 2 2v10" />',
    steps: '<path d="M4 18h5v-5h5V8h6" />',
    pencil: '<path d="M4 20l4-1 11-11-3-3L5 16z" />',
    flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />',
    clock: '<circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z" />',
    info: '<circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.5" />',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" />',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H5.5a2.5 2.5 0 0 0 2.6 3.6M16 6h2.5a2.5 2.5 0 0 1-2.6 3.6" /><path d="M12 13v3.5M8.5 20h7M10 16.5h4V20h-4z" />',
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19" /><path d="M9 7.5h6" />',
    target: '<circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" />',
    medal: '<circle cx="12" cy="14.5" r="5.5" /><path d="M8.5 3.5l3.5 5.5 3.5-5.5" />',
    chev: '<path d="M9 5.5l6.5 6.5L9 18.5" />',
    grid: '<rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M4 10h16M10 4v16" />'
  };
  function icon(name, cls) {
    const span = el('span', { class: 'ic' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return span;
  }
  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = el('div', { id: 'toast', role: 'status' }); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- Formel hübsch anzeigen (Funktionen, Bezüge, Texte farbig) ----------
  function formulaHtml(text) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let out = '';
    const re = /("[^"]*"?)|(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)|([A-ZÄÖÜ][A-ZÄÖÜ0-9.]*(?=\())|([^"$A-ZÄÖÜ]+|.)/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) out += '<span class="f-str">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="f-ref">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="f-fn">' + esc(m[3]) + '</span>';
      else out += esc(m[0]);
    }
    return out;
  }
  function formulaBox(text, cls) {
    return el('code', { class: 'formula ' + (cls || ''), html: formulaHtml(text) });
  }

  // ---------- Tabellenblatt ----------
  // opts: {target, fill, showTarget:'?'|'value', hl:[addr|range], show:{range, formula}, onCell(addr), maxHeight}
  function sheetGrid(sh, opts) {
    opts = opts || {};
    const view = XL.parseRange(sh.view);
    const s = new XL.Sheet(sh.cells, { today: sh.today });
    const tgt = opts.target ? XL.parseRef(opts.target) : null;
    const fill = opts.fill ? XL.parseRange(opts.fill) : null;
    const hlSet = new Set();
    for (const h of opts.hl || []) {
      const rg = XL.parseRange(h);
      if (rg) XL.rangeCells(rg).forEach((c) => hlSet.add(XL.addr(c.col, c.row)));
    }
    const shown = new Map();
    if (opts.show && opts.show.range && opts.show.formula) {
      const rg = XL.parseRange(opts.show.range);
      const first = { col: rg.c1, row: rg.r1 };
      for (const c of XL.rangeCells(rg)) {
        const fml = XL.shiftFormula(opts.show.formula, c.row - first.row, c.col - first.col);
        shown.set(XL.addr(c.col, c.row), XL.evalFormula(fml, s));
      }
    }
    const wrap = el('div', { class: 'sheet-wrap' });
    if (opts.maxHeight) wrap.style.maxHeight = opts.maxHeight;
    // 1. Inhalt jeder Zelle bestimmen
    const rows = [];
    for (let r = view.r1; r <= view.r2; r++) {
      const cells = [];
      let used = false;
      for (let c = view.c1; c <= view.c2; c++) {
        const a = XL.addr(c, r);
        const raw = sh.cells[a];
        const st = raw && typeof raw === 'object' ? raw.s : null;
        const fmt = raw && typeof raw === 'object' ? raw.fmt : null;
        const cls = [];
        let val = s.value(c, r);
        const isTarget = tgt && tgt.col === c && tgt.row === r;
        const inFill = fill && c >= fill.c1 && c <= fill.c2 && r >= fill.r1 && r <= fill.r2;
        let text;
        if (shown.has(a)) { val = shown.get(a); text = XL.formatValue(val, fmt); cls.push((opts.show && opts.show.cls) || 'shown'); }
        else if (isTarget && opts.showTarget !== 'value') { text = '?'; cls.push('target'); }
        else if (inFill && opts.showTarget !== 'value') { text = '…'; cls.push('fill'); }
        else text = XL.formatValue(val, fmt);
        if (isTarget && opts.showTarget === 'value') cls.push('target');
        if (typeof val === 'number' && !cls.includes('target') && !cls.includes('fill')) cls.push('num');
        if (typeof val === 'boolean' || XL.isErr(val)) cls.push('ctr');
        if (st) cls.push('s-' + st);
        if (hlSet.has(a)) cls.push('hl');
        if (raw !== undefined || cls.length) used = true;
        cells.push({ a, c, st, text, cls });
      }
      if (used || opts.keepEmpty) rows.push({ r, cells });
    }
    // 2. Spaltenbreiten an den Inhalt anpassen
    const widths = [];
    for (let k = 0; k <= view.c2 - view.c1; k++) {
      let w = 34;
      for (const row of rows) {
        const cell = row.cells[k];
        if (cell.st === 't') continue;
        const bold = cell.st === 'h' || cell.st === 'b' || cell.cls.includes('target');
        w = Math.max(w, measure(cell.text, bold) + 14);
      }
      widths.push(Math.min(170, Math.ceil(w)));
    }
    const rowHeadW = Math.max(26, measure(String(view.r2), false) + 12);
    const table = el('table', { class: 'sheet' });
    const colgroup = el('colgroup');
    colgroup.appendChild(el('col', { style: { width: rowHeadW + 'px' } }));
    widths.forEach((w) => colgroup.appendChild(el('col', { style: { width: w + 'px' } })));
    table.appendChild(colgroup);
    const thead = el('thead');
    const hr = el('tr', null, el('th', { class: 'corner' }));
    for (let c = view.c1; c <= view.c2; c++) hr.appendChild(el('th', { text: XL.numToCol(c) }));
    thead.appendChild(hr);
    table.appendChild(thead);
    // 3. Zeilen bauen (leere Zeilen werden weggelassen)
    const tbody = el('tbody');
    for (const row of rows) {
      const tr = el('tr', null, el('th', { class: 'rown', text: String(row.r) }));
      for (let k = 0; k < row.cells.length; k++) {
        const cell = row.cells[k];
        const td = el('td', { 'data-a': cell.a });
        if (cell.st === 't') {
          let span = 1;
          while (k + span < row.cells.length && sh.cells[row.cells[k + span].a] === undefined && !row.cells[k + span].cls.length) span++;
          if (span > 1) td.setAttribute('colspan', String(span));
          td.textContent = cell.text;
          td.classList.add('s-t');
          tr.appendChild(td);
          k += span - 1;
          continue;
        }
        cell.cls.forEach((x) => td.classList.add(x));
        td.textContent = cell.text;
        if (opts.onCell) {
          td.addEventListener('pointerdown', (e) => { e.preventDefault(); });
          td.addEventListener('click', () => opts.onCell(cell.a));
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    if (opts.onCell) wrap.classList.add('tappable');
    afterAttach(wrap, opts.autoScroll !== false);
    return wrap;
  }
  // Nach dem Einfügen: etwas zu breite Tabellen verkleinern, dann zur gesuchten Zelle scrollen
  function afterAttach(wrap, scroll, tries) {
    tries = tries || 0;
    if (!wrap.isConnected) { if (tries < 30) requestAnimationFrame(() => afterAttach(wrap, scroll, tries + 1)); return; }
    const table = wrap.querySelector('table');
    const avail = wrap.clientWidth;
    const need = table.scrollWidth;
    if (need > avail && avail > 0) {
      const ratio = avail / need;
      if (ratio >= 0.8) table.style.zoom = String(Math.floor(ratio * 1000) / 1000);
    }
    if (scroll) autoScroll(wrap);
  }
  let measureCtx = null;
  function measure(text, bold) {
    if (!text) return 0;
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = (bold ? '700 ' : '400 ') + '13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    return measureCtx.measureText(String(text)).width;
  }
  // Scrollt das Blatt so, dass die gesuchte bzw. markierte Zelle sichtbar ist
  function autoScroll(wrap, tries) {
    tries = tries || 0;
    if (!wrap.isConnected) { if (tries < 20) requestAnimationFrame(() => autoScroll(wrap, tries + 1)); return; }
    let cells = [...wrap.querySelectorAll('td.target, td.fill, td.shown, td.shown-bad, td.shown-warn')];
    if (!cells.length) cells = [...wrap.querySelectorAll('td.hl')];
    if (!cells.length) return;
    // alle gesuchten Zellen zusammen sichtbar machen (wenn sie hineinpassen)
    const rs = cells.map((c) => c.getBoundingClientRect());
    const tr = { top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)), left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)) };
    tr.height = tr.bottom - tr.top; tr.width = tr.right - tr.left;
    const wr = wrap.getBoundingClientRect();
    if (tr.bottom > wr.bottom - 4 || tr.top < wr.top + 26) {
      wrap.scrollTop += tr.height < wr.height - 40 ? (tr.top - wr.top) - wr.height / 2 + tr.height / 2 + 10 : (tr.top - wr.top) - 30;
    }
    if (tr.right > wr.right - 4 || tr.left < wr.left + 30) {
      wrap.scrollLeft += tr.width < wr.width - 40 ? (tr.left - wr.left) - wr.width / 2 + tr.width / 2 : (tr.left - wr.left) - 34;
    }
  }

  // ---------- Struktogramm (Nassi-Shneiderman) ----------
  function diagram(node, opts) {
    opts = opts || {};
    const HEAD = 52, LEAF = 44, W = 340;
    const leaves = (n) => (typeof n === 'string' ? 1 : leaves(n.y) + leaves(n.n));
    const depth = (n) => (typeof n === 'string' ? LEAF : HEAD + Math.max(depth(n.y), depth(n.n)));
    const H = depth(node);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'strukto', role: 'img', 'aria-label': 'Struktogramm' });
    const fs = (txt, maxW) => Math.max(9.5, Math.min(14, (maxW / Math.max(1, txt.length)) * 1.75));
    const text = (x, y, t, size, anchor, cls) => {
      const n = svgEl('text', { x, y, 'font-size': size, 'text-anchor': anchor || 'middle', class: cls || '' });
      n.textContent = t;
      svg.appendChild(n);
    };
    const rect = (x, y, w, h) => svg.appendChild(svgEl('rect', { x, y, width: w, height: h, class: 'sb' }));
    const line = (x1, y1, x2, y2) => svg.appendChild(svgEl('line', { x1, y1, x2, y2, class: 'sl' }));
    function draw(n, x, y, w, h) {
      if (typeof n === 'string') {
        rect(x, y, w, h);
        text(x + w / 2, y + h / 2 + 5, n, fs(n, w - 8), 'middle', n === '?' ? 'sq' : 'sa');
        return;
      }
      const ly = leaves(n.y), ln = leaves(n.n);
      const wy = Math.round(w * ly / (ly + ln));
      rect(x, y, w, HEAD);
      line(x, y, x + wy, y + HEAD);
      line(x + w, y, x + wy, y + HEAD);
      text(x + wy, y + 18, n.c, fs(n.c, Math.min(w - 16, 2 * Math.min(wy, w - wy) + 60)), 'middle', 'sc');
      text(x + 8, y + HEAD - 8, 'W', 12, 'start', 'sw');
      text(x + w - 8, y + HEAD - 8, 'F', 12, 'end', 'sf');
      draw(n.y, x, y + HEAD, wy, h - HEAD);
      draw(n.n, x + wy, y + HEAD, w - wy, h - HEAD);
    }
    draw(node, 1, 1, W - 2, H - 2);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const box = el('div', { class: 'strukto-box' + (opts.small ? ' small' : '') });
    box.appendChild(svg);
    return box;
  }

  // ---------- Formel-Eingabe mit Zusatztasten ----------
  // opts: {fns:[...], placeholder, onEnter, value}
  function formulaInput(opts) {
    opts = opts || {};
    const input = el('input', {
      type: 'text', class: 'f-input', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
      inputmode: 'text', enterkeyhint: 'done', placeholder: opts.placeholder || '=…', 'aria-label': 'Formel eingeben'
    });
    if (opts.value) input.value = opts.value;
    let caret = input.value.length;
    const remember = () => { caret = input.selectionStart == null ? input.value.length : input.selectionStart; };
    ['keyup', 'click', 'input', 'select', 'focus'].forEach((ev) => input.addEventListener(ev, remember));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && opts.onEnter) { e.preventDefault(); opts.onEnter(); } });
    function insert(txt, back, auto) {
      // Bei leerem Feld und Funktion/Zelle: = davor setzen
      if (auto && input.value.trim() === '' && txt[0] !== '=') { input.value = '='; caret = 1; }
      const v = input.value;
      const pos = Math.min(caret, v.length);
      input.value = v.slice(0, pos) + txt + v.slice(pos);
      caret = pos + txt.length - (back || 0);
      try { input.setSelectionRange(caret, caret); } catch (e) { /* ignorieren */ }
      input.dispatchEvent(new Event('input'));
    }
    function toggleDollar() {
      const v = input.value;
      const pos = Math.min(caret, v.length);
      const left = v.slice(0, pos);
      const m = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(left);
      if (!m) { insert('$'); return; }
      const states = [['', ''], ['$', '$'], ['', '$'], ['$', '']];
      const cur = states.findIndex((s) => s[0] === m[1] && s[1] === m[3]);
      const nx = states[(cur + 1) % 4];
      const ref = nx[0] + m[2].toUpperCase() + nx[1] + m[4];
      input.value = left.slice(0, left.length - m[0].length) + ref + v.slice(pos);
      caret = pos - m[0].length + ref.length;
      try { input.setSelectionRange(caret, caret); } catch (e) { /* ignorieren */ }
      input.dispatchEvent(new Event('input'));
    }
    function backspace() {
      const v = input.value;
      const pos = Math.min(caret, v.length);
      if (pos === 0) return;
      input.value = v.slice(0, pos - 1) + v.slice(pos);
      caret = pos - 1;
      try { input.setSelectionRange(caret, caret); } catch (e) { /* ignorieren */ }
      input.dispatchEvent(new Event('input'));
    }
    // zwei feste Reihen mit allen Zeichen (nichts versteckt), ⌫ oben rechts
    const keys = ['=', ';', ':', '(', ')', '"', '$', '&', ',', '⌫', '<', '>', '<=', '>=', '<>', '+', '-', '*', '/', '%'];
    const keyRow = el('div', { class: 'keys pad' });
    for (const k of keys) {
      const cls = 'key' + (k === '$' ? ' key-dollar' : k === '⌫' ? ' key-bs' : '') + (k.length > 1 && k !== '⌫' ? ' k2' : '');
      const b = el('button', { type: 'button', class: cls, text: k, title: k === '$' ? '$ setzen (wie F4)' : null, 'aria-label': k === '⌫' ? 'Zeichen löschen' : null });
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => (k === '$' ? toggleDollar() : k === '⌫' ? backspace() : insert(k)));
      keyRow.appendChild(b);
    }
    const fnRow = el('div', { class: 'keys fns' });
    for (const fn of opts.fns || []) {
      const label = fn;
      const b = el('button', { type: 'button', class: 'key key-fn', text: label });
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => insert(fn, 0, true));
      fnRow.appendChild(b);
    }
    const box = el('div', { class: 'f-box' }, el('div', { class: 'f-line' }, el('span', { class: 'fx', text: 'fx' }), input), keyRow, (opts.fns && opts.fns.length) ? fnRow : null);
    return { box, input, insertRef: (a) => insert(a, 0, true), focus: () => input.focus(), value: () => input.value, set: (v) => { input.value = v; caret = v.length; } };
  }

  // ---------- Medaillen ----------
  const MEDAL = {
    gold: ['#FFE68C', '#F2C230', '#B8890E'], silver: ['#F4F6F9', '#C3CCD6', '#7F8B99'], bronze: ['#F5C894', '#D29455', '#94592A'],
    locked: ['#F3F5F8', '#E2E6EC', '#C3CAD4'], blue: ['#A9CBF7', '#2F7DE1', '#1D55A3'], purple: ['#D2B9F4', '#8A4FD8', '#5E2EA6'],
    orange: ['#FFCFA3', '#E8762B', '#A9501A'], green: ['#AEE3BE', '#2E9D4F', '#1B6B33'], red: ['#F7B7B1', '#DD4238', '#9C2A22']
  };
  let medalUid = 0;
  // opts: {color, glyph (Icon-Name oder kurzer Text), size, locked}
  function medal(opts) {
    opts = opts || {};
    const locked = !!opts.locked;
    const c = MEDAL[locked ? 'locked' : opts.color] || MEDAL.gold;
    const size = opts.size || 56;
    const gid = 'mg' + (++medalUid);
    const ink = locked ? '#AAB3C0' : '#fff';
    let glyph = '';
    if (opts.glyph && ICONS[opts.glyph]) {
      glyph = `<g transform="translate(20 34)" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[opts.glyph]}</g>`;
    } else if (opts.glyph) {
      const t = String(opts.glyph);
      glyph = `<text x="32" y="${t.length > 2 ? 51 : 53}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${t.length > 2 ? 14 : 19}" font-weight="900" fill="${ink}">${t}</text>`;
    }
    const rib1 = locked ? '#D5DBE3' : '#3B6FD8', rib2 = locked ? '#C9D0D9' : '#D9473E';
    const span = el('span', { class: 'medal' + (locked ? ' locked' : ''), style: { width: size + 'px', height: Math.round(size * 76 / 64) + 'px' }, 'aria-hidden': 'true' });
    span.innerHTML = `<svg viewBox="0 0 64 76"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient></defs>` +
      `<path d="M18 2 L30 2 L37 26 L25 31 Z" fill="${rib1}"/><path d="M46 2 L34 2 L27 26 L39 31 Z" fill="${rib2}"/>` +
      `<circle cx="32" cy="46" r="24" fill="url(#${gid})" stroke="${c[2]}" stroke-width="3"/><circle cx="32" cy="46" r="17.5" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2"/>${glyph}</svg>`;
    return span;
  }
  // kleiner Hinweis oben, wenn eine Medaille neu dazukommt (einer nach dem anderen)
  const medalQueue = [];
  let medalBusy = false;
  function medalPopup(node, title, desc, eyebrow) {
    medalQueue.push({ node, title, desc, eyebrow });
    if (!medalBusy) nextMedal();
  }
  function nextMedal() {
    const m = medalQueue.shift();
    if (!m) { medalBusy = false; return; }
    medalBusy = true;
    const box = el('div', { class: 'medal-pop', role: 'status' }, m.node,
      el('div', { class: 'mp-text' }, el('div', { class: 'mp-eyebrow', text: m.eyebrow || 'Neue Medaille' }), el('b', { text: m.title }), el('div', { class: 'small', text: m.desc })));
    document.body.appendChild(box);
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('show')));
    let closed = false;
    const close = () => { if (closed) return; closed = true; box.classList.remove('show'); setTimeout(() => { box.remove(); nextMedal(); }, 320); };
    box.addEventListener('click', close);
    setTimeout(close, 3800);
  }

  function progressRing(pct, color, size) {
    size = size || 44;
    const r = (size - 6) / 2, c = 2 * Math.PI * r;
    const wrap = el('span', { class: 'ring', style: { width: size + 'px', height: size + 'px' } });
    wrap.innerHTML = `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" style="stroke:${color}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><b>${Math.round(pct)}</b>`;
    return wrap;
  }

  root.UI = { el, svgEl, icon, toast, formulaHtml, formulaBox, sheetGrid, diagram, formulaInput, progressRing, medal, medalPopup };
})(window);
