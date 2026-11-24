/* Lernapp – Hauptprogramm. Lernen als Level-Weg: pro Thema erst Erkennen (Auswahl), dann Üben, dann selber tippen,
   dazwischen Wiederholungen, am Ende Probeklausuren. Alles Weitere (Themen, Videos, Fehler, Erfolge) liegt im Menü.
   Der Fortschritt bleibt auf dem jeweiligen Gerät. */
(function () {
  'use strict';
  const { el, icon, toast, formulaBox, sheetGrid, diagram, formulaInput, medal, medalPopup } = UI;
  // wie Element.append, aber ohne leere Teile (null, false)
  const put = (node, ...kids) => { for (const k of kids.flat()) { if (k === null || k === undefined || k === false) continue; node.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); } return node; };
  const app = document.getElementById('app');
  let META = null, COURSE = null, KEY = null, SUBJECTS = [];
  const COLORS = { indigo: '#4F5BD5', teal: '#0E9F8E', green: '#2E9D4F', orange: '#E8762B', amber: '#C98A00', blue: '#2F7DE1', purple: '#8A4FD8', red: '#DD4238' };
  const colorOf = (t) => COLORS[t.color] || t.color || '#2F7DE1';

  // =====================================================================
  // Inhalte
  // =====================================================================
  const TOPICS = new Map(), EXS = new Map(), MISTAKES = new Map();
  function indexCourse() {
    SUBJECTS = COURSE.subjects || [];
    TOPICS.clear(); EXS.clear(); MISTAKES.clear();
    for (const s of SUBJECTS) {
      for (const t of s.topics) {
        t._subject = s.id;
        TOPICS.set(t.id, t);
        for (const e of t.exercises) { e._topic = t.id; EXS.set(e.id, e); }
      }
      for (const m of s.mistakes || []) MISTAKES.set(m.id, m);
      for (const k of s.exams || []) k._subject = s.id;
    }
  }
  const subjectById = (id) => SUBJECTS.find((s) => s.id === id);
  const topicById = (id) => TOPICS.get(id);
  const exById = (id) => EXS.get(id) || CHOICE.get(id);
  const mistakeById = (id) => MISTAKES.get(id);
  const examById = (id) => { for (const s of SUBJECTS) for (const k of s.exams || []) if (k.id === id) return k; return null; };
  function mySubjects() {
    const sel = P.subjects;
    const list = SUBJECTS.filter((s) => !sel || sel.includes(s.id));
    return list.length ? list : SUBJECTS;
  }
  function curSubject() {
    const list = mySubjects();
    return list.find((s) => s.id === P.cur) || list[0];
  }

  // =====================================================================
  // Fortschritt (Lernkartei mit 5 Fächern, Level mit Sternen) – nur auf diesem Gerät
  // =====================================================================
  const PKEY = 'lernapp.progress.v1';
  const INTERVAL = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 16 };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const today = () => iso(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const STATS0 = () => ({ answered: 0, correct: 0, fixed: 0, combo: 0, bestCombo: 0, examsDone: 0, bestExamPct: 0 });
  const defaults = () => ({ items: {}, mistakes: {}, seen: {}, exams: {}, settings: { goal: 10 }, subjects: null, cur: null,
    daily: {}, goalDays: {}, stats: STATS0(), medals: {}, best: 0, vseen: {}, levels: {}, essays: {} });
  let P = loadP();
  function loadP() {
    try {
      const raw = JSON.parse(localStorage.getItem(PKEY) || '{}');
      const p = Object.assign(defaults(), raw);
      p.settings = Object.assign({ goal: 10 }, raw.settings || {});
      p.stats = Object.assign(STATS0(), raw.stats || {});
      p.levels = p.levels || {};
      p.essays = p.essays || {};
      return p;
    } catch (e) { return defaults(); }
  }
  function saveP() { try { localStorage.setItem(PKEY, JSON.stringify(P)); } catch (e) { /* voll oder privat */ } }
  const box = (id) => ((P.items[id] || {}).box || 0);
  function interleave(list) {
    const by = new Map();
    for (const e of list) { if (!by.has(e._topic)) by.set(e._topic, []); by.get(e._topic).push(e); }
    const out = [];
    let added = true;
    while (added) { added = false; for (const [, arr] of by) if (arr.length) { out.push(arr.shift()); added = true; } }
    return out;
  }
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // =====================================================================
  // Level-Weg: je Thema Erkennen → Üben → Selber tippen, alle zwei Themen eine Wiederholung, am Ende Probeklausuren
  // =====================================================================
  const KIND = {
    choose: { name: 'Erkennen', icon: 'eye', hint: 'Wähle die richtige Antwort aus 3' },
    mixed: { name: 'Üben', icon: 'cards', hint: 'Auswählen, ordnen und rechnen' },
    type: { name: 'Selber tippen', icon: 'pencil', hint: 'Formeln selbst eintippen' },
    review: { name: 'Wiederholung', icon: 'repeat', hint: 'Alles bisher gemischt' },
    exam: { name: 'Probeklausur', icon: 'trophy', hint: 'Wie in der Klausur, mit Zeit' },
    essay: { name: 'Probe-Text', icon: 'book', hint: 'Einen ganzen Text schreiben' },
  };
  function pathOf(s) {
    if (s._path) return s._path;
    const L = [];
    s.topics.forEach((t, i) => {
      ['choose', 'mixed', 'type'].forEach((k, j) => L.push({ id: t.id + ':' + (j + 1), kind: k, topic: t.id, title: t.title, color: colorOf(t) }));
      if (i % 2 === 1 || i === s.topics.length - 1) L.push({ id: s.id + ':mix' + (i + 1), kind: 'review', upto: i, title: 'Wiederholung', color: '#5B6B8C' });
    });
    (s.exams || []).forEach((k) => L.push({ id: 'exam:' + k.id, kind: 'exam', exam: k.id, title: k.title, color: '#1F2A44' }));
    (s.essays || []).forEach((k) => L.push({ id: 'essay:' + k.id, kind: 'essay', essay: k.id, title: k.title, color: '#1F2A44' }));
    L.forEach((l, i) => { l.n = i + 1; l.subject = s.id; l.i = i; l.name = (s.levelNames || {})[l.kind] || KIND[l.kind].name; });
    return (s._path = L);
  }
  const levelById = (id) => { for (const s of SUBJECTS) { const l = pathOf(s).find((x) => x.id === id); if (l) return l; } return null; };
  const levelDone = (l) => !!(P.levels[l.id] && P.levels[l.id].stars);
  function currentIndex(s) { const L = pathOf(s); const i = L.findIndex((l) => !levelDone(l)); return i < 0 ? L.length - 1 : i; }
  const levelsDone = () => Object.values(P.levels).filter((x) => x.stars).length;
  const totalStars = () => Object.values(P.levels).reduce((a, x) => a + (x.stars || 0), 0);
  const starsFor = (ok, n) => { const r = n ? ok / n : 0; return r >= 0.9 ? 3 : r >= 0.6 ? 2 : 1; };

  // ---------- Auswahl-Aufgaben aus Formel-Aufgaben: richtige Formel + typische falsche ----------
  const CHOICE = new Map();
  const normF = (f) => String(f).replace(/\s+/g, '').toUpperCase();
  function genericVariants(ex) {
    const out = [];
    let sol;
    try { sol = XL.compile(ex.solution); } catch (e) { return out; }
    const variant = (fn) => { try { const c = XL.cloneAst(sol); if (fn(c)) out.push(XL.toFormula(c)); } catch (e) { /* überspringen */ } };
    const swapFn = { SUMME: 'MITTELWERT', MITTELWERT: 'SUMME', MAX: 'MIN', MIN: 'MAX', ANZAHL: 'SUMME', ANZAHL2: 'ANZAHL', 'ZÄHLENWENN': 'SUMMEWENN', SUMMEWENN: 'ZÄHLENWENN' };
    // Funktion verwechselt
    variant((c) => { let ch = false; XL.walk(c, (n) => { if (!ch && n.k === 'fn' && swapFn[XL.canonicalFn(n.name)]) { n.name = swapFn[XL.canonicalFn(n.name)]; ch = true; } }); return ch; });
    // Rechenzeichen vertauscht
    variant((c) => { let ch = false; const sw = { '+': '-', '-': '+', '*': '/', '/': '*' }; XL.walk(c, (n) => { if (!ch && n.k === 'bin' && sw[n.op]) { n.op = sw[n.op]; ch = true; } }); return ch; });
    // % vergessen
    variant((c) => { let ch = false; XL.walk(c, (n) => { if (n.k === 'bin') for (const side of ['l', 'r']) if (!ch && n[side].k === 'pct') { n[side] = n[side].e; ch = true; } }); return ch; });
    // Nachbarzelle statt der richtigen
    variant((c) => { let ch = false; XL.walk(c, (n) => { if (!ch && n.k === 'ref') { n.r.col += 1; ch = true; } }); return ch; });
    // Bereich um eine Zeile verrutscht
    variant((c) => { let ch = false; XL.walk(c, (n) => { if (!ch && n.k === 'range') { n.a.row += 1; n.b.row += 1; ch = true; } }); return ch; });
    // alle Bezüge mit $
    variant((c) => {
      let ch = false;
      XL.walk(c, (n) => {
        if (n.k === 'ref' && !(n.r.absC && n.r.absR)) { n.r.absC = n.r.absR = true; ch = true; }
        if (n.k === 'range') for (const p of [n.a, n.b]) if (!(p.absC && p.absR)) { p.absC = p.absR = true; ch = true; }
      });
      return ch;
    });
    return out;
  }
  function distractors(ex, k) {
    const seen = new Set([normF(ex.solution)]);
    const out = [];
    const usedMid = new Set();
    const cands = [];
    for (const m of Checker.mutants(ex)) {
      // „mal 100“ nur bei echten Prozent-Rechnungen (Anteil mit / oder %)
      if (m.mid === 'prozent' && !(ex._topic === 'prozent' && /[/%]/.test(ex.solution))) continue;
      try { cands.push({ f: XL.toFormula(m.ast), mid: m.mid, why: m.hint }); } catch (e) { /* überspringen */ }
    }
    for (const f of genericVariants(ex)) cands.push({ f });
    // erst je Fehlerart einer, dann auffüllen
    for (const pass of [0, 1]) {
      for (const c of cands) {
        if (out.length >= k) break;
        const nf = normF(c.f);
        if (seen.has(nf) || (pass === 0 && c.mid && usedMid.has(c.mid))) continue;
        let r;
        try { r = Checker.checkFormula(ex, c.f, { attempt: 2 }); } catch (e) { continue; }
        if (!r || r.status === 'richtig' || r.status === 'syntax' || r.status === 'leer') { seen.add(nf); continue; }
        seen.add(nf);
        const mid = c.mid || (r.mids || [])[0] || null;
        if (mid) usedMid.add(mid);
        out.push({ f: c.f, mid, why: c.why || (r.msgs || [])[0] || '' });
      }
    }
    return out;
  }
  // n = Anzahl der Antworten (3 oder 4)
  function asChoice(ex, n) {
    const id = ex.id + '~w' + n;
    if (CHOICE.has(id)) return CHOICE.get(id);
    if (ex.type === 'luecke') {
      const w = (ex.wrong || []).slice(0, n - 1);
      const it = w.length < 2 ? null : { id, type: 'wahl', _topic: ex._topic, prompt: ex.prompt, text: ex.text, explain: ex.explain,
        options: [{ t: ex.answers[0], ok: true }].concat(w.map((x) => ({ t: x.t, ok: false, mid: x.mid, why: x.why }))) };
      CHOICE.set(id, it);
      return it;
    }
    const d = distractors(ex, n - 1);
    const item = d.length < 2 ? null : {
      id, type: 'wahl', choose: true, _topic: ex._topic, prompt: ex.prompt, sheet: ex.sheet, target: ex.target, fill: ex.fill, diagram: ex.diagram, explain: ex.explain,
      options: [{ f: ex.solution, ok: true }].concat(d.map((x) => ({ f: x.f, ok: false, mid: x.mid, why: x.why }))),
    };
    CHOICE.set(id, item);
    return item;
  }
  // Aufgaben eines Levels
  function levelItems(l) {
    if (l.kind === 'review') {
      const s = subjectById(l.subject);
      const t0 = today();
      const pool = s.topics.slice(0, l.upto + 1).flatMap((t) => t.exercises.filter((e) => e.type === 'formel' || e.type === 'luecke'));
      // fällige und unsichere zuerst, Klausurthemen etwas häufiger
      const w = pool.map((e) => { const it = P.items[e.id]; const due = it && it.due <= t0; return { e, k: Math.random() * (topicById(e._topic).focus ? 1.5 : 1) * (due ? 3 : 1) * (6 - box(e.id)) }; });
      w.sort((a, b) => b.k - a.k);
      const typed = interleave(w.slice(0, 5).map((x) => x.e));
      const extra = w.slice(5).map((x) => asChoice(x.e, 4)).filter(Boolean).slice(0, 1);
      return typed.concat(extra);
    }
    const t = topicById(l.topic);
    if (!t) return [];
    const ex = t.exercises;
    const formel = ex.filter((e) => e.type === 'formel' || e.type === 'luecke');
    const writing = ex.filter((e) => e.type === 'schreiben');
    const wahl = ex.filter((e) => e.type === 'wahl');
    const other = ex.filter((e) => ['ergebnis', 'ordnen', 'karte'].includes(e.type));
    const nW = Math.min(3, wahl.length);
    const nF1 = Math.max(0, 5 - nW);
    if (l.kind === 'choose') {
      const items = wahl.slice(0, nW).concat(formel.slice(0, nF1 + 2).map((e) => asChoice(e, 3)).filter(Boolean).slice(0, nF1));
      return items.length ? items : wahl.concat(other).slice(0, 5);
    }
    if (l.kind === 'mixed') {
      const rest = formel.slice(nF1).concat(formel.slice(0, nF1));
      const mc = rest.map((e) => asChoice(e, 4)).filter(Boolean);
      const base = other.concat(wahl.slice(nW));
      return shuffle(base.slice(0, 3).concat(mc.slice(0, Math.max(2, 5 - Math.min(3, base.length)))));
    }
    // selber tippen: die unsichersten zuerst
    const order = formel.map((e, i) => ({ e, i })).sort((a, b) => box(a.e.id) - box(b.e.id) || a.i - b.i).map((x) => x.e);
    return order.slice(0, writing.length ? 4 : 5).concat(writing.slice(0, 1));
  }

  // =====================================================================
  // Belohnungen: Tagesziel, Streak, Medaillen
  // =====================================================================
  const goal = () => P.settings.goal || 10;
  const countOn = (d) => P.daily[d] || 0;
  function streak() {
    let d = today(), n = 0;
    if (!P.goalDays[d]) d = addDays(d, -1);
    while (P.goalDays[d]) { n++; d = addDays(d, -1); }
    return n;
  }
  const MEDALS = [
    { id: 'start', name: 'Los geht’s', desc: 'Erste Aufgabe gelöst', color: 'green', glyph: 'check', test: () => P.stats.answered >= 1 },
    { id: 'lvl1', name: 'Level 1', desc: 'Erstes Level geschafft', color: 'blue', glyph: '1', test: () => levelsDone() >= 1 },
    { id: 'lvl10', name: '10 Level', desc: '10 Level geschafft', color: 'blue', glyph: '10', test: () => levelsDone() >= 10 },
    { id: 'lvlall', name: 'Ziel', desc: 'Alle Level eines Fachs', color: 'gold', glyph: 'trophy', test: () => SUBJECTS.some((s) => pathOf(s).every(levelDone)) },
    { id: 'perfekt', name: 'Perfekt', desc: 'Ein Level mit 3 Sternen', color: 'gold', glyph: 'star', test: () => Object.values(P.levels).some((x) => x.stars >= 3) },
    { id: 'sterne30', name: '30 Sterne', desc: '30 Sterne gesammelt', color: 'gold', glyph: '30', test: () => totalStars() >= 30 },
    { id: 'goal', name: 'Tagesziel', desc: 'Tagesziel geschafft', color: 'green', glyph: 'target', test: () => Object.keys(P.goalDays).length >= 1 },
    { id: 's3', name: '3 Tage', desc: '3 Tage in Folge', color: 'orange', glyph: '3', streak: true, test: () => P.best >= 3 },
    { id: 's7', name: '7 Tage', desc: '7 Tage in Folge', color: 'orange', glyph: '7', streak: true, test: () => P.best >= 7 },
    { id: 'combo', name: 'Zehn am Stück', desc: '10 hintereinander gleich richtig', color: 'purple', glyph: 'star', test: () => P.stats.bestCombo >= 10 },
    { id: 'fix', name: 'Fehlerjäger', desc: '10 alte Fehler verbessert', color: 'red', glyph: 'repeat', test: () => P.stats.fixed >= 10 },
    { id: 'video', name: 'Kino', desc: 'Alle Videos eines Fachs', color: 'blue', glyph: 'play',
      test: () => SUBJECTS.some((s) => { const v = playlistOf(s); return v.length > 0 && v.every(videoSeen); }) },
    { id: 'exam', name: 'Probeklausur', desc: 'Erste Probeklausur', color: 'green', glyph: 'exam', test: () => P.stats.examsDone >= 1 },
    { id: 'exam2', name: 'Note 2', desc: 'Probeklausur ab 81 %', color: 'silver', glyph: '2', test: () => P.stats.bestExamPct >= 81 },
    { id: 'exam1', name: 'Volltreffer', desc: 'Probeklausur mit 100 %', color: 'gold', glyph: '1', test: () => P.stats.bestExamPct >= 100 },
    { id: 'essay', name: 'Autor', desc: 'Ersten Probe-Text geschrieben', color: 'purple', glyph: 'book', test: () => Object.values(P.essays || {}).some((x) => x.best) },
  ];
  let goalJustReached = false;
  // wird nach jeder beantworteten Aufgabe aufgerufen
  function countAnswer(outcome, prevIt) {
    const d = today();
    P.daily[d] = (P.daily[d] || 0) + 1;
    const st = P.stats;
    st.answered++;
    const good = outcome === 'first' || outcome === 'known';
    if (good) { st.correct++; st.combo++; st.bestCombo = Math.max(st.bestCombo, st.combo); }
    else if (outcome !== 'fast') st.combo = 0;
    if (good && prevIt && prevIt.wrong > 0 && prevIt.box <= 1) st.fixed++;
    checkGoal();
  }
  function checkGoal() {
    const d = today();
    if (!P.goalDays[d] && countOn(d) >= goal()) { P.goalDays[d] = 1; goalJustReached = true; }
    P.best = Math.max(P.best || 0, streak());
  }
  // zeigt neue Belohnungen oben an – pro Ereignis nur eine Meldung
  function checkRewards() {
    const pops = [];
    let goalMedal = false;
    for (const m of MEDALS) {
      if (!P.medals[m.id] && m.test()) {
        P.medals[m.id] = today();
        if (m.id === 'goal' || m.streak) goalMedal = true;
        pops.push([medal({ color: m.color, glyph: m.glyph, size: 46 }), m.name, m.desc, 'Neue Medaille']);
      }
    }
    if (goalJustReached) {
      goalJustReached = false;
      // eine Tagesziel- oder Streak-Medaille sagt das schon
      if (!goalMedal) {
        const s = streak();
        pops.unshift([medal({ color: 'orange', glyph: 'flame', size: 46 }), 'Tagesziel geschafft', s + (s === 1 ? ' Tag' : ' Tage') + ' in Folge', 'Heute']);
      }
    }
    saveP();
    pops.forEach((p) => medalPopup(p[0], p[1], p[2], p[3]));
  }
  function grade(id, outcome) {
    const prev = P.items[id] ? Object.assign({}, P.items[id]) : null;
    const it = P.items[id] || { box: 0, right: 0, wrong: 0 };
    const t = today();
    if (outcome === 'first' || outcome === 'known') { it.box = Math.min(5, Math.max(1, it.box) + 1); it.right++; }
    else if (outcome === 'fast') { it.box = Math.max(1, it.box); it.right++; }
    else { it.box = 1; it.wrong++; }
    it.due = addDays(t, outcome === 'fast' ? 1 : INTERVAL[it.box]);
    it.last = t;
    P.items[id] = it;
    countAnswer(outcome, prev);
    checkRewards();
  }
  function recordMistakes(mids, exId) {
    if (!mids || !mids.length) return;
    for (const m of mids) {
      if (!mistakeById(m)) continue;
      const r = P.mistakes[m] || { n: 0, items: [] };
      r.n++;
      r.last = today();
      const base = exId ? String(exId).split('~')[0] : null;
      if (base && EXS.has(base) && !r.items.includes(base)) r.items.push(base);
      P.mistakes[m] = r;
    }
    saveP();
  }
  const hasVideo = (t) => !!(t.video && META.videos && META.videos[t.video]);
  const topicVideo = (t) => ({ video: t.video, title: t.title, topic: t.id });
  // Video-Liste eines Fachs (nur Videos, die es wirklich gibt); ohne Liste: die Themen-Videos
  const playlistOf = (s) => {
    const pl = (s.playlist || []).filter((e) => META.videos && META.videos[e.video]);
    return pl.length ? pl : s.topics.filter(hasVideo).map(topicVideo);
  };
  const videoSeen = (e) => !!((P.vseen || {})[e.video] || (e.topic && (P.seen[e.topic] || {}).video));
  const fmtDur = (sec) => { if (!sec) return ''; const t = Math.round(sec); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') + ' Min.'; };
  function markVideo(e) {
    if ((P.vseen || {})[e.video] && (!e.topic || (P.seen[e.topic] || {}).video)) return;
    P.vseen = Object.assign({}, P.vseen, { [e.video]: true });
    if (e.topic) P.seen[e.topic] = Object.assign({}, P.seen[e.topic], { video: true });
    saveP();
    checkRewards();
  }
  function markSeen(tid, key) { P.seen[tid] = Object.assign({}, P.seen[tid], { [key]: true }); saveP(); }

  // Sterne (gefüllt/leer) als kleine Grafik
  function stars(n, size) {
    const w = el('span', { class: 'stars', 'aria-label': n + ' von 3 Sternen' });
    for (let i = 0; i < 3; i++) {
      const s = el('span', { class: 'star' + (i < n ? ' on' : ''), style: { width: size + 'px', height: size + 'px' } });
      s.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>';
      w.appendChild(s);
    }
    return w;
  }
  // Wochenleiste: Mo–So, Tagesziel erreicht = gefüllt
  function weekStrip() {
    const now = new Date(today() + 'T12:00:00');
    const dow = (now.getDay() + 6) % 7;
    const monday = addDays(today(), -dow);
    const names = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    return el('div', { class: 'week' }, names.map((n, i) => {
      const d = addDays(monday, i);
      const done = !!P.goalDays[d], isToday = d === today(), future = d > today();
      const part = !done && isToday ? Math.min(1, countOn(d) / goal()) : 0;
      return el('div', { class: 'wday' + (done ? ' done' : '') + (isToday ? ' today' : '') + (future ? ' future' : '') },
        el('span', { class: 'wdot', style: part ? { background: `conic-gradient(var(--orange) ${Math.round(part * 360)}deg, #E7EBF1 0)` } : null }, done ? icon('check') : null),
        el('span', { class: 'wname', text: n }));
    }));
  }

  // =====================================================================
  // Rahmen und Navigation
  // =====================================================================
  let flushEssay = null;
  function screen(opts, ...content) {
    closeMenu();
    if (flushEssay) { flushEssay(); flushEssay = null; }
    app.innerHTML = '';
    app.className = opts.cls || '';
    // Akzentfarbe der Seite (Knöpfe, Eingabefelder) = Farbe der Kopfzeile
    if (opts.color) app.style.setProperty('--accent', opts.color); else app.style.removeProperty('--accent');
    const top = el('header', { class: 'top' + (opts.color ? ' colored' : ''), style: opts.color ? { '--hc': opts.color } : null });
    if (opts.back) top.appendChild(el('button', { class: 'icon-btn', 'aria-label': 'Zurück', onclick: () => go(opts.back) }, icon('back')));
    top.appendChild(el('div', { class: 'top-title' }, el('h1', { text: opts.title || 'Lernapp' }), opts.sub ? el('div', { class: 'top-sub', text: opts.sub }) : null));
    if (opts.right) top.appendChild(opts.right);
    const main = el('main', { class: 'content' });
    put(main, ...content);
    if (opts.title !== null) app.appendChild(top);
    app.appendChild(main);
    window.scrollTo(0, 0);
    return main;
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  window.addEventListener('hashchange', () => route());

  let updateReady = false;
  function route() {
    if (!COURSE) return;
    // neue Version ist da: beim Weg zurück zur Startseite einmal neu laden (nie mitten in einer Runde)
    if (updateReady && !location.hash.replace(/^#\/?/, '')) { updateReady = false; location.reload(); return; }
    if (examState && !examState.submitted && !location.hash.startsWith('#/klausur/')) {
      if (!confirm('Die Probeklausur läuft noch. Wirklich verlassen? Deine Antworten gehen verloren.')) { history.back(); return; }
      stopExamTimer();
      examState = null;
    }
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return viewPath();
    const [a, b, c] = parts;
    if (a === 'level' && b) { const l = levelById(b); return l ? startLevel(l) : viewPath(); }
    if (a === 'f' && b) {
      const s = subjectById(b);
      if (!s) return viewPath();
      if (c === 'klausur') return viewExams(s);
      if (c === 'fehler') return viewMistakes(s);
      if (c === 'videos') return viewVideos(s);
      if (c === 'woerter') return viewWordbank(s);
      if (c === 'aufsaetze') return viewEssays(s);
      return viewThemen(s);
    }
    if (a === 'themen') return viewThemen(curSubject());
    if (a === 't' && b) {
      const t = topicById(b);
      if (!t) return viewPath();
      if (c === 'lernen') return viewCards(t);
      if (c === 'beispiel') return viewExample(t);
      if (c === 'ueben') return startTopicPractice(t);
      if (c === 'fehler') return viewTopicMistakes(t);
      return viewTopic(t);
    }
    if (a === 'erfolge') return viewRewards();
    if (a === 'faecher') return viewPicker();
    if (a === 'klausur' && b) return viewExamStart(b);
    if (a === 'aufsatz' && b) return viewEssay(b);
    if (a === 'einstellungen') return viewSettings();
    if (a === 'session') return session && !session.ended ? renderSession() : viewPath();
    return viewPath();
  }

  // ---------- Menü (alles, was nicht zum Level-Weg gehört) ----------
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openMenu() {
    closeMenu();
    const s = curSubject();
    const tile = (ic, c) => el('span', { class: 'mi', style: { '--c': c } }, icon(ic));
    const row = (ic, label, hash, c) => el('a', { class: 'menu-row', href: hash, onclick: () => closeMenu() }, tile(ic, c), el('span', { text: label }), icon('chev', 'chev'));
    const others = mySubjects().filter((x) => x.id !== s.id);
    const sheet = el('div', { class: 'menu-sheet', role: 'dialog', 'aria-label': 'Menü' },
      el('div', { class: 'menu-grab' }),
      row('list', 'Themen-Übersicht', '#/themen', '#4F5BD5'),
      playlistOf(s).length ? row('play', 'Alle Videos', '#/f/' + s.id + '/videos', '#DD4238') : null,
      s.wordbank ? row('book', 'Linking words', '#/f/' + s.id + '/woerter', '#0E9F8E') : null,
      (s.exams || []).length ? row('exam', 'Probeklausur', '#/f/' + s.id + '/klausur', '#1F2A44') : null,
      (s.essays || []).length ? row('pencil', ((s.levelNames || {}).essay || 'Probe-Text') + ' schreiben', '#/f/' + s.id + '/aufsaetze', '#8A4FD8') : null,
      row('alert', 'Häufige Fehler', '#/f/' + s.id + '/fehler', '#E8762B'),
      row('trophy', 'Erfolge', '#/erfolge', '#C98A00'),
      others.map((x) => el('button', { class: 'menu-row', onclick: () => { P.cur = x.id; saveP(); closeMenu(); go('#/'); } }, tile('grid', x.color), el('span', { text: 'Fach wechseln: ' + x.name }), icon('chev', 'chev'))),
      row('gear', 'Einstellungen', '#/einstellungen', '#687385'));
    menuEl = el('div', { class: 'menu-ov', onclick: (e) => { if (e.target === menuEl) closeMenu(); } }, sheet);
    document.body.appendChild(menuEl);
    requestAnimationFrame(() => menuEl && menuEl.classList.add('show'));
  }

  function openSubjects() {
    closeMenu();
    const s = curSubject();
    const sheet = el('div', { class: 'menu-sheet', role: 'dialog', 'aria-label': 'Fach wählen' }, el('div', { class: 'menu-grab' }),
      el('div', { class: 'menu-title', text: 'Fach wählen' }),
      mySubjects().map((x) => el('button', { class: 'menu-row', onclick: () => { P.cur = x.id; saveP(); closeMenu(); go('#/'); } },
        el('span', { class: 'menu-dot', style: { background: x.color } }), el('span', null, el('b', { text: x.name }), el('small', { class: 'muted', text: ' · ' + x.sub })),
        x.id === s.id ? icon('check') : icon('chev', 'chev'))));
    menuEl = el('div', { class: 'menu-ov', onclick: (e) => { if (e.target === menuEl) closeMenu(); } }, sheet);
    document.body.appendChild(menuEl);
    requestAnimationFrame(() => menuEl && menuEl.classList.add('show'));
  }

  // =====================================================================
  // Start = der Level-Weg
  // =====================================================================
  function viewPath() {
    const s = curSubject();
    const L = pathOf(s);
    const cur = currentIndex(s);
    const st = streak();
    const g = goal(), c = Math.min(countOn(today()), g);
    const bar = el('div', { class: 'path-top' },
      el('a', { class: 'pt-streak' + (st ? ' on' : ''), href: '#/erfolge', 'aria-label': st + ' Tage in Folge' }, icon('flame'), el('b', { text: String(st) })),
      el(mySubjects().length > 1 ? 'button' : 'div', { class: 'pt-title' + (mySubjects().length > 1 ? ' pt-switch' : ''), onclick: mySubjects().length > 1 ? openSubjects : null, 'aria-label': 'Fach wechseln' },
        el('b', null, s.name, mySubjects().length > 1 ? el('span', { class: 'pt-caret', text: ' ▾' }) : null), el('span', { class: 'pt-goal' }, el('i', { style: { width: Math.round(100 * c / g) + '%' } })),
        el('span', { class: 'pt-goal-txt', text: c >= g ? 'Tagesziel geschafft' : 'Heute ' + c + ' von ' + g })),
      el('button', { class: 'icon-btn', 'aria-label': 'Menü', onclick: openMenu }, icon('menu')));
    const path = el('div', { class: 'path' });
    let lastGroup = null;
    L.forEach((l, i) => {
      const group = l.topic || l.kind;
      if (group !== lastGroup) {
        lastGroup = group;
        const t = l.topic ? topicById(l.topic) : null;
        if (t) {
          const ts = topicStars(t);
          path.appendChild(el('div', { class: 'path-head', style: { '--c': l.color } }, el('b', { text: t.title }),
            el('span', { class: 'ph-right' }, t.focus ? el('span', { class: 'ph-chip', text: 'Klausur' }) : null,
              el('span', { class: 'ph-stars', 'aria-label': ts.got + ' von ' + ts.max + ' Sternen' }, stars(1, 14).firstChild, String(ts.got) + '/' + ts.max))));
        }
        else if (l.kind === 'exam') path.appendChild(el('div', { class: 'path-head', style: { '--c': l.color } }, el('b', { text: 'Probeklausuren' })));
        else if (l.kind === 'essay') path.appendChild(el('div', { class: 'path-head', style: { '--c': l.color } }, el('b', { text: l.name + 's' })));
      }
      const done = levelDone(l), isCur = i === cur, locked = !done && i > cur;
      const x = Math.round(Math.sin(i * 1.15) * 62);
      const node = el('button', {
        class: 'lvl' + (done ? ' done' : '') + (isCur ? ' cur' : '') + (locked ? ' locked' : ''), style: { '--c': l.color, '--x': x + 'px' },
        'aria-label': 'Level ' + l.n + ': ' + (l.topic ? l.title + ' – ' : '') + l.name + (locked ? ' (gesperrt)' : ''),
        onclick: () => (locked ? toast('Erst Level ' + (cur + 1) + ' schaffen.') : go('#/level/' + encodeURIComponent(l.id))),
      },
      isCur ? el('span', { class: 'lvl-bubble' }, el('b', { text: 'Level ' + l.n }), el('span', { text: l.name })) : null,
      el('span', { class: 'lvl-dot' }, icon(locked ? 'lock' : KIND[l.kind].icon)),
      done ? stars(P.levels[l.id].stars, 18) : isCur ? null : el('span', { class: 'lvl-n', text: l.name }));
      path.appendChild(node);
    });
    const allDone = L.every(levelDone);
    // alles geschafft: das erste Level ohne 3 Sterne verbessern, sonst die letzte Wiederholung
    const weak = allDone ? L.find((l) => (P.levels[l.id].stars || 0) < 3) : null;
    const L0 = allDone ? weak || L.filter((l) => l.kind === 'review').pop() || L[cur] : L[cur];
    const label = allDone ? (weak ? 'Mehr Sterne: Level ' + L0.n : 'Alles geschafft – nochmal üben') : (L.some(levelDone) ? 'Weiter: Level ' : 'Los geht’s: Level ') + L0.n;
    const startBar = el('div', { class: 'start-bar' },
      el('button', { class: 'btn primary block start-btn', style: { background: L0.color }, onclick: () => go('#/level/' + encodeURIComponent(L0.id)) },
        el('span', null, el('b', { text: label }), el('small', { text: (L0.topic ? L0.title + ' · ' : '') + L0.name }))));
    screen({ title: null, cls: 'path-page' }, bar, path, startBar);
    requestAnimationFrame(() => { const n = app.querySelector('.lvl.cur'); if (n) n.scrollIntoView({ block: 'center' }); });
  }

  // ---------- Level starten (bei neuem Thema erst das Video anbieten) ----------
  function startLevel(l, opts) {
    opts = opts || {};
    const via = location.hash.startsWith('#/level/') ? (h) => location.replace(h) : go;
    if (l.kind === 'exam') { via('#/klausur/' + l.exam); return; }
    if (l.kind === 'essay') { via('#/aufsatz/' + l.essay); return; }
    const t = l.topic ? topicById(l.topic) : null;
    // neues Thema: erst Video oder (ohne Video) die Merkkarten anbieten
    const seen = t ? P.seen[t.id] || {} : {};
    if (!opts.skipIntro && l.kind === 'choose' && t && !seen.intro && (hasVideo(t) ? !seen.video : (t.cards || []).length && !seen.cards)) return viewLevelIntro(l);
    const items = levelItems(l);
    if (!items.length) { toast('Für dieses Level gibt es noch keine Aufgaben.'); go('#/'); return; }
    startSession(items, 'Level ' + l.n, '#/', t, l);
  }
  function viewLevelIntro(l) {
    const t = topicById(l.topic);
    const s = subjectById(l.subject);
    const ventry = (s.playlist || []).find((e) => e.topic === t.id);
    const go2 = () => { markSeen(t.id, 'intro'); startLevel(l, { skipIntro: true }); };
    const vid = hasVideo(t);
    const nCards = (t.cards || []).length;
    screen({ title: 'Level ' + l.n, sub: t.title, back: '#/', color: colorOf(t), cls: 'intro' },
      el('section', { class: 'card intro-card', style: { '--c': colorOf(t) } },
        el('span', { class: 'intro-ic' }, icon(vid ? 'play' : 'book')),
        el('div', { class: 'eyebrow', text: 'Neues Thema' }),
        el('h2', { text: t.title }),
        t.short ? el('p', { class: 'intro-short', text: t.short }) : null,
        el('p', { class: 'muted', text: vid ? 'Schau dir zuerst das kurze Video an. Danach geht es direkt mit dem Level los.'
          : 'Lies zuerst die ' + nCards + ' kurzen Merkkarten. Danach geht es direkt mit dem Level los.' })),
      vid ? el('button', { class: 'btn primary block', style: { background: colorOf(t) }, onclick: () => playVideo(topicVideo(t), null, go2) }, icon('play'),
        'Video ansehen' + (ventry && ventry.sec ? ' (' + fmtDur(ventry.sec).replace(' Min.', '') + ')' : ''))
        : el('button', { class: 'btn primary block', style: { background: colorOf(t) }, onclick: () => viewCards(t, go2) }, icon('book'), 'Kurz erklärt (' + nCards + ' Karten)'),
      el('button', { class: 'btn ghost block', onclick: go2 }, vid ? 'Ohne Video starten' : 'Direkt starten'));
  }

  // =====================================================================
  // Themen-Übersicht (im Menü)
  // =====================================================================
  function topicStars(t) {
    const s = subjectById(t._subject);
    const ls = pathOf(s).filter((l) => l.topic === t.id);
    return { got: ls.reduce((a, l) => a + ((P.levels[l.id] || {}).stars || 0), 0), max: ls.length * 3, levels: ls };
  }
  function viewThemen(s) {
    const list = el('section', { class: 'topic-list' });
    s.topics.forEach((t, i) => {
      const ts = topicStars(t);
      list.appendChild(el('a', { class: 'topic-row', href: '#/t/' + t.id, style: { '--c': colorOf(t) } },
        el('span', { class: 'tr-num', text: String(i + 1) }),
        el('span', { class: 'tr-text' }, el('b', { text: t.title }),
          el('span', { class: 'tr-sub' }, el('span', { class: 'tr-bar' }, el('i', { style: { width: Math.round(100 * ts.got / (ts.max || 1)) + '%' } })),
            el('span', { class: 'small muted', text: '★ ' + ts.got + '/' + ts.max }),
            t.focus ? el('span', { class: 'chip', style: { '--c': s.color }, text: 'Klausur' }) : null)),
        icon('chev', 'chev')));
    });
    screen({ title: 'Themen', sub: s.name, back: '#/', color: s.color },
      el('p', { class: 'muted', text: 'Hier kannst du ein Thema gezielt anschauen oder üben.' }), list);
  }
  function viewTopic(t) {
    const s = subjectById(t._subject);
    const seen = P.seen[t.id] || {};
    const ts = topicStars(t);
    const ventry = (s.playlist || []).find((e) => e.topic === t.id);
    const cur = currentIndex(s);
    const levelRow = el('section', { class: 'card topic-levels' },
      el('b', { text: 'Level in diesem Thema' }),
      el('div', { class: 'tl-row' }, ts.levels.map((l, k) => {
        // über die Themen-Übersicht darf man jedes Thema beginnen; innerhalb des Themas geht es Level für Level
        const done = levelDone(l), locked = !done && l.i > cur && k > 0 && !levelDone(ts.levels[k - 1]);
        return el('button', { class: 'tl-chip' + (locked ? ' locked' : ''), style: { '--c': colorOf(t) },
          onclick: () => (locked ? toast('Erst Level ' + ts.levels[k - 1].n + ' schaffen.') : go('#/level/' + encodeURIComponent(l.id))) },
        el('span', { class: 'small', text: 'Level ' + l.n }), el('b', { text: l.name }), done ? stars(P.levels[l.id].stars, 14) : icon(locked ? 'lock' : KIND[l.kind].icon));
      })));
    const btn = (ic, label, sub, onclick, done) => el('button', { class: 'action', style: { '--c': colorOf(t) }, onclick },
      el('span', { class: 'act-ic' }, icon(ic)), el('span', { class: 'act-text' }, el('b', { text: label }), el('span', { class: 'small', text: sub })),
      done ? el('span', { class: 'act-done' }, icon('check')) : icon('chev', 'chev'));
    screen({ title: t.title, sub: s.name, back: '#/f/' + s.id, color: colorOf(t) },
      levelRow,
      el('section', { class: 'actions' },
        hasVideo(t) ? btn('play', 'Video', 'Erklärvideo' + (ventry && ventry.sec ? ' · ' + fmtDur(ventry.sec) : ''), () => playVideo(topicVideo(t)), seen.video) : null,
        btn('book', 'Erklärung', t.cards.length + ' Merkkarten + Beispiel', () => go('#/t/' + t.id + '/lernen'), seen.cards && seen.example),
        btn('pencil', 'Frei üben', 'Alle ' + t.exercises.length + ' Aufgaben', () => go('#/t/' + t.id + '/ueben'), false),
        btn('alert', 'Häufige Fehler', t.mistakes.length + ' typische Fehler', () => go('#/t/' + t.id + '/fehler'), false)));
  }

  // ---------- Video ----------
  // e = {video, title, topic}; list = Video-Liste (geht danach von selbst weiter); after = nach dem Ende aufrufen
  async function playVideo(e, list, after) {
    const info = META.videos[e.video];
    if (!info) { toast('Das Video gibt es noch nicht.'); return; }
    const overlay = el('div', { class: 'overlay video-ov' });
    const status = el('div', { class: 'video-status', text: 'Video wird geladen …' });
    const closeAll = () => { clearTimeout(overlay._next); overlay.remove(); route(); };
    const close = el('button', { class: 'icon-btn ov-close', 'aria-label': 'Schließen', onclick: closeAll }, icon('close'));
    put(overlay, close, status);
    document.body.appendChild(overlay);
    try {
      const url = await LCrypto.videoUrl(KEY, info.file);
      const v = el('video', { class: 'video', src: url, controls: true, playsinline: true, autoplay: true, preload: 'auto' });
      v.addEventListener('timeupdate', () => { if (v.duration && v.currentTime / v.duration > 0.8) markVideo(e); });
      const idx = list ? list.findIndex((x) => x.video === e.video) : -1;
      const next = idx >= 0 && idx + 1 < list.length ? list[idx + 1] : null;
      const goNext = () => { clearTimeout(overlay._next); overlay.remove(); playVideo(next, list); };
      v.addEventListener('ended', () => {
        markVideo(e);
        if (after) {
          overlay.appendChild(el('button', { class: 'btn primary next-video', onclick: () => { clearTimeout(overlay._next); overlay.remove(); after(); } }, 'Weiter zum Level'));
          overlay._next = setTimeout(() => { if (overlay.isConnected) { overlay.remove(); after(); } }, 2500);
          return;
        }
        if (!next) return;
        overlay.appendChild(el('button', { class: 'btn primary next-video', onclick: goNext }, 'Weiter: ' + next.title));
        overlay._next = setTimeout(() => { if (overlay.isConnected) goNext(); }, 4000);
      });
      v.addEventListener('play', () => { clearTimeout(overlay._next); const nb = overlay.querySelector('.next-video'); if (nb) nb.remove(); });
      status.replaceWith(v);
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeAll(); });
    } catch (err) {
      status.textContent = 'Das Video konnte nicht geladen werden. Prüfe die Internetverbindung.';
    }
  }

  // ---------- Alle Formel-Videos eines Fachs ----------
  function viewVideos(s) {
    const pl = playlistOf(s);
    if (!pl.length) return viewThemen(s);
    const first = pl.find((e) => !videoSeen(e)) || pl[0];
    const rows = el('section', { class: 'topic-list' }, pl.map((e, i) => el('button', { class: 'topic-row vrow', onclick: () => playVideo(e, pl) },
      el('span', { class: 'vnum' + (videoSeen(e) ? ' seen' : ''), style: { '--c': s.color } }, videoSeen(e) ? icon('check') : String(i + 1)),
      el('span', { class: 'tr-text' }, el('b', { text: e.title }), el('span', { class: 'small muted', text: fmtDur(e.sec) })),
      icon('play', 'chev'))));
    screen({ title: 'Alle Videos', sub: s.name, back: '#/', color: s.color },
      el('p', { class: 'muted', text: 'Zu jeder Formel ein kurzes Video: woran du sie erkennst, wie sie aufgebaut ist, ein Beispiel und ein Kurz-Check.' }),
      el('button', { class: 'btn primary block', style: { background: s.color }, onclick: () => playVideo(first, pl) }, icon('play'),
        first === pl[0] ? 'Alle abspielen' : 'Weiter mit Video ' + (pl.indexOf(first) + 1)),
      el('h2', { text: pl.length + ' Videos' }), rows);
  }

  // ---------- Erklärung: Merkkarten, dann Beispiel ----------
  // after: beim Einstieg in ein neues Level – nach der letzten Karte geht es direkt los
  function viewCards(t, after) {
    let i = 0;
    const main = screen({ title: after ? 'Kurz erklärt' : 'Erklärung', sub: t.title, back: after ? '#/' : '#/t/' + t.id, color: colorOf(t) });
    function draw() {
      main.innerHTML = '';
      const c = t.cards[i];
      const card = el('section', { class: 'card learn-card', style: { '--c': colorOf(t) } },
        el('div', { class: 'eyebrow', text: (i + 1) + ' / ' + t.cards.length }),
        el('h2', { text: c.title }), el('p', { text: c.body }),
        c.formula ? formulaBox(c.formula, 'big') : null,
        c.diagram ? diagram(c.diagram) : null);
      const dots = el('div', { class: 'dots' }, t.cards.map((_, k) => el('i', { class: k === i ? 'on' : '' })));
      const nav = el('div', { class: 'row-btns' },
        el('button', { class: 'btn ghost', disabled: i === 0, onclick: () => { i--; draw(); } }, 'Zurück'),
        i < t.cards.length - 1
          ? el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { i++; draw(); } }, 'Weiter')
          : el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { markSeen(t.id, 'cards'); if (after) after(); else go('#/t/' + t.id + '/beispiel'); } }, after ? 'Los geht’s' : 'Zum Beispiel'));
      put(main, card, dots, nav);
      let x0 = null;
      card.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
      card.addEventListener('touchend', (e) => {
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (dx < -50 && i < t.cards.length - 1) { i++; draw(); } else if (dx > 50 && i > 0) { i--; draw(); }
        x0 = null;
      });
    }
    draw();
  }
  function viewExample(t) {
    const ex = t.example;
    if (ex.segments) return viewTextExample(t);
    let i = 0;
    const main = screen({ title: 'Beispiel', sub: ex.title, back: '#/t/' + t.id, color: colorOf(t) });
    function draw() {
      main.innerHTML = '';
      const s = ex.steps[i];
      const show = s.show || {};
      const grid = sheetGrid(ex.sheet, { target: show.range ? null : ex.target, hl: s.hl, show: show.range ? show : null, autoScroll: false });
      const bar = el('div', { class: 'f-line static' }, el('span', { class: 'fx', text: 'fx' }), formulaBox(s.formula || ''));
      const card = el('section', { class: 'card step-card' }, el('div', { class: 'eyebrow', text: 'Schritt ' + (i + 1) + ' / ' + ex.steps.length }), el('p', { text: s.text }),
        show.diagram ? diagram(show.diagram, { small: true }) : null);
      const nav = el('div', { class: 'row-btns sticky-nav' },
        el('button', { class: 'btn ghost', disabled: i === 0, onclick: () => { i--; draw(); } }, 'Zurück'),
        i < ex.steps.length - 1
          ? el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { i++; draw(); } }, 'Weiter')
          : el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { markSeen(t.id, 'example'); go('#/t/' + t.id); } }, 'Fertig'));
      put(main, card, bar, grid, nav);
    }
    draw();
  }

  // Mustertext Schritt für Schritt: der gerade erklärte Teil ist markiert
  function viewTextExample(t) {
    const ex = t.example;
    let i = 0;
    const main = screen({ title: 'Beispiel', sub: ex.title, back: '#/t/' + t.id, color: colorOf(t) });
    function draw() {
      main.innerHTML = '';
      const st = ex.steps[i];
      const block = ex.segments.some((x) => x.length > 120);
      const text = el('section', { class: 'card model-text' + (block ? ' blocks' : ''), lang: 'en', style: { '--c': colorOf(t) } },
        ex.segments.map((seg, k) => el(block ? 'p' : 'span', { class: 'seg' + (st.hl.includes(k) ? ' on' : ''), text: seg + (block ? '' : ' ') })));
      const card = el('section', { class: 'card step-card' }, el('div', { class: 'eyebrow', text: 'Schritt ' + (i + 1) + ' / ' + ex.steps.length }), el('p', { text: st.text }));
      const nav = el('div', { class: 'row-btns sticky-nav' },
        el('button', { class: 'btn ghost', disabled: i === 0, onclick: () => { i--; draw(); } }, 'Zurück'),
        i < ex.steps.length - 1
          ? el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { i++; draw(); } }, 'Weiter')
          : el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { markSeen(t.id, 'example'); go('#/t/' + t.id); } }, 'Fertig'));
      put(main, card, text, nav);
    }
    draw();
  }

  // ---------- Häufige Fehler ----------
  function mistakeCard(m, count, open) {
    const val = (txt) => (m.lang === 'en' ? el('span', { class: 'm-txt', lang: 'en', text: txt }) : el('code', { text: txt }));
    const body = el('div', { class: 'm-body' },
      el('div', { class: 'm-line bad' }, el('span', { class: 'm-tag', text: 'Falsch' }), val(m.falsch)),
      el('div', { class: 'm-line good' }, el('span', { class: 'm-tag', text: 'Richtig' }), val(m.richtig)),
      el('p', null, el('b', { text: 'Warum: ' }), m.warum),
      el('p', { class: 'tipp' }, el('b', { text: 'Tipp: ' }), m.tipp));
    const det = el('details', { class: 'card mistake' + (count ? ' mine' : '') }, el('summary', null, el('span', { text: m.title }), count ? el('i', { class: 'count', text: count + '×' }) : null), body);
    if (open) det.open = true;
    return det;
  }
  function viewTopicMistakes(t) {
    const list = t.mistakes.map((id) => mistakeById(id)).filter(Boolean).map((m) => mistakeCard(m, P.mistakes[m.id] && P.mistakes[m.id].n));
    screen({ title: 'Häufige Fehler', sub: t.title, back: '#/t/' + t.id, color: colorOf(t) },
      el('p', { class: 'muted', text: 'Tippe auf einen Fehler, um Beispiel und Tipp zu sehen.' }), ...list);
  }
  function viewMistakes(s) {
    const ids = new Set((s.mistakes || []).map((m) => m.id));
    const mine = Object.entries(P.mistakes).filter(([id]) => ids.has(id)).sort((a, b) => b[1].n - a[1].n);
    const parts = [];
    if (mine.length) {
      parts.push(el('h2', { text: 'Deine Fehler' }));
      mine.slice(0, 6).forEach(([id, r]) => parts.push(mistakeCard(mistakeById(id), r.n)));
      const items = [...new Set(mine.flatMap(([, r]) => r.items))].map((id) => EXS.get(id)).filter(Boolean);
      if (items.length) parts.push(el('button', { class: 'btn primary block', style: { background: s.color }, onclick: () => startSession(interleave(shuffle(items)).slice(0, 10), 'Fehler üben', '#/f/' + s.id + '/fehler') }, 'Diese Fehler üben'));
    } else {
      parts.push(el('p', { class: 'muted', text: 'Wenn dir beim Üben ein typischer Fehler passiert, steht er hier oben – mit Zähler.' }));
    }
    parts.push(el('h2', { text: 'Alle häufigen Fehler' }));
    for (const t of s.topics) {
      const ms = (s.mistakes || []).filter((m) => m.topic === t.id);
      if (!ms.length) continue;
      parts.push(el('h3', { class: 'group-h', style: { color: colorOf(t) }, text: t.title }));
      ms.forEach((m) => parts.push(mistakeCard(m, P.mistakes[m.id] && P.mistakes[m.id].n)));
    }
    screen({ title: 'Häufige Fehler', sub: s.name, back: '#/', color: s.color }, ...parts);
  }

  // =====================================================================
  // Runde (Level oder freies Üben)
  // =====================================================================
  let session = null;
  function startTopicPractice(t) {
    const order = t.exercises.slice().sort((a, b) => box(a.id) - box(b.id));
    const open = order.filter((e) => box(e.id) < 5);
    startSession(open.length ? open : shuffle(order), t.title, '#/t/' + t.id, t);
  }
  function startSession(items, title, back, topic, level) {
    if (!items.length) { toast('Keine Aufgaben gefunden.'); return; }
    session = { items: items.slice(), idx: 0, title, back, topic, level: level || null, results: [], requeued: new Set(), mids: [], first: items.length };
    // Routen, die sofort eine Runde starten, ersetzen – sonst führt „Zurück“ wieder hinein
    if (/\/ueben$/.test(location.hash) || location.hash.startsWith('#/level/')) { history.replaceState(null, '', '#/session'); renderSession(); }
    else if (location.hash !== '#/session') location.hash = '#/session';
    else renderSession();
  }
  function renderSession() {
    const s = session;
    if (s.idx >= s.items.length) return s.level ? renderLevelEnd() : renderSessionEnd();
    const ex = s.items[s.idx];
    const t = topicById(ex._topic) || s.topic;
    const l = s.level;
    const col = l ? l.color : t ? colorOf(t) : '#2F7DE1';
    const prog = el('div', { class: 'progress-row' }, el('div', { class: 'progress' }, el('i', { style: { width: Math.max(4, Math.round(100 * s.idx / s.items.length)) + '%', background: col } })),
      el('span', { class: 'prog-n', text: (s.idx + 1) + '/' + s.items.length }));
    // die Zahl steht schon neben dem Balken
    const sub = l ? (l.topic ? l.title + ' · ' : '') + l.name : (t && t.title !== s.title ? t.title : null);
    const main = screen({ title: s.title, sub, back: s.back, color: col, cls: 'session' });
    main.appendChild(prog);
    let finished = false;
    const done = (outcome, mids) => {
      if (finished) return;
      finished = true;
      grade(ex.id, outcome);
      s.results.push({ id: ex.id, outcome });
      (mids || []).forEach((m) => s.mids.push(m));
      if (['wrong', 'shown', 'unknown'].includes(outcome) && !s.requeued.has(ex.id)) { s.items.push(ex); s.requeued.add(ex.id); }
      s.idx++;
      renderSession();
    };
    main.appendChild(viewExercise(ex, done, t));
  }
  function firstTryScore(s) {
    const firstTry = new Map();
    for (const r of s.results) if (!firstTry.has(r.id)) firstTry.set(r.id, r.outcome);
    const n = firstTry.size;
    const ok = [...firstTry.values()].filter((o) => o === 'first' || o === 'known').length;
    return { n, ok };
  }
  function goalLine() {
    const st = streak();
    return el('div', { class: 'goal-line' }, el('span', { class: 'gl-flame' + (st ? ' on' : '') }, icon('flame'), el('b', { text: String(st) })),
      el('span', { class: 'small muted', text: countOn(today()) >= goal() ? 'Tagesziel für heute geschafft.' : 'Noch ' + (goal() - countOn(today())) + (goal() - countOn(today()) === 1 ? ' Aufgabe' : ' Aufgaben') + ' bis zum Tagesziel.' }));
  }
  function roundMistakes(s) {
    const mids = [...new Set(s.mids)].map(mistakeById).filter(Boolean);
    if (!mids.length) return [];
    return [el('h2', { text: 'Fehler in dieser Runde' })].concat(mids.map((m) => mistakeCard(m, P.mistakes[m.id] && P.mistakes[m.id].n)));
  }
  function renderSessionEnd() {
    const s = session;
    const { n, ok } = firstTryScore(s);
    s.ended = true;
    const parts = [
      el('section', { class: 'card done-card' },
        el('div', { class: 'eyebrow', text: 'Runde fertig' }),
        el('div', { class: 'big', text: ok + ' von ' + n + ' richtig' }),
        el('div', { class: 'muted small', text: 'beim ersten Versuch' }), goalLine()),
      ...roundMistakes(s),
      el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: () => go(s.back) }, 'Fertig'),
        el('button', { class: 'btn primary', onclick: () => { const items = [...new Set(s.results.map((r) => r.id))].map(exById).filter(Boolean); startSession(shuffle(items), s.title, s.back, s.topic); } }, 'Nochmal'))];
    screen({ title: s.title, back: s.back }, ...parts);
  }
  // Ende eines Levels: Sterne, dann direkt weiter zum nächsten Level
  function renderLevelEnd() {
    const s = session, l = s.level;
    const { n, ok } = firstTryScore(s);
    const got = starsFor(ok, n);
    s.ended = true;
    const before = (P.levels[l.id] || {}).stars || 0;
    const rec = P.levels[l.id] || { stars: 0, plays: 0 };
    rec.stars = Math.max(rec.stars || 0, got);
    rec.plays = (rec.plays || 0) + 1;
    rec.last = today();
    P.levels[l.id] = rec;
    saveP();
    checkRewards();
    const L = pathOf(subjectById(l.subject));
    const next = L[l.i + 1] || null;
    const title = got === 3 ? 'Perfekt!' : got === 2 ? 'Gut gemacht!' : 'Geschafft!';
    const parts = [
      el('section', { class: 'card level-result', style: { '--c': l.color } },
        el('div', { class: 'eyebrow', text: 'Level ' + l.n + ' · ' + l.name }),
        stars(got, 54),
        el('div', { class: 'big', text: title }),
        el('div', { class: 'muted', text: ok + ' von ' + n + ' beim ersten Versuch richtig' }),
        before && got > before ? el('div', { class: 'small lr-better', text: 'Neuer Rekord für dieses Level!' }) : null,
        got < 3 ? el('div', { class: 'small muted', text: got === 1 ? 'Ab 60 % gibt es 2 Sterne, ab 90 % 3 Sterne.' : 'Ab 90 % gibt es 3 Sterne.' }) : null,
        goalLine()),
      next ? el('button', { class: 'btn primary block', style: { background: next.color }, onclick: () => location.replace('#/level/' + encodeURIComponent(next.id)) },
        'Weiter: ' + nextName(next)) : null,
      el('div', { class: 'row-links' },
        el('button', { class: 'link-btn', onclick: () => startLevel(l, { skipIntro: true }) }, 'Level nochmal'),
        el('button', { class: 'link-btn', onclick: () => go('#/') }, 'Zur Übersicht')),
      ...roundMistakes(s)];
    screen({ title: 'Level ' + l.n, back: '#/', color: l.color }, ...parts);
    if (got === 3) confetti(app.querySelector('.level-result'));
  }
  const nextName = (l) => (l.kind === 'exam' || l.kind === 'essay' ? l.name : 'Level ' + l.n);
  // kleines Konfetti für 3 Sterne (nicht bei „weniger Bewegung“)
  function confetti(host) {
    if (!host || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const cols = ['#F5B301', '#4F5BD5', '#0E9F8E', '#E8762B', '#DD4238', '#2F7DE1'];
    const box = el('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 26; i++) {
      box.appendChild(el('i', { style: { left: (8 + Math.random() * 84) + '%', background: cols[i % cols.length], animationDelay: (Math.random() * 0.25).toFixed(2) + 's',
        '--dx': Math.round((Math.random() - 0.5) * 140) + 'px', '--r': Math.round(Math.random() * 720 - 360) + 'deg' } }));
    }
    host.appendChild(box);
    setTimeout(() => box.remove(), 2400);
  }

  // ---------- eine Aufgabe ----------
  const FNS = {
    bezuege: [], prozent: ['SUMME(', 'RUNDEN('], statistik: ['SUMME(', 'MITTELWERT(', 'MIN(', 'MAX(', 'ANZAHL(', 'ANZAHL2(', 'HEUTE()'],
    wenn: ['WENN('], wenn2: ['WENN('], zaehlenwenn: ['ZÄHLENWENN(', 'SUMMEWENN(', 'SUMME('], undoder: ['WENN(', 'UND(', 'ODER(', 'ZÄHLENWENN('],
    sverweis: ['SVERWEIS(', 'FALSCH', 'WAHR'], exam: ['WENN(', 'UND(', 'ODER(', 'ZÄHLENWENN(', 'SUMMEWENN(', 'SVERWEIS(', 'FALSCH', 'WAHR', 'SUMME(', 'MITTELWERT(']
  };
  function viewExercise(ex, done, t) {
    switch (ex.type) {
      case 'formel': return viewFormel(ex, done, t);
      case 'wahl': return viewWahl(ex, done);
      case 'ergebnis': return viewErgebnis(ex, done);
      case 'ordnen': return viewOrdnen(ex, done);
      case 'karte': return viewKarte(ex, done);
      case 'luecke': return viewLuecke(ex, done);
      case 'schreiben': return viewSchreiben(ex, done);
    }
    return el('p', { text: 'Unbekannter Aufgabentyp.' });
  }
  // ---------- Lückentext: das fehlende Wort eintippen ----------
  const normA = (x) => String(x || '').toLowerCase().replace(/[’`´]/g, "'").replace(/[.,!?;:"“”„]/g, ' ').replace(/\s+/g, ' ').trim();
  function gapSentence(text, gapNode) {
    const [a, b] = String(text).split('___');
    return el('p', { class: 'gap-text', lang: 'en' }, a, gapNode, b || '');
  }
  function viewLuecke(ex, done) {
    let attempts = 0, outcome = null;
    const mids = [];
    const wrap = el('div', { class: 'ex ex-luecke' });
    const gap = el('span', { class: 'gap' }, '…');
    const input = el('input', { type: 'text', class: 'v-input gap-input', placeholder: 'Wort eintippen', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', lang: 'en' });
    input.addEventListener('input', () => { gap.textContent = input.value.trim() || '…'; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!outcome) check(); } });
    const fbSlot = el('div');
    const btnCheck = el('button', { class: 'btn primary', onclick: () => check() }, 'Prüfen');
    const btnNext = el('button', { class: 'btn primary', style: { display: 'none' }, onclick: () => done(outcome, mids) }, 'Weiter');
    const also = () => (ex.answers.length > 1 ? ' – auch möglich: ' + ex.answers.slice(1).join(', ') : '');
    function check() {
      const v = normA(input.value);
      if (!v) { toast('Bitte zuerst etwas eintippen.'); return; }
      attempts++;
      const ok = ex.answers.some((a) => normA(a) === v);
      const known = (ex.wrong || []).find((w) => normA(w.t) === v);
      const kmid = known && known.mid ? [known.mid] : [];
      fbSlot.innerHTML = '';
      if (ok) {
        outcome = attempts === 1 ? 'first' : 'fast';
        gap.classList.add('ok');
        fbSlot.appendChild(feedbackBox({ status: 'richtig', title: 'Richtig', msgs: [ex.answers[0] + also()].concat(ex.explain ? [ex.explain] : []) }));
      } else {
        if (kmid.length) { mids.push(kmid[0]); recordMistakes(kmid, ex.id); }
        if (attempts < 2) {
          fbSlot.appendChild(feedbackBox({ status: 'falsch', title: 'Noch nicht richtig', msgs: [known && known.why ? known.why : 'Probier es noch einmal.'], mids: kmid }));
          input.select();
          return;
        }
        outcome = 'wrong';
        gap.textContent = ex.answers[0];
        gap.classList.add('shown');
        fbSlot.appendChild(feedbackBox({ status: 'falsch', title: 'Leider falsch', msgs: ['Richtig: ' + ex.answers[0] + also()].concat(known && known.why ? [known.why] : []).concat(ex.explain ? [ex.explain] : []), mids: kmid }));
      }
      input.disabled = true;
      btnCheck.style.display = 'none';
      btnNext.style.display = '';
      fbSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    put(wrap, el('div', { class: 'eyebrow ex-kind', text: 'Tippe das fehlende Wort ein' }), el('p', { class: 'prompt', text: ex.prompt }),
      el('section', { class: 'card gap-card' }, gapSentence(ex.text, gap)), input, fbSlot, el('div', { class: 'row-btns' }, btnCheck, btnNext));
    return wrap;
  }
  // ---------- selbst schreiben: automatische Prüfpunkte, dann ein Mustertext ----------
  function checklistEl(res) {
    return el('ul', { class: 'checklist' }, res.map((r) => el('li', { class: r.ok ? 'ok' : 'bad' }, el('span', { class: 'ck' }, icon(r.ok ? 'check' : 'close')),
      el('span', null, el('b', { text: r.label }), r.hint ? el('small', { text: ' · ' + r.hint }) : null))));
  }
  function viewSchreiben(ex, done) {
    let attempts = 0, outcome = null;
    const sub = subjectById(topicById(ex._topic)._subject);
    const wrap = el('div', { class: 'ex ex-schreiben' });
    const ta = el('textarea', { class: 'w-input', rows: 5, placeholder: 'Schreibe hier auf Englisch …', lang: 'en', spellcheck: 'true', autocapitalize: 'sentences' });
    const wc = el('div', { class: 'small muted w-count' });
    const upd = () => { wc.textContent = TextCheck.words(ta.value) + ' Wörter'; };
    ta.addEventListener('input', upd);
    upd();
    const fbSlot = el('div');
    const btnCheck = el('button', { class: 'btn primary', onclick: () => check() }, 'Prüfen');
    const btnSol = el('button', { class: 'btn ghost', style: { display: 'none' }, onclick: () => finish(false) }, 'Mustertext');
    const btnNext = el('button', { class: 'btn primary', style: { display: 'none' }, onclick: () => done(outcome, []) }, 'Weiter');
    function finish(allOk) {
      outcome = allOk ? (attempts === 1 ? 'first' : 'fast') : 'shown';
      fbSlot.appendChild(el('div', { class: 'solution' }, el('span', { class: 'small muted', text: 'So könnte es aussehen' }), el('p', { class: 'model', lang: 'en', text: ex.model }),
        ex.explain ? el('p', { class: 'small', text: ex.explain }) : null));
      btnCheck.style.display = 'none';
      btnSol.style.display = 'none';
      btnNext.style.display = '';
      ta.readOnly = true;
    }
    function check() {
      if (TextCheck.words(ta.value) < 3) { toast('Schreib zuerst ein paar Wörter.'); return; }
      attempts++;
      const res = TextCheck.runChecks(ta.value, ex.checks, sub.wordbank);
      const allOk = res.every((r) => r.ok);
      fbSlot.innerHTML = '';
      fbSlot.appendChild(el('div', { class: 'feedback ' + (allOk ? 'ok' : 'warn') }, el('b', { class: 'fb-title' }, fbIcon(allOk ? 'ok' : 'warn'), allOk ? 'Alle Punkte erfüllt' : 'Fast – schau dir die roten Punkte an'), checklistEl(res)));
      if (allOk) finish(true);
      else { btnCheck.textContent = 'Nochmal prüfen'; btnSol.style.display = ''; }
      fbSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    put(wrap, el('div', { class: 'eyebrow ex-kind', text: 'Schreibe selbst (auf Englisch)' }), el('p', { class: 'prompt', text: ex.prompt }),
      el('section', { class: 'card task-card', lang: 'en' }, el('b', { text: ex.task })), ta, wc, fbSlot, el('div', { class: 'row-btns' }, btnSol, btnCheck, btnNext));
    return wrap;
  }
  const fbIcon = (cls) => el('span', { class: 'fb-ic' }, icon(cls === 'ok' ? 'check' : cls === 'warn' ? 'alert' : 'close'));
  function feedbackBox(r) {
    const cls = r.status === 'richtig' ? 'ok' : r.status === 'fast' ? 'warn' : 'bad';
    const fb = el('div', { class: 'feedback ' + cls, role: 'status' }, el('b', { class: 'fb-title' }, fbIcon(cls), r.title || (cls === 'ok' ? 'Richtig' : 'Noch nicht richtig')));
    for (const m of r.msgs || []) fb.appendChild(el('p', { text: m }));
    const mm = (r.mids || []).map(mistakeById).filter(Boolean)[0];
    if (mm) fb.appendChild(mistakeCard(mm, P.mistakes[mm.id] && P.mistakes[mm.id].n));
    return fb;
  }
  function viewFormel(ex, done) {
    let attempts = 0, firstStatus = null, solved = false, shown = false, closed = false;
    const lastMids = [];
    const wrap = el('div', { class: 'ex ex-formel' });
    const fi = formulaInput({ fns: FNS[ex._topic] || FNS.exam, onEnter: () => check() });
    let grid = sheetGrid(ex.sheet, { target: ex.target, fill: ex.fill, onCell: (a) => fi.insertRef(a), maxHeight: '44vh' });
    // zeigt, was die eingegebene Formel ausrechnen würde (wie in Excel nach dem Herunterziehen)
    function showResult(formula, status) {
      const cls = status === 'richtig' ? 'shown' : status === 'fast' ? 'shown-warn' : 'shown-bad';
      let f = String(formula || '').trim();
      if (f && f[0] !== '=') f = '=' + f;
      try {
        const g = sheetGrid(ex.sheet, { show: { range: ex.fill || (ex.target + ':' + ex.target), formula: f, cls }, onCell: (a) => fi.insertRef(a), maxHeight: '44vh' });
        grid.replaceWith(g);
        grid = g;
      } catch (e) { /* Formel nicht darstellbar */ }
    }
    const fbSlot = el('div');
    const btnCheck = el('button', { class: 'btn primary', onclick: () => check() }, 'Prüfen');
    const btnSol = el('button', { class: 'btn ghost', onclick: () => showSolution(), style: { display: 'none' } }, 'Lösung zeigen');
    const btnNext = el('button', { class: 'btn primary', onclick: () => next(), style: { display: 'none' } }, 'Weiter');
    put(wrap,
      el('div', { class: 'eyebrow ex-kind', text: 'Tippe die Formel ein' }),
      el('p', { class: 'prompt', text: ex.prompt }),
      ex.diagram ? diagram(ex.diagram, { small: true }) : null,
      grid,
      el('div', { class: 'hint-line small muted' }, 'Formel für ', el('b', { text: ex.target }), ex.fill ? ' · herunterziehbar bis ' + ex.fill.split(':')[1] : '', ' · Zellen antippen fügt sie ein'),
      fi.box, fbSlot, el('div', { class: 'row-btns' }, btnSol, btnCheck, btnNext));
    function check() {
      if (closed) return;
      const r = Checker.checkFormula(ex, fi.value(), { attempt: attempts + 1 });
      if (r.status === 'leer') { toast(r.msgs[0]); return; }
      attempts++;
      if (firstStatus === null) firstStatus = r.status;
      (r.mids || []).forEach((m) => lastMids.push(m));
      recordMistakes(r.mids, ex.id);
      if (r.status !== 'syntax') showResult(fi.value(), r.status);
      fbSlot.innerHTML = '';
      fbSlot.appendChild(feedbackBox(r));
      if (r.status === 'richtig') {
        solved = true;
        closed = true;
        fbSlot.appendChild(el('div', { class: 'solution' }, el('span', { class: 'small muted', text: 'Musterlösung' }), formulaBox(ex.solution), ex.explain ? el('p', { class: 'small', text: ex.explain }) : null));
        btnCheck.style.display = 'none';
        btnSol.style.display = 'none';
        btnNext.style.display = '';
      } else if (r.status === 'fast') {
        solved = true;
        btnCheck.textContent = 'Nochmal prüfen';
        btnSol.style.display = 'none';
        btnNext.style.display = '';
      } else if (attempts >= 2) btnSol.style.display = '';
      fbSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function showSolution() {
      shown = true;
      closed = true;
      showResult(ex.solution, 'richtig');
      fbSlot.innerHTML = '';
      fbSlot.appendChild(el('div', { class: 'solution' }, el('span', { class: 'small muted', text: 'Musterlösung' }), formulaBox(ex.solution), ex.explain ? el('p', { class: 'small', text: ex.explain }) : null,
        el('p', { class: 'small muted', text: 'Die Aufgabe kommt am Ende der Runde nochmal.' })));
      btnSol.style.display = 'none';
      btnCheck.style.display = 'none';
      btnNext.style.display = '';
    }
    function next() {
      let outcome;
      if (shown && !solved) outcome = 'shown';
      else if (!solved) outcome = 'wrong';
      else if (attempts === 1 && firstStatus === 'richtig') outcome = 'first';
      else if (firstStatus === 'fast') outcome = 'fast';
      else outcome = 'wrong';
      done(outcome, lastMids);
    }
    return wrap;
  }
  function optionNode(o) {
    if (o.d) return diagram(o.d, { small: true });
    if (o.f) return formulaBox(o.f);
    return el('span', { text: o.t });
  }
  const optKey = (i) => el('span', { class: 'opt-key', text: 'ABCDEFGH'[i] || String(i + 1) });
  const markKey = (btn, ic) => { const k = btn.querySelector('.opt-key'); if (k) { k.textContent = ''; k.appendChild(icon(ic)); } };
  function viewWahl(ex, done) {
    const wrap = el('div', { class: 'ex ex-wahl' });
    const opts = ex.keepOrder ? ex.options.slice() : shuffle(ex.options);
    const fbSlot = el('div');
    const btnNext = el('button', { class: 'btn primary', style: { display: 'none' } }, 'Weiter');
    let outcome = null, mid = null;
    const gap = ex.text ? el('span', { class: 'gap' }, '…') : null;
    const list = el('div', { class: 'options' + (ex.text ? ' words' : '') });
    opts.forEach((o, i) => {
      const b = el('button', { class: 'option' + (o.d ? ' has-diagram' : '') }, optKey(i), el('span', { class: 'opt-body' }, optionNode(o)));
      b.addEventListener('click', () => {
        if (outcome) return;
        outcome = o.ok ? 'first' : 'wrong';
        [...list.children].forEach((c, k) => { c.disabled = true; if (opts[k].ok) { c.classList.add('correct'); markKey(c, 'check'); } });
        if (!o.ok) { b.classList.add('wrong'); markKey(b, 'close'); if (o.mid) { mid = o.mid; recordMistakes([o.mid], ex.id); } }
        if (gap) { gap.textContent = (opts.find((x) => x.ok) || {}).t || ''; gap.classList.add(o.ok ? 'ok' : 'shown'); }
        const r = { status: o.ok ? 'richtig' : 'falsch', title: o.ok ? 'Richtig' : 'Leider falsch', msgs: [], mids: o.ok ? [] : (o.mid ? [o.mid] : []) };
        if (o.why) r.msgs.push(o.why);
        if (ex.explain) r.msgs.push(ex.explain);
        fbSlot.appendChild(feedbackBox(r));
        btnNext.style.display = '';
        fbSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      list.appendChild(b);
    });
    btnNext.addEventListener('click', () => done(outcome, mid ? [mid] : []));
    put(wrap, el('div', { class: 'eyebrow ex-kind', text: ex.text ? 'Welches Wort passt in die Lücke?' : ex.choose ? 'Welche Formel ist richtig?' : 'Wähle die richtige Antwort' }),
      el('p', { class: 'prompt', text: ex.prompt }), ex.text ? el('section', { class: 'card gap-card' }, gapSentence(ex.text, gap)) : null, ex.formula ? formulaBox(ex.formula, 'big') : null, ex.diagram ? diagram(ex.diagram, { small: true }) : null,
      ex.sheet ? sheetGrid(ex.sheet, { target: ex.target, fill: ex.fill, maxHeight: '36vh' }) : null, list, fbSlot, el('div', { class: 'row-btns' }, btnNext));
    return wrap;
  }
  function viewErgebnis(ex, done) {
    const wrap = el('div', { class: 'ex ex-ergebnis' });
    const expected = Checker.resultOf(ex, ex.formula);
    let attempts = 0, outcome = null;
    const input = el('input', { type: 'text', class: 'v-input', placeholder: 'Ergebnis', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
    const fbSlot = el('div');
    const btnCheck = el('button', { class: 'btn primary', onclick: () => check() }, 'Prüfen');
    const btnNext = el('button', { class: 'btn primary', style: { display: 'none' }, onclick: () => done(outcome, []) }, 'Weiter');
    function check() {
      if (outcome) return;
      const r = Checker.checkValue(expected, input.value);
      if (r.status === 'leer') { toast(r.msgs[0]); return; }
      attempts++;
      fbSlot.innerHTML = '';
      const ans = XL.formatValue(expected, ex.fmt);
      if (r.status === 'richtig') {
        outcome = attempts === 1 ? 'first' : 'fast';
        fbSlot.appendChild(feedbackBox({ status: 'richtig', title: 'Richtig', msgs: ['Excel zeigt: ' + ans].concat(ex.explain ? [ex.explain] : []) }));
      } else if (attempts < 2) {
        fbSlot.appendChild(feedbackBox({ status: 'falsch', title: 'Nicht ganz', msgs: (r.msgs || []).concat(['Rechne nochmal Schritt für Schritt.']) }));
        return;
      } else {
        outcome = 'wrong';
        fbSlot.appendChild(feedbackBox({ status: 'falsch', title: 'Leider falsch', msgs: ['Excel zeigt: ' + ans].concat(ex.explain ? [ex.explain] : []) }));
      }
      input.disabled = true;
      btnCheck.style.display = 'none';
      btnNext.style.display = '';
    }
    put(wrap, el('div', { class: 'eyebrow ex-kind', text: 'Was rechnet Excel aus?' }),
      el('p', { class: 'prompt', text: ex.prompt }), sheetGrid(ex.sheet, { target: ex.target, maxHeight: '40vh' }),
      el('div', { class: 'f-line static' }, el('span', { class: 'fx', text: ex.target }), formulaBox(ex.formula)),
      el('label', { class: 'v-label' }, 'Was zeigt Excel in ' + ex.target + '?', input), fbSlot, el('div', { class: 'row-btns' }, btnCheck, btnNext));
    return wrap;
  }
  function viewOrdnen(ex, done) {
    const wrap = el('div', { class: 'ex ex-ordnen' });
    const pool = shuffle(ex.parts.concat(ex.extra || []));
    const chosen = [];
    const answer = el('div', { class: 'order-answer' });
    const chips = el('div', { class: 'order-pool' });
    const fbSlot = el('div');
    const btnCheck = el('button', { class: 'btn primary', onclick: () => check() }, 'Prüfen');
    const btnNext = el('button', { class: 'btn primary', style: { display: 'none' } }, 'Weiter');
    let outcome = null;
    if (ex.long) { answer.classList.add('long'); chips.classList.add('long'); }
    function draw() {
      answer.innerHTML = '';
      answer.appendChild(el('span', { class: 'order-fix', text: ex.prefix || '' }));
      chosen.forEach((p, k) => {
        if (k) answer.appendChild(el('span', { class: 'order-fix', text: (ex.joiner || '; ').trim() }));
        answer.appendChild(el('button', { class: 'chip-btn on', onclick: () => { if (outcome) return; chosen.splice(k, 1); draw(); } }, p));
      });
      for (let k = chosen.length; k < ex.parts.length; k++) { if (k) answer.appendChild(el('span', { class: 'order-fix', text: (ex.joiner || '; ').trim() })); answer.appendChild(el('span', { class: 'slot' })); }
      answer.appendChild(el('span', { class: 'order-fix', text: ex.suffix || '' }));
      chips.innerHTML = '';
      pool.forEach((p) => {
        const used = chosen.includes(p);
        chips.appendChild(el('button', { class: 'chip-btn', disabled: used || !!outcome, onclick: () => { if (chosen.length < ex.parts.length) { chosen.push(p); draw(); } } }, p));
      });
    }
    function check() {
      if (chosen.length < ex.parts.length) { toast('Wähle zuerst alle Teile aus.'); return; }
      const ok = chosen.every((p, k) => p === ex.parts[k]);
      outcome = ok ? 'first' : 'wrong';
      fbSlot.appendChild(feedbackBox({ status: ok ? 'richtig' : 'falsch', title: ok ? 'Richtig' : 'Nicht ganz', msgs: (ok ? [] : ['Richtig: ' + (ex.prefix || '') + ex.parts.join((ex.joiner || '; ')) + (ex.suffix || '')]).concat(ex.explain ? [ex.explain] : []) }));
      btnCheck.style.display = 'none';
      btnNext.style.display = '';
      draw();
    }
    btnNext.addEventListener('click', () => done(outcome, []));
    draw();
    put(wrap, el('div', { class: 'eyebrow ex-kind', text: 'Bring die Teile in die richtige Reihenfolge' }),
      el('p', { class: 'prompt', text: ex.prompt }), answer, chips, fbSlot, el('div', { class: 'row-btns' }, btnCheck, btnNext));
    return wrap;
  }
  function viewKarte(ex, done) {
    const wrap = el('div', { class: 'ex ex-karte' });
    const back = el('div', { class: 'card flash-back', style: { display: 'none' } }, el('p', { text: ex.back }));
    const btnShow = el('button', { class: 'btn primary block' }, 'Antwort zeigen');
    const rate = el('div', { class: 'row-btns', style: { display: 'none' } },
      el('button', { class: 'btn ghost', onclick: () => done('unknown', []) }, 'Noch nicht gewusst'),
      el('button', { class: 'btn primary', onclick: () => done('known', []) }, 'Gewusst'));
    btnShow.addEventListener('click', () => { back.style.display = ''; rate.style.display = ''; btnShow.style.display = 'none'; });
    put(wrap, el('div', { class: 'card flash-front' }, el('div', { class: 'eyebrow', text: 'Frage' }), el('p', { class: 'big-q', text: ex.front })),
      el('p', { class: 'small muted', text: 'Überlege dir die Antwort, bevor du sie aufdeckst.' }), btnShow, back, rate);
    return wrap;
  }

  // =====================================================================
  // Linking words (Spickzettel) und Probe-Texte (Englisch)
  // =====================================================================
  function wordbankBody(s) {
    return (s.wordbank || []).map((g) => el('section', { class: 'card wb-group' }, el('div', { class: 'wb-head' }, el('b', { text: g.name }), el('span', { class: 'small muted', text: g.hint })),
      el('div', { class: 'wb-list' }, g.words.map((w) => el('div', { class: 'wb-row' }, el('span', { class: 'wb-en', lang: 'en', text: w[0] }), el('span', { class: 'wb-de', text: w[1] }))))));
  }
  function viewWordbank(s) {
    screen({ title: 'Linking words', sub: s.name, back: '#/', color: s.color },
      el('p', { class: 'muted', text: 'Die wichtigsten linking words für deinen Comment, nach Aufgabe sortiert. Am Satzanfang immer mit Komma: „However, …“' }), ...wordbankBody(s));
  }
  function wordbankOverlay(s) {
    closeMenu();
    const sheet = el('div', { class: 'menu-sheet wb-sheet', role: 'dialog', 'aria-label': 'Linking words' }, el('div', { class: 'menu-grab' }),
      el('div', { class: 'menu-title', text: 'Linking words' }), ...wordbankBody(s),
      el('button', { class: 'btn ghost block', onclick: () => closeMenu() }, 'Schließen'));
    menuEl = el('div', { class: 'menu-ov', onclick: (e) => { if (e.target === menuEl) closeMenu(); } }, sheet);
    document.body.appendChild(menuEl);
    requestAnimationFrame(() => menuEl && menuEl.classList.add('show'));
  }
  const essayById = (id) => { for (const s of SUBJECTS) for (const k of s.essays || []) if (k.id === id) return { k, s }; return null; };
  function viewEssays(s) {
    const name = (s.levelNames || {}).essay || 'Probe-Text';
    const parts = [el('p', { class: 'muted', text: 'Schreibe einen ganzen Text. Danach prüft die App Länge, Absätze, linking words und Stil und zeigt dir einen Mustertext.' })];
    for (const k of s.essays || []) {
      const st = P.essays[k.id] || {};
      parts.push(el('section', { class: 'card exam-item' },
        el('div', null, el('b', { text: k.title }), el('div', { class: 'small muted', text: 'ca. ' + k.minutes + ' Min. · mind. ' + k.minWords + ' Wörter' + (st.best ? ' · ★ ' + st.best : '') })),
        el('a', { class: 'btn primary', style: { background: s.color }, href: '#/aufsatz/' + k.id }, st.draft ? 'Weiter' : 'Starten')));
    }
    screen({ title: name, sub: s.name, back: '#/', color: s.color }, ...parts);
  }
  function viewEssay(id) {
    const f = essayById(id);
    if (!f) return viewPath();
    const { k, s } = f;
    const ta = el('textarea', { class: 'w-input essay-input', rows: 14, placeholder: 'Einleitung …\n\nHauptteil …\n\nSchluss …', lang: 'en', spellcheck: 'true', autocapitalize: 'sentences' });
    ta.value = (P.essays[k.id] || {}).draft || '';
    const info = el('span', { class: 'small muted' });
    const upd = () => { info.textContent = TextCheck.words(ta.value) + ' / ' + k.minWords + ' Wörter · ' + TextCheck.paragraphs(ta.value).length + ' Absätze'; };
    let tmr = null;
    const save = () => { clearTimeout(tmr); if (((P.essays[k.id] || {}).draft || '') !== ta.value) { P.essays[k.id] = Object.assign({}, P.essays[k.id], { draft: ta.value }); saveP(); } };
    ta.addEventListener('input', () => { upd(); clearTimeout(tmr); tmr = setTimeout(save, 600); });
    ta.addEventListener('blur', save);
    upd();
    screen({ title: k.title, back: '#/', color: s.color, cls: 'essay' },
      el('section', { class: 'card task-card', lang: 'en' }, el('div', { class: 'eyebrow', text: 'Aufgabe' }), el('b', { text: k.task })),
      el('p', { class: 'small muted', text: 'Schreibe Einleitung, Hauptteil (2–3 Absätze) und Schluss – jeden Absatz in eine neue Zeile. Dein Text wird automatisch gespeichert.' }),
      el('div', { class: 'essay-bar' }, info, el('button', { class: 'btn small-btn', onclick: () => wordbankOverlay(s) }, 'Linking words')),
      ta,
      el('button', { class: 'btn primary block', style: { background: s.color }, onclick: () => submitEssay(k, s, ta.value) }, 'Fertig – prüfen'));
    flushEssay = save;
  }
  function submitEssay(k, s, text) {
    if (TextCheck.words(text) < 40) { toast('Dein Text ist noch sehr kurz.'); return; }
    const a = TextCheck.analyse(text, { bank: s.wordbank, opinion: (s.lists || {}).opinion, conclude: (s.lists || {}).conclude, minWords: k.minWords });
    const okN = a.checks.filter((c) => c.ok).length;
    const got = okN >= 6 && a.checks[0].ok ? 3 : okN >= 4 ? 2 : 1;
    const er = P.essays[k.id] || {};
    P.essays[k.id] = Object.assign({}, er, { draft: text, best: Math.max(er.best || 0, got), last: today() });
    const lid = 'essay:' + k.id;
    const lr = P.levels[lid] || { stars: 0, plays: 0 };
    lr.stars = Math.max(lr.stars || 0, got);
    lr.plays = (lr.plays || 0) + 1;
    lr.last = today();
    P.levels[lid] = lr;
    countAnswer(got >= 2 ? 'first' : 'wrong', null);
    saveP();
    checkRewards();
    renderEssayResult(k, s, text, a, got);
    if (got === 3) confetti(app.querySelector('.level-result'));
  }
  function renderEssayResult(k, s, text, a, got) {
    const L = pathOf(s);
    const lvl = L.find((l) => l.id === 'essay:' + k.id);
    const next = lvl ? L[lvl.i + 1] : null;
    const bank = TextCheck.bankWords(s.wordbank);
    const toHtml = (t) => TextCheck.markHtml(t, bank).replace(/\n+/g, '<br><br>');
    screen({ title: k.title, back: '#/', color: s.color },
      el('section', { class: 'card level-result', style: { '--c': s.color } }, el('div', { class: 'eyebrow', text: 'Auswertung' }), stars(got, 54),
        el('div', { class: 'big', text: got === 3 ? 'Sehr gut!' : got === 2 ? 'Gut gemacht!' : 'Ein Anfang!' }),
        el('div', { class: 'muted', text: a.words + ' Wörter · ' + a.paragraphs + ' Absätze · ' + a.linking.length + ' linking words' })),
      el('h2', { text: 'Automatisch geprüft' }), el('section', { class: 'card' }, checklistEl(a.checks)),
      el('h2', { text: 'Prüfe selbst' }), el('section', { class: 'card' }, el('ul', { class: 'checklist self' }, (s.essaySelf || []).map((t) => el('li', null, el('label', null, el('input', { type: 'checkbox' }), el('span', { text: ' ' + t })))))),
      el('h2', { text: 'Dein Text' }), el('section', { class: 'card model-text', lang: 'en', html: toHtml(text) }),
      el('details', { class: 'card model-box' }, el('summary', null, 'Mustertext anzeigen'), el('div', { class: 'model-text', lang: 'en', html: toHtml(k.model) })),
      next ? el('button', { class: 'btn primary block', style: { background: next.color }, onclick: () => go('#/level/' + encodeURIComponent(next.id)) }, 'Weiter: ' + nextName(next)) : null,
      el('div', { class: 'row-links' }, el('button', { class: 'link-btn', onclick: () => viewEssay(k.id) }, 'Text überarbeiten'), el('button', { class: 'link-btn', onclick: () => go('#/') }, 'Zur Übersicht')));
  }

  // =====================================================================
  // Fächer wählen
  // =====================================================================
  function viewPicker() {
    const sel = new Set(P.subjects || SUBJECTS.map((s) => s.id));
    const list = el('div', { class: 'picker' });
    const draw = () => {
      list.innerHTML = '';
      for (const s of SUBJECTS) {
        const on = sel.has(s.id);
        list.appendChild(el('button', { class: 'pick' + (on ? ' on' : ''), style: { '--c': s.color }, onclick: () => { if (on) sel.delete(s.id); else sel.add(s.id); draw(); } },
          el('span', { class: 'pick-dot' }), el('span', { class: 'pick-text' }, el('b', { text: s.name }), el('span', { class: 'small muted', text: s.sub })),
          el('span', { class: 'pick-check' }, on ? icon('check') : null)));
      }
    };
    draw();
    screen({ title: 'Fächer wählen', back: '#/einstellungen' },
      el('p', { class: 'muted', text: 'Wähle deine Fächer. Neue Fächer kommen nach und nach dazu. Zwischen den Fächern wechselst du im Menü.' }),
      list,
      el('button', { class: 'btn primary block', onclick: () => {
        if (!sel.size) { toast('Wähle mindestens ein Fach.'); return; }
        // alle gewählt = null: dann erscheinen später neue Fächer von selbst
        P.subjects = sel.size === SUBJECTS.length ? null : SUBJECTS.filter((s) => sel.has(s.id)).map((s) => s.id);
        saveP();
        go('#/');
      } }, 'Fertig'));
  }

  // =====================================================================
  // Erfolge: Streak, Tagesziel, Sterne, Medaillen
  // =====================================================================
  function viewRewards() {
    const s = streak();
    const goalSel = el('div', { class: 'seg' }, [5, 10, 20].map((g) => el('button', { class: 'seg-btn' + (goal() === g ? ' on' : ''), onclick: () => { P.settings.goal = g; checkGoal(); checkRewards(); route(); } }, g + ' Aufgaben')));
    const earned = MEDALS.filter((m) => P.medals[m.id]).length;
    const grid = el('div', { class: 'medal-grid' }, MEDALS.map((m) => el('div', { class: 'medal-cell' + (P.medals[m.id] ? '' : ' locked') },
      medal({ color: m.color, glyph: m.glyph, size: 52, locked: !P.medals[m.id] }), el('b', { text: m.name }), el('span', { class: 'small muted', text: m.desc }))));
    const sub = curSubject();
    const L = pathOf(sub);
    const lDone = L.filter(levelDone).length;
    const lStars = L.reduce((a, l) => a + ((P.levels[l.id] || {}).stars || 0), 0);
    screen({ title: 'Erfolge', back: '#/' },
      el('section', { class: 'card streak-card' },
        el('div', { class: 'sk-top' }, el('span', { class: 'sk-flame' + (s ? ' on' : '') }, icon('flame')), el('div', null, el('div', { class: 'sk-num', text: String(s) }), el('div', { class: 'muted small', text: (s === 1 ? 'Tag' : 'Tage') + ' in Folge · Rekord ' + (P.best || 0) }))),
        weekStrip(),
        el('div', { class: 'small muted', text: 'Ein Tag zählt, wenn du dein Tagesziel schaffst.' })),
      el('section', { class: 'card stats' },
        el('div', null, el('b', { text: lDone + '/' + L.length }), el('span', { class: 'small muted', text: 'Level' })),
        el('div', null, el('b', { text: lStars + ' ★' }), el('span', { class: 'small muted', text: 'Sterne' })),
        el('div', null, el('b', { text: String(P.stats.answered) }), el('span', { class: 'small muted', text: 'Aufgaben' }))),
      el('section', { class: 'card' }, el('b', { text: 'Tagesziel' }), goalSel),
      el('div', { class: 'row-head' }, el('h2', { text: 'Medaillen' }), el('span', { class: 'muted small', text: earned + ' von ' + MEDALS.length })),
      grid);
  }

  // =====================================================================
  // Probeklausuren
  // =====================================================================
  let examState = null, examTimer = null;
  function stopExamTimer() { if (examTimer) { clearInterval(examTimer); examTimer = null; } }
  function examMax(k) { return k.tasks.reduce((s, t) => s + t.points, 0); }
  const fmtP = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
  function noteFor(pct) { return pct >= 92 ? 1 : pct >= 81 ? 2 : pct >= 67 ? 3 : pct >= 50 ? 4 : pct >= 30 ? 5 : 6; }
  function viewExams(s) {
    if (examState && examState.submitted) examState = null;
    const parts = [el('p', { class: 'muted', text: 'Wie in der Klausur: Tabelle mit Werten, gelbe Zellen – du schreibst die Formeln dazu. Mit Zeit, danach Punkte und Note.' })];
    for (const k of s.exams || []) {
      const st = P.exams[k.id];
      parts.push(el('section', { class: 'card exam-item' },
        el('div', null, el('b', { text: k.title }), el('div', { class: 'small muted', text: k.minutes + ' Min. · ' + examMax(k) + ' Punkte' + (st ? ' · Bestes: ' + fmtP(st.best) + ' P.' : '') })),
        el('a', { class: 'btn primary', style: { background: s.color }, href: '#/klausur/' + k.id }, st ? 'Nochmal' : 'Starten')));
    }
    screen({ title: 'Probeklausur', sub: s.name, back: '#/', color: s.color }, ...parts);
  }
  function viewExamStart(id) {
    const k = examById(id);
    if (!k) return viewPath();
    const s = subjectById(k._subject);
    if (examState && examState.k.id === id && !examState.submitted) return renderExam();
    if (examState && examState.k.id === id && examState.submitted) return renderExamResult();
    screen({ title: k.title, back: '#/' },
      el('section', { class: 'card' }, el('p', { text: k.intro }),
        el('ul', { class: 'small' }, el('li', { text: k.tasks.length + ' Aufgaben, ' + examMax(k) + ' Punkte, ' + k.minutes + ' Minuten' }),
          el('li', { text: 'Gelbe Zellen = hier gehört eine Formel hin. Die Werte zeigen, was herauskommen soll.' }), el('li', { text: 'Tippe auf eine Zelle, um sie in die Formel einzufügen.' }))),
      el('button', { class: 'btn primary block', style: { background: s.color }, onclick: () => { examState = { k, answers: {}, end: Date.now() + k.minutes * 60000, submitted: false, active: null }; renderExam(); } }, 'Klausur starten'));
  }
  function renderExam() {
    const st = examState, k = st.k;
    const timer = el('span', { class: 'timer' }, icon('clock'), el('b', { text: '' }));
    const submit = el('button', { class: 'btn small-btn', onclick: () => { if (confirm('Klausur jetzt abgeben?')) submitExam(); } }, 'Abgeben');
    const main = screen({ title: k.title, right: el('div', { class: 'top-right' }, timer, submit), cls: 'exam' });
    const inputs = {};
    const grid = sheetGrid(k.sheet, { showTarget: 'value', maxHeight: '42vh', onCell: (a) => { if (st.active && inputs[st.active]) inputs[st.active].insertRef(a); } });
    main.appendChild(grid);
    k.tasks.forEach((t, i) => {
      const key = t.cell || ('mc' + i);
      const head = el('div', { class: 'task-head' }, el('span', { class: 'cell-chip', text: t.cell || ('Aufgabe ' + (i + 1)) }), el('span', { class: 'small muted', text: t.points + ' P' }));
      const card = el('section', { class: 'card task' }, head, el('p', { text: t.prompt }));
      if (t.type === 'wahl') {
        if (t.diagram) card.appendChild(diagram(t.diagram, { small: true }));
        const list = el('div', { class: 'options' });
        t.options.forEach((o, j) => {
          const b = el('button', { class: 'option' + (st.answers[key] === j ? ' picked' : '') }, optKey(j), el('span', { class: 'opt-body' }, optionNode(o)));
          b.addEventListener('click', () => { st.answers[key] = j; [...list.children].forEach((c, q) => c.classList.toggle('picked', q === j)); });
          list.appendChild(b);
        });
        card.appendChild(list);
      } else {
        const fi = formulaInput({ fns: FNS.exam, value: st.answers[key] || '' });
        fi.box.classList.add('compact');
        fi.input.addEventListener('focus', () => {
          st.active = key;
          Object.values(inputs).forEach((x) => x.box.classList.add('compact'));
          fi.box.classList.remove('compact');
          grid.querySelectorAll('td.focus').forEach((td) => td.classList.remove('focus'));
          const td = grid.querySelector('td[data-a="' + t.cell + '"]');
          if (td) {
            td.classList.add('focus');
            const wr = grid.getBoundingClientRect(), tr = td.getBoundingClientRect();
            grid.scrollTo({ left: grid.scrollLeft + (tr.left - wr.left) - wr.width / 2 + tr.width / 2, top: grid.scrollTop + (tr.top - wr.top) - wr.height / 2 + tr.height / 2, behavior: 'smooth' });
          }
        });
        fi.input.addEventListener('input', () => { st.answers[key] = fi.value(); });
        inputs[key] = fi;
        card.appendChild(fi.box);
      }
      main.appendChild(card);
    });
    main.appendChild(el('button', { class: 'btn primary block', onclick: () => { if (confirm('Klausur jetzt abgeben?')) submitExam(); } }, 'Abgeben'));
    const tick = () => {
      const left = Math.max(0, st.end - Date.now());
      const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000);
      timer.querySelector('b').textContent = m + ':' + String(sec).padStart(2, '0');
      timer.classList.toggle('low', left < 5 * 60000);
      if (left <= 0) { stopExamTimer(); toast('Die Zeit ist um.'); submitExam(); }
    };
    stopExamTimer();
    tick();
    examTimer = setInterval(tick, 1000);
  }
  function submitExam() {
    const st = examState, k = st.k;
    stopExamTimer();
    let pts = 0;
    st.results = k.tasks.map((t, i) => {
      const key = t.cell || ('mc' + i);
      if (t.type === 'wahl') {
        const j = st.answers[key];
        const ok = j !== undefined && t.options[j] && t.options[j].ok;
        const p = ok ? t.points : 0;
        pts += p;
        if (!ok && j !== undefined && t.options[j].mid) recordMistakes([t.options[j].mid], null);
        return { t, key, p, ok, choice: j };
      }
      const ans = st.answers[key] || '';
      const ex = { id: k.id + '-' + t.cell, sheet: k.sheet, target: t.cell, fill: t.fill, solution: t.solution, pct: t.pct, requireFn: t.requireFn };
      const r = ans.trim() ? Checker.checkFormula(ex, ans, { attempt: 2 }) : { status: 'leer', msgs: ['Nicht beantwortet.'], mids: [] };
      const p = r.status === 'richtig' ? t.points : r.status === 'fast' ? t.points / 2 : 0;
      pts += p;
      recordMistakes(r.mids, null);
      return { t, key, p, r, ans };
    });
    st.points = pts;
    st.max = examMax(k);
    st.submitted = true;
    const pct = Math.round(100 * pts / st.max);
    const rec = P.exams[k.id] || { best: 0, history: [] };
    rec.best = Math.max(rec.best, pts);
    rec.history.push({ date: today(), points: pts, max: st.max });
    P.exams[k.id] = rec;
    P.stats.examsDone++;
    P.stats.bestExamPct = Math.max(P.stats.bestExamPct, pct);
    // zählt als Level im Weg
    const lid = 'exam:' + k.id;
    const lr = P.levels[lid] || { stars: 0, plays: 0 };
    lr.stars = Math.max(lr.stars || 0, pct >= 92 ? 3 : pct >= 67 ? 2 : 1);
    lr.plays = (lr.plays || 0) + 1;
    lr.last = today();
    P.levels[lid] = lr;
    saveP();
    renderExamResult();
    checkRewards();
  }
  function renderExamResult() {
    const st = examState, k = st.k;
    const s = subjectById(k._subject);
    const pct = Math.round(100 * st.points / st.max);
    const parts = [el('section', { class: 'card result-card' },
      el('div', { class: 'eyebrow', text: 'Ergebnis' }), el('div', { class: 'big', text: fmtP(st.points) + ' von ' + st.max + ' Punkten' }),
      el('div', { class: 'muted', text: pct + ' % · ungefähre Note ' + noteFor(pct) }), el('p', { class: 'small muted', text: 'Der Notenschlüssel deiner Lehrkraft kann etwas anders sein.' }))];
    const weakTopics = new Set();
    st.results.forEach((res, i) => {
      const t = res.t;
      const full = res.p === t.points;
      if (!full && t.topic) weakTopics.add(t.topic);
      const card = el('section', { class: 'card task-res ' + (full ? 'ok' : res.p > 0 ? 'warn' : 'bad') },
        el('div', { class: 'task-head' }, el('span', { class: 'cell-chip', text: t.cell || ('Aufgabe ' + (i + 1)) }), el('b', { text: fmtP(res.p) + ' / ' + t.points + ' P' })),
        el('p', { class: 'small', text: t.prompt }));
      if (t.type === 'wahl') {
        if (res.choice !== undefined) card.appendChild(el('div', { class: 'small' }, 'Deine Wahl: ', optionNode(t.options[res.choice])));
        const c = t.options.find((o) => o.ok);
        if (!res.ok) { card.appendChild(el('div', { class: 'small' }, 'Richtig: ', optionNode(c))); if (res.choice !== undefined && t.options[res.choice].why) card.appendChild(el('p', { class: 'small', text: t.options[res.choice].why })); }
      } else {
        card.appendChild(el('div', { class: 'small' }, 'Deine Formel: ', res.ans ? formulaBox(res.ans) : el('i', { text: 'leer' })));
        if (!full) {
          (res.r.msgs || []).forEach((m) => card.appendChild(el('p', { class: 'small', text: m })));
          card.appendChild(el('div', { class: 'small' }, 'Musterlösung: ', formulaBox(t.solution)));
        }
      }
      parts.push(card);
    });
    if (weakTopics.size) {
      parts.push(el('button', { class: 'btn primary block', style: { background: s.color }, onclick: () => {
        const items = [...weakTopics].map(topicById).filter(Boolean).flatMap((t) => t.exercises).filter((e) => e.type === 'formel');
        examState = null;
        startSession(interleave(shuffle(items)).slice(0, 10), 'Schwächen üben', '#/');
      } }, 'Schwache Themen üben'));
    }
    parts.push(el('button', { class: 'btn ghost block', onclick: () => { examState = null; go('#/'); } }, 'Fertig'));
    screen({ title: k.title }, ...parts);
  }

  // =====================================================================
  // Einstellungen
  // =====================================================================
  function viewSettings() {
    screen({ title: 'Einstellungen', back: '#/' },
      el('a', { class: 'link-row card', href: '#/faecher' }, icon('grid'), el('span', { text: 'Fächer wählen' }), icon('chev', 'chev')),
      el('section', { class: 'card' }, el('b', { text: 'App aufs Handy legen' }),
        el('p', { class: 'small', text: 'iPhone: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.' }),
        el('p', { class: 'small', text: 'Android: Seite in Chrome öffnen → ⋮ → „App installieren“.' })),
      el('section', { class: 'card' }, el('b', { text: 'Fortschritt' }), el('p', { class: 'small muted', text: 'Dein Fortschritt, deine Sterne, Medaillen und dein Streak werden nur auf diesem Gerät gespeichert.' }),
        el('button', { class: 'btn ghost block', onclick: () => { if (confirm('Wirklich den ganzen Fortschritt löschen (auch Level, Medaillen und Streak)?')) { P = defaults(); saveP(); toast('Fortschritt gelöscht'); go('#/'); } } }, 'Fortschritt löschen')),
      el('section', { class: 'card' }, el('b', { text: 'Abmelden' }), el('p', { class: 'small muted', text: 'Beim nächsten Öffnen wird wieder nach dem Kennwort gefragt.' }),
        el('button', { class: 'btn ghost block', onclick: () => { LCrypto.forgetKey(); location.hash = ''; location.reload(); } }, 'Abmelden')),
      el('p', { class: 'small muted center', text: 'Lernapp · Stand ' + (META.built || '') }));
  }

  // =====================================================================
  // Anmeldung
  // =====================================================================
  function viewLogin(errText) {
    app.innerHTML = '';
    app.className = 'login';
    const pw = el('input', { type: 'password', class: 'v-input', placeholder: 'Kennwort', autocomplete: 'current-password', 'aria-label': 'Kennwort' });
    const err = el('p', { class: 'err', text: errText || '' });
    const btn = el('button', { class: 'btn primary block', type: 'submit' }, 'Öffnen');
    const form = el('form', { class: 'login-box' },
      el('img', { src: 'icons/icon-192.png', alt: '', class: 'login-icon', width: 72, height: 72 }),
      el('h1', { text: 'Lernapp' }), el('p', { class: 'muted', text: 'Lernen für die nächste Klausur' }), pw, err, btn,
      el('p', { class: 'small muted', text: 'Das Kennwort bekommst du in der Klasse.' }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!pw.value) { err.textContent = 'Bitte das Kennwort eingeben.'; return; }
      btn.disabled = true;
      btn.textContent = 'Öffne …';
      err.textContent = '';
      try {
        const r = await LCrypto.unlock(pw.value.trim(), META);
        KEY = r.key;
        COURSE = r.course;
        start();
      } catch (ex) {
        btn.disabled = false;
        btn.textContent = 'Öffnen';
        err.textContent = String(ex.message) === 'wrong' ? 'Das Kennwort stimmt nicht.' : 'Keine Verbindung. Versuch es gleich nochmal.';
      }
    });
    app.appendChild(form);
    pw.focus();
  }
  function start() {
    indexCourse();
    // Medaillen, die durch frühere Fortschritte schon verdient sind, still nachtragen
    for (const m of MEDALS) if (!P.medals[m.id] && m.test()) P.medals[m.id] = today();
    saveP();
    // für die automatischen Tests: Level-Weg und erzeugte Auswahl-Aufgaben prüfen
    window.LernappDebug = {
      report() {
        return SUBJECTS.map((s) => ({ subject: s.id, levels: pathOf(s).map((l) => ({ id: l.id, kind: l.kind, n: l.kind === 'exam' || l.kind === 'essay' ? 1 : levelItems(l).length })),
          choices: s.topics.flatMap((t) => t.exercises.filter((e) => e.type === 'formel' || e.type === 'luecke').map((e) => (e.type === 'formel'
            ? { id: e.id, d3: distractors(e, 2).map((x) => x.f), d4: distractors(e, 3).length } : { id: e.id, d3: (e.wrong || []).slice(0, 2).map((x) => x.t), d4: (e.wrong || []).slice(0, 3).length }))) }));
      },
      // alle Aufgaben-IDs eines Fachs, auch die erzeugten Auswahl-Varianten
      ids(sid) {
        const s = subjectById(sid);
        return s.topics.flatMap((t) => t.exercises.flatMap((e) => [e.id].concat((e.type === 'formel' || e.type === 'luecke') ? [3, 4].map((n) => asChoice(e, n)).filter(Boolean).map((x) => x.id) : [])));
      },
      play(ids) { startSession(ids.map(exById).filter(Boolean), 'Test', '#/', null); },
      subject(sid) { P.cur = sid; saveP(); },
      confetti() { confetti(app.querySelector('.level-result') || app.querySelector('main')); },
    };
    route();
  }
  async function boot() {
    try {
      const r = await fetch('data/meta.json', { cache: 'no-cache' });
      META = await r.json();
    } catch (e) {
      app.innerHTML = '<p class="boot-err">Die App konnte nicht geladen werden. Bitte Internetverbindung prüfen und neu laden.</p>';
      return;
    }
    try {
      const r = await LCrypto.unlockWithStoredKey(META);
      if (r) { KEY = r.key; COURSE = r.course; start(); return; }
    } catch (e) {
      app.innerHTML = '<p class="boot-err">Die Inhalte konnten nicht geladen werden. Bitte Internetverbindung prüfen und neu laden.</p>';
      return;
    }
    viewLogin();
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      updateReady = true;
      if (COURSE && !location.hash.replace(/^#\/?/, '') && !document.querySelector('.menu-ov')) route();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && flushEssay) flushEssay(); });
  boot();
})();
