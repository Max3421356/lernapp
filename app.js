/* Lernapp – Hauptprogramm: Anmeldung, Fächer, Themen, Üben (Lernkartei), Probeklausuren, häufige Fehler,
   Belohnungen (Tagesziel, Streak, Medaillen). Der Fortschritt bleibt auf dem jeweiligen Gerät. */
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
  const exById = (id) => EXS.get(id);
  const mistakeById = (id) => MISTAKES.get(id);
  const examById = (id) => { for (const s of SUBJECTS) for (const k of s.exams || []) if (k.id === id) return k; return null; };
  function mySubjects() {
    const sel = P.subjects;
    const list = SUBJECTS.filter((s) => !sel || sel.includes(s.id));
    return list.length ? list : SUBJECTS;
  }
  const myTopics = () => mySubjects().flatMap((s) => s.topics);
  const myExercises = () => myTopics().flatMap((t) => t.exercises);

  // =====================================================================
  // Fortschritt (Lernkartei mit 5 Fächern) – nur auf diesem Gerät
  // =====================================================================
  const PKEY = 'lernapp.progress.v1';
  const INTERVAL = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 16 };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const today = () => iso(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const STATS0 = () => ({ answered: 0, correct: 0, fixed: 0, combo: 0, bestCombo: 0, examsDone: 0, bestExamPct: 0 });
  const defaults = () => ({ items: {}, mistakes: {}, seen: {}, exams: {}, settings: { goal: 10, examDates: {} }, tips: {}, subjects: null,
    daily: {}, goalDays: {}, stats: STATS0(), medals: {}, tiers: {}, best: 0, last: null });
  let P = loadP();
  function loadP() {
    try {
      const raw = JSON.parse(localStorage.getItem(PKEY) || '{}');
      const p = Object.assign(defaults(), raw);
      p.settings = Object.assign({ goal: 10, examDates: {} }, raw.settings || {});
      p.stats = Object.assign(STATS0(), raw.stats || {});
      return p;
    } catch (e) { return defaults(); }
  }
  function saveP() { try { localStorage.setItem(PKEY, JSON.stringify(P)); } catch (e) { /* voll oder privat */ } }

  function mastery(topic) {
    const ex = topic.exercises;
    if (!ex.length) return 0;
    let s = 0;
    for (const e of ex) { const it = P.items[e.id]; if (it && it.box) s += Math.min(1, (it.box - 1) / 3); }
    return Math.round(100 * s / ex.length);
  }
  const subjectMastery = (s) => (s.topics.length ? Math.round(s.topics.reduce((a, t) => a + mastery(t), 0) / s.topics.length) : 0);
  function dueList() {
    const t = today();
    return myExercises().filter((e) => P.items[e.id] && P.items[e.id].due <= t)
      .sort((a, b) => (P.items[a.id].due < P.items[b.id].due ? -1 : 1) || P.items[a.id].box - P.items[b.id].box);
  }
  function interleave(list) {
    const by = new Map();
    for (const e of list) { if (!by.has(e._topic)) by.set(e._topic, []); by.get(e._topic).push(e); }
    const out = [];
    let added = true;
    while (added) { added = false; for (const [, arr] of by) if (arr.length) { out.push(arr.shift()); added = true; } }
    return out;
  }
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const a = new Date(today() + 'T12:00:00'), b = new Date(dateStr + 'T12:00:00');
    return Math.round((b - a) / 86400000);
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
  const TIER_NAME = { bronze: 'Bronze', silver: 'Silber', gold: 'Gold' };
  const TIER_RANK = { bronze: 1, silver: 2, gold: 3 };
  const tierOf = (m) => (m >= 100 ? 'gold' : m >= 65 ? 'silver' : m >= 30 ? 'bronze' : null);
  function nextTierInfo(m) {
    if (m >= 100) return null;
    const [need, name] = m < 30 ? [30, 'Bronze'] : m < 65 ? [65, 'Silber'] : [100, 'Gold'];
    return { need, name, left: need - m };
  }
  // „gleich richtig“ = beim ersten Versuch richtig
  const MEDALS = [
    { id: 'start', name: 'Los geht’s', desc: 'Erste Aufgabe gelöst', color: 'green', glyph: 'check', test: () => P.stats.answered >= 1 },
    { id: 'goal', name: 'Tagesziel', desc: 'Tagesziel geschafft', color: 'green', glyph: 'target', test: () => Object.keys(P.goalDays).length >= 1 },
    { id: 'r10', name: '10 richtig', desc: '10 Aufgaben gleich richtig', color: 'blue', glyph: '10', test: () => P.stats.correct >= 10 },
    { id: 'r50', name: '50 richtig', desc: '50 Aufgaben gleich richtig', color: 'blue', glyph: '50', test: () => P.stats.correct >= 50 },
    { id: 'r150', name: '150 richtig', desc: '150 Aufgaben gleich richtig', color: 'purple', glyph: '150', test: () => P.stats.correct >= 150 },
    { id: 's3', name: '3 Tage', desc: '3 Tage in Folge', color: 'orange', glyph: '3', streak: true, test: () => P.best >= 3 },
    { id: 's7', name: '7 Tage', desc: '7 Tage in Folge', color: 'orange', glyph: '7', streak: true, test: () => P.best >= 7 },
    { id: 's14', name: '14 Tage', desc: '14 Tage in Folge', color: 'red', glyph: '14', streak: true, test: () => P.best >= 14 },
    { id: 'combo', name: 'Zehn am Stück', desc: '10 hintereinander gleich richtig', color: 'purple', glyph: 'star', test: () => P.stats.bestCombo >= 10 },
    { id: 'fix', name: 'Fehlerjäger', desc: '10 alte Fehler verbessert', color: 'red', glyph: 'repeat', test: () => P.stats.fixed >= 10 },
    { id: 'video', name: 'Kino', desc: 'Alle Videos eines Fachs', color: 'blue', glyph: 'play',
      test: () => SUBJECTS.some((s) => { const v = s.topics.filter((t) => hasVideo(t)); return v.length > 0 && v.every((t) => (P.seen[t.id] || {}).video); }) },
    { id: 'fit', name: 'Klausurfit', desc: 'Klausurthemen auf Silber', color: 'gold', glyph: 'trophy',
      test: () => SUBJECTS.some((s) => { const f = s.topics.filter((t) => t.focus); return f.length > 0 && f.every((t) => TIER_RANK[P.tiers[t.id]] >= 2); }) },
    { id: 'exam', name: 'Probeklausur', desc: 'Erste Probeklausur', color: 'green', glyph: 'exam', test: () => P.stats.examsDone >= 1 },
    { id: 'exam2', name: 'Note 2', desc: 'Probeklausur ab 81 %', color: 'silver', glyph: '2', test: () => P.stats.bestExamPct >= 81 },
    { id: 'exam1', name: 'Volltreffer', desc: 'Probeklausur mit 100 %', color: 'gold', glyph: '1', test: () => P.stats.bestExamPct >= 100 },
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
  function checkRewards(topicId) {
    const pops = [];
    const t = topicId ? topicById(topicId) : null;
    if (t) {
      const tier = tierOf(mastery(t));
      if (tier && (TIER_RANK[tier] || 0) > (TIER_RANK[P.tiers[t.id]] || 0)) {
        P.tiers[t.id] = tier;
        pops.push([medal({ color: tier, glyph: 'star', size: 46 }), TIER_NAME[tier] + ' in „' + t.title + '“', tier === 'gold' ? 'Thema ganz gemeistert.' : 'Weiter üben für ' + (tier === 'bronze' ? 'Silber' : 'Gold') + '.', 'Themen-Medaille']);
      }
    }
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
    const ex = exById(id);
    checkRewards(ex ? ex._topic : null);
  }
  function recordMistakes(mids, exId) {
    if (!mids || !mids.length) return;
    for (const m of mids) {
      if (!mistakeById(m)) continue;
      const r = P.mistakes[m] || { n: 0, items: [] };
      r.n++;
      r.last = today();
      if (exId && !r.items.includes(exId)) r.items.push(exId);
      P.mistakes[m] = r;
    }
    saveP();
  }
  const hasVideo = (t) => !!(t.video && META.videos && META.videos[t.video]);
  function markSeen(tid, key) { P.seen[tid] = Object.assign({}, P.seen[tid], { [key]: true }); saveP(); if (key === 'video') checkRewards(null); }

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
  function goalRing(size) {
    const c = countOn(today()), g = goal();
    const pct = Math.min(100, Math.round(100 * c / g));
    const r = (size - 10) / 2, circ = 2 * Math.PI * r;
    const w = el('span', { class: 'goal-ring', style: { width: size + 'px', height: size + 'px' } });
    w.innerHTML = `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="gr-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="gr-fg" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
    w.appendChild(el('span', { class: 'gr-text' }, el('b', { text: Math.min(c, g) + '/' + g, style: { fontSize: Math.round(size * 0.22) + 'px' } }), el('small', { text: 'heute' })));
    return w;
  }

  // =====================================================================
  // Rahmen und Navigation
  // =====================================================================
  function screen(opts, ...content) {
    app.innerHTML = '';
    app.className = (opts.cls || '') + (opts.nav === false ? ' no-nav' : '');
    const top = el('header', { class: 'top' + (opts.color ? ' colored' : ''), style: opts.color ? { background: opts.color } : null });
    if (opts.back) top.appendChild(el('button', { class: 'icon-btn', 'aria-label': 'Zurück', onclick: () => go(opts.back) }, icon('back')));
    top.appendChild(el('div', { class: 'top-title' }, el('h1', { text: opts.title || 'Lernapp' }), opts.sub ? el('div', { class: 'top-sub', text: opts.sub }) : null));
    if (opts.right) top.appendChild(opts.right);
    const main = el('main', { class: 'content' });
    put(main, ...content);
    if (opts.title !== null) app.appendChild(top);
    app.appendChild(main);
    if (opts.nav !== false) app.appendChild(bottomNav(opts.nav));
    window.scrollTo(0, 0);
    return main;
  }
  function bottomNav(active) {
    const item = (hash, ic, label, key) => el('a', { href: hash, class: 'nav-item' + (active === key ? ' active' : '') }, icon(ic), el('span', { text: label }));
    const due = dueList().length;
    const rep = item('#/wiederholen', 'repeat', 'Wiederholen', 'rep');
    if (due) rep.appendChild(el('i', { class: 'badge', text: String(due) }));
    return el('nav', { class: 'bottom' }, item('#/', 'home', 'Start', 'home'), rep, item('#/erfolge', 'trophy', 'Erfolge', 'win'));
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  window.addEventListener('hashchange', () => route());

  function route() {
    if (!COURSE) return;
    if (examState && !examState.submitted && !location.hash.startsWith('#/klausur/')) {
      if (!confirm('Die Probeklausur läuft noch. Wirklich verlassen? Deine Antworten gehen verloren.')) { history.back(); return; }
      stopExamTimer();
      examState = null;
    }
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!parts.length) return viewHome();
    const [a, b, c] = parts;
    if (a === 'f' && b) {
      const s = subjectById(b);
      if (!s) return viewHome();
      if (c === 'klausur') return viewExams(s);
      if (c === 'fehler') return viewMistakes(s);
      return viewSubject(s);
    }
    if (a === 't' && b) {
      const t = topicById(b);
      if (!t) return viewHome();
      if (c === 'lernen') return viewCards(t);
      if (c === 'beispiel') return viewExample(t);
      if (c === 'ueben') return startTopicPractice(t);
      if (c === 'fehler') return viewTopicMistakes(t);
      return viewTopic(t);
    }
    if (a === 'wiederholen') return viewReview();
    if (a === 'erfolge') return viewRewards();
    if (a === 'faecher') return viewPicker();
    if (a === 'klausur' && b) return viewExamStart(b);
    if (a === 'einstellungen') return viewSettings();
    if (a === 'session') return session ? renderSession() : viewHome();
    return viewHome();
  }

  // =====================================================================
  // Start
  // =====================================================================
  function nextStep() {
    const due = dueList();
    if (due.length >= 3) return { title: 'Wiederholen', sub: due.length + ' Aufgaben sind fällig', color: '#2F7DE1', run: () => startSession(interleave(due).slice(0, 12), 'Wiederholen', '#/') };
    const open = (t) => {
      const s = subjectById(t._subject);
      const seen = P.seen[t.id] || {};
      if (hasVideo(t) && !seen.video) return { title: t.title, sub: s.name + ' · Video ansehen', color: colorOf(t), run: () => { P.last = t.id; saveP(); playVideo(t); } };
      if (!seen.cards) return { title: t.title, sub: s.name + ' · Erklärung lesen', color: colorOf(t), run: () => go('#/t/' + t.id + '/lernen') };
      return { title: t.title, sub: s.name + ' · Üben', color: colorOf(t), run: () => go('#/t/' + t.id + '/ueben') };
    };
    const last = P.last && topicById(P.last);
    if (last && mySubjects().some((s) => s.id === last._subject) && mastery(last) < 100) return open(last);
    const topics = myTopics().filter((t) => mastery(t) < 100);
    const focus = topics.filter((t) => t.focus).sort((x, y) => mastery(x) - mastery(y));
    if (focus.length) return open(focus[0]);
    if (topics.length) return open(topics[0]);
    if (due.length) return { title: 'Wiederholen', sub: due.length + ' Aufgaben sind fällig', color: '#2F7DE1', run: () => startSession(interleave(due).slice(0, 12), 'Wiederholen', '#/') };
    const s = mySubjects()[0];
    return { title: 'Probeklausur', sub: 'Alles geübt – teste dich wie in der Klausur', color: '#1B2430', run: () => go('#/f/' + s.id + '/klausur') };
  }
  function viewHome() {
    const h = new Date().getHours();
    const greet = h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend';
    const dateTxt = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    const s = streak();
    const head = el('div', { class: 'home-head' },
      el('div', null, el('h1', { class: 'hello', text: greet }), el('div', { class: 'muted small', text: dateTxt })),
      el('button', { class: 'icon-btn', 'aria-label': 'Einstellungen', onclick: () => go('#/einstellungen') }, icon('gear')));
    const daily = el('a', { class: 'card daily', href: '#/erfolge' },
      goalRing(76),
      el('div', { class: 'daily-text' },
        el('div', { class: 'streak-line' }, icon('flame', 'flame' + (s ? ' on' : '')), el('b', { text: String(s) }), el('span', { text: s === 1 ? 'Tag in Folge' : 'Tage in Folge' })),
        weekStrip()));
    const n = nextStep();
    const cont = el('section', { class: 'card next', style: { '--c': n.color } },
      el('div', { class: 'eyebrow', text: 'Weiter lernen' }),
      el('div', { class: 'next-title', text: n.title }),
      el('div', { class: 'muted small', text: n.sub }),
      el('button', { class: 'btn primary block', style: { background: n.color }, onclick: n.run }, 'Los geht’s'));
    const subjects = el('section', { class: 'subjects' },
      el('div', { class: 'row-head' }, el('h2', { text: 'Deine Fächer' }), el('a', { class: 'link-sm', href: '#/faecher', text: 'Fächer wählen' })));
    for (const sub of mySubjects()) {
      const m = subjectMastery(sub);
      const tiers = { gold: 0, silver: 0, bronze: 0 };
      sub.topics.forEach((t) => { const x = P.tiers[t.id]; if (x) tiers[x]++; });
      const kd = daysUntil((P.settings.examDates || {})[sub.id]);
      const pill = kd === null || kd < 0 ? null : el('span', { class: 'sc-pill', text: kd === 0 ? 'Klausur heute' : kd === 1 ? 'Klausur morgen' : 'Klausur in ' + kd + ' Tagen' });
      subjects.appendChild(el('a', { class: 'subject-card', href: '#/f/' + sub.id, style: { background: sub.color } },
        el('div', { class: 'sc-top' }, el('div', null, el('b', { class: 'sc-name', text: sub.name }), el('div', { class: 'sc-sub', text: sub.sub }), pill), icon('chev')),
        el('div', { class: 'sc-bar' }, el('i', { style: { width: m + '%' } })),
        el('div', { class: 'sc-foot' }, el('span', { text: m + ' % geschafft' }),
          el('span', { class: 'sc-medals' }, ['gold', 'silver', 'bronze'].map((k) => el('span', { class: 'sc-m' }, medal({ color: k, size: 16 }), String(tiers[k])))))));
    }
    const tip = (!P.tips.install && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches)
      ? el('div', { class: 'tip-line' }, el('a', { href: '#/einstellungen', text: 'Tipp: Lernapp als App aufs Handy legen' }),
        el('button', { class: 'icon-btn small', 'aria-label': 'Tipp ausblenden', onclick: (e) => { P.tips.install = true; saveP(); e.currentTarget.parentNode.remove(); } }, icon('close')))
      : null;
    screen({ title: null, nav: 'home', cls: 'home' }, head, daily, cont, subjects, tip);
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
    screen({ title: 'Fächer wählen', back: '#/', nav: false },
      el('p', { class: 'muted', text: 'Wähle die Fächer, die auf deinem Startbildschirm stehen sollen. Neue Fächer kommen nach und nach dazu.' }),
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
  // Fach
  // =====================================================================
  function viewSubject(s) {
    const date = (P.settings.examDates || {})[s.id];
    const kd = daysUntil(date);
    const dateInput = el('input', { type: 'date', class: 'date-hidden', value: date || '', 'aria-label': 'Klausurdatum' });
    dateInput.addEventListener('change', () => { P.settings.examDates = Object.assign({}, P.settings.examDates, { [s.id]: dateInput.value || null }); saveP(); route(); });
    const examLine = el('button', { class: 'exam-line', type: 'button', style: { '--c': s.color } }, icon('clock'),
      el('span', { class: 'el-text', text: kd === null || kd < 0 ? 'Klausurdatum eintragen' : kd > 1 ? 'Klausur in ' + kd + ' Tagen' : kd === 1 ? 'Klausur ist morgen' : 'Klausur ist heute' }),
      el('span', { class: 'small muted', text: kd === null || kd < 0 ? '' : 'ändern' }),
      dateInput);
    examLine.addEventListener('click', () => {
      try { if (dateInput.showPicker) { dateInput.showPicker(); return; } } catch (e) { /* ältere Browser */ }
      dateInput.focus();
      dateInput.click();
    });
    const list = el('section', { class: 'topic-list' });
    for (const t of s.topics) {
      const m = mastery(t);
      const tier = P.tiers[t.id] || tierOf(m);
      list.appendChild(el('a', { class: 'topic-row', href: '#/t/' + t.id },
        medal({ color: tier || 'gold', locked: !tier, glyph: 'star', size: 34 }),
        el('span', { class: 'tr-text' }, el('b', { text: t.title }),
          el('span', { class: 'tr-sub' }, t.focus ? el('span', { class: 'chip', style: { '--c': s.color }, text: 'Klausur' }) : null, el('span', { class: 'small muted', text: m + ' %' }))),
        icon('chev', 'chev')));
    }
    screen({ title: s.name, sub: s.sub, back: '#/', color: s.color, nav: 'home' },
      examLine,
      el('div', { class: 'two-btns', style: { '--c': s.color } },
        el('a', { class: 'big-btn', href: '#/f/' + s.id + '/klausur' }, icon('exam'), el('b', { text: 'Probeklausur' })),
        el('a', { class: 'big-btn', href: '#/f/' + s.id + '/fehler' }, icon('alert'), el('b', { text: 'Häufige Fehler' }))),
      el('h2', { text: 'Themen' }), list);
  }

  // =====================================================================
  // Thema
  // =====================================================================
  function viewTopic(t) {
    if (P.last !== t.id) { P.last = t.id; saveP(); }
    const s = subjectById(t._subject);
    const seen = P.seen[t.id] || {};
    const m = mastery(t);
    const tier = P.tiers[t.id] || tierOf(m);
    const nt = nextTierInfo(m);
    const status = el('section', { class: 'card topic-status' },
      medal({ color: tier || 'gold', locked: !tier, glyph: 'star', size: 58 }),
      el('div', { class: 'ts-text' },
        el('b', { text: tier ? TIER_NAME[tier] + '-Medaille' : 'Noch keine Medaille' }),
        el('div', { class: 'ts-bar' }, el('i', { style: { width: m + '%', background: colorOf(t) } })),
        el('div', { class: 'small muted', text: nt ? 'Noch ' + nt.left + ' % bis ' + nt.name : 'Thema ganz gemeistert' })));
    const btn = (ic, label, sub, onclick, primary, done) => el('button', { class: 'action' + (primary ? ' primary' : ''), style: primary ? { background: colorOf(t) } : { '--c': colorOf(t) }, onclick },
      el('span', { class: 'act-ic' }, icon(ic)), el('span', { class: 'act-text' }, el('b', { text: label }), el('span', { class: 'small', text: sub })),
      done ? el('span', { class: 'act-done' }, icon('check')) : icon('chev', 'chev'));
    const actions = el('section', { class: 'actions' },
      hasVideo(t) ? btn('play', 'Video ansehen', 'Bo und Nick erklären', () => playVideo(t), false, seen.video) : null,
      btn('book', 'Erklärung', t.cards.length + ' Merkkarten + Beispiel', () => go('#/t/' + t.id + '/lernen'), false, seen.cards && seen.example),
      btn('pencil', 'Üben', t.exercises.length + ' Aufgaben', () => go('#/t/' + t.id + '/ueben'), true, false));
    screen({ title: t.title, sub: s.name, back: '#/f/' + s.id, color: colorOf(t), nav: 'home' },
      status, actions,
      el('a', { class: 'link-row', href: '#/t/' + t.id + '/fehler' }, icon('alert'), el('span', { text: 'Häufige Fehler (' + t.mistakes.length + ')' }), icon('chev', 'chev')));
  }

  // ---------- Video ----------
  async function playVideo(t) {
    const info = META.videos[t.video];
    const overlay = el('div', { class: 'overlay video-ov' });
    const status = el('div', { class: 'video-status', text: 'Video wird geladen …' });
    const close = el('button', { class: 'icon-btn ov-close', 'aria-label': 'Schließen', onclick: () => overlay.remove() }, icon('close'));
    overlay.appendChild(close);
    overlay.appendChild(status);
    document.body.appendChild(overlay);
    try {
      const url = await LCrypto.videoUrl(KEY, info.file);
      const v = el('video', { class: 'video', src: url, controls: true, playsinline: true, autoplay: true, preload: 'auto' });
      v.addEventListener('timeupdate', () => { if (v.duration && v.currentTime / v.duration > 0.8 && !(P.seen[t.id] || {}).video) markSeen(t.id, 'video'); });
      v.addEventListener('ended', () => { if (!(P.seen[t.id] || {}).video) markSeen(t.id, 'video'); });
      status.replaceWith(v);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); route(); } });
      close.onclick = () => { overlay.remove(); route(); };
    } catch (e) {
      status.textContent = 'Das Video konnte nicht geladen werden. Prüfe die Internetverbindung.';
    }
  }

  // ---------- Erklärung: Merkkarten, dann Beispiel ----------
  function viewCards(t) {
    let i = 0;
    const main = screen({ title: 'Erklärung', sub: t.title, back: '#/t/' + t.id, color: colorOf(t), nav: false });
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
          : el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { markSeen(t.id, 'cards'); go('#/t/' + t.id + '/beispiel'); } }, 'Zum Beispiel'));
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
    let i = 0;
    const main = screen({ title: 'Beispiel', sub: ex.title, back: '#/t/' + t.id, color: colorOf(t), nav: false });
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
          : el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { markSeen(t.id, 'example'); go('#/t/' + t.id + '/ueben'); } }, 'Jetzt üben'));
      put(main, card, bar, grid, nav);
    }
    draw();
  }

  // ---------- Häufige Fehler ----------
  function mistakeCard(m, count, open) {
    const body = el('div', { class: 'm-body' },
      el('div', { class: 'm-line bad' }, el('span', { class: 'm-tag', text: 'Falsch' }), el('code', { text: m.falsch })),
      el('div', { class: 'm-line good' }, el('span', { class: 'm-tag', text: 'Richtig' }), el('code', { text: m.richtig })),
      el('p', null, el('b', { text: 'Warum: ' }), m.warum),
      el('p', { class: 'tipp' }, el('b', { text: 'Tipp: ' }), m.tipp));
    const det = el('details', { class: 'card mistake' + (count ? ' mine' : '') }, el('summary', null, el('span', { text: m.title }), count ? el('i', { class: 'count', text: count + '×' }) : null), body);
    if (open) det.open = true;
    return det;
  }
  function viewTopicMistakes(t) {
    const list = t.mistakes.map((id) => mistakeById(id)).filter(Boolean).map((m) => mistakeCard(m, P.mistakes[m.id] && P.mistakes[m.id].n));
    screen({ title: 'Häufige Fehler', sub: t.title, back: '#/t/' + t.id, color: colorOf(t), nav: false },
      el('p', { class: 'muted', text: 'Tippe auf einen Fehler, um Beispiel und Tipp zu sehen.' }), ...list,
      el('button', { class: 'btn primary block', style: { background: colorOf(t) }, onclick: () => go('#/t/' + t.id + '/ueben') }, 'Üben'));
  }
  function viewMistakes(s) {
    const ids = new Set((s.mistakes || []).map((m) => m.id));
    const mine = Object.entries(P.mistakes).filter(([id]) => ids.has(id)).sort((a, b) => b[1].n - a[1].n);
    const parts = [];
    if (mine.length) {
      parts.push(el('h2', { text: 'Deine Fehler' }));
      mine.slice(0, 6).forEach(([id, r]) => parts.push(mistakeCard(mistakeById(id), r.n)));
      const items = [...new Set(mine.flatMap(([, r]) => r.items))].map(exById).filter(Boolean);
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
    screen({ title: 'Häufige Fehler', sub: s.name, back: '#/f/' + s.id, color: s.color, nav: false }, ...parts);
  }

  // =====================================================================
  // Üben: Runde mit mehreren Aufgaben
  // =====================================================================
  let session = null;
  function startTopicPractice(t) {
    if (P.last !== t.id) { P.last = t.id; saveP(); }
    const order = t.exercises.slice().sort((a, b) => ((P.items[a.id] || {}).box || 0) - ((P.items[b.id] || {}).box || 0));
    const open = order.filter((e) => !P.items[e.id] || P.items[e.id].box < 5);
    startSession(open.length ? open : shuffle(order), t.title, '#/t/' + t.id, t);
  }
  function startSession(items, title, back, topic) {
    if (!items.length) { toast('Keine Aufgaben gefunden.'); return; }
    session = { items: items.slice(), idx: 0, title, back, topic, results: [], requeued: new Set(), mids: [] };
    // #/t/<id>/ueben startet sofort eine Runde: ersetzen, damit „Zurück“ nicht wieder hineinführt
    if (/\/ueben$/.test(location.hash)) { history.replaceState(null, '', '#/session'); renderSession(); }
    else if (location.hash !== '#/session') location.hash = '#/session';
    else renderSession();
  }
  function renderSession() {
    const s = session;
    if (s.idx >= s.items.length) return renderSessionEnd();
    const ex = s.items[s.idx];
    const t = topicById(ex._topic) || s.topic;
    const prog = el('div', { class: 'progress' }, el('i', { style: { width: Math.round(100 * s.idx / s.items.length) + '%', background: t ? colorOf(t) : '#2F7DE1' } }));
    const main = screen({ title: s.title, sub: (s.idx + 1) + ' / ' + s.items.length, back: s.back, color: t ? colorOf(t) : null, nav: false, cls: 'session' });
    main.appendChild(prog);
    const done = (outcome, mids) => {
      grade(ex.id, outcome);
      s.results.push({ id: ex.id, outcome });
      (mids || []).forEach((m) => s.mids.push(m));
      if (['wrong', 'shown', 'unknown'].includes(outcome) && !s.requeued.has(ex.id)) { s.items.push(ex); s.requeued.add(ex.id); }
      s.idx++;
      renderSession();
    };
    main.appendChild(viewExercise(ex, done, t));
  }
  function renderSessionEnd() {
    const s = session;
    const firstTry = new Map();
    for (const r of s.results) if (!firstTry.has(r.id)) firstTry.set(r.id, r.outcome);
    const n = firstTry.size;
    const ok = [...firstTry.values()].filter((o) => o === 'first' || o === 'known').length;
    const mids = [...new Set(s.mids)].map(mistakeById).filter(Boolean);
    const st = streak();
    const parts = [
      el('section', { class: 'card done-card' },
        el('div', { class: 'eyebrow', text: 'Runde fertig' }),
        el('div', { class: 'big', text: ok + ' von ' + n + ' richtig' }),
        el('div', { class: 'muted small', text: 'beim ersten Versuch' })),
      el('section', { class: 'card done-goal' }, goalRing(64),
        el('div', null, el('div', { class: 'streak-line' }, icon('flame', 'flame' + (st ? ' on' : '')), el('b', { text: String(st) }), el('span', { text: st === 1 ? 'Tag in Folge' : 'Tage in Folge' })),
          el('div', { class: 'small muted', text: countOn(today()) >= goal() ? 'Tagesziel für heute geschafft.' : 'Noch ' + (goal() - countOn(today())) + ' Aufgaben bis zum Tagesziel.' })))];
    if (mids.length) {
      parts.push(el('h2', { text: 'Fehler in dieser Runde' }));
      mids.forEach((m) => parts.push(mistakeCard(m, P.mistakes[m.id] && P.mistakes[m.id].n)));
    }
    parts.push(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: () => go(s.back) }, 'Fertig'),
      el('button', { class: 'btn primary', onclick: () => { const items = [...new Set(s.results.map((r) => r.id))].map(exById); startSession(shuffle(items), s.title, s.back, s.topic); } }, 'Nochmal')));
    screen({ title: s.title, back: s.back, nav: false }, ...parts);
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
    }
    return el('p', { text: 'Unbekannter Aufgabentyp.' });
  }
  function feedbackBox(r) {
    const cls = r.status === 'richtig' ? 'ok' : r.status === 'fast' ? 'warn' : 'bad';
    const box = el('div', { class: 'feedback ' + cls, role: 'status' }, el('b', { class: 'fb-title', text: r.title || (cls === 'ok' ? 'Richtig' : 'Noch nicht richtig') }));
    for (const m of r.msgs || []) box.appendChild(el('p', { text: m }));
    const mm = (r.mids || []).map(mistakeById).filter(Boolean)[0];
    if (mm) box.appendChild(mistakeCard(mm, P.mistakes[mm.id] && P.mistakes[mm.id].n));
    return box;
  }
  function viewFormel(ex, done) {
    let attempts = 0, firstStatus = null, solved = false, shown = false;
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
      el('p', { class: 'prompt', text: ex.prompt }),
      ex.diagram ? diagram(ex.diagram, { small: true }) : null,
      grid,
      el('div', { class: 'hint-line small muted' }, 'Formel für ', el('b', { text: ex.target }), ex.fill ? ' · herunterziehbar bis ' + ex.fill.split(':')[1] : '', ' · Zellen antippen fügt sie ein'),
      fi.box, fbSlot, el('div', { class: 'row-btns' }, btnSol, btnCheck, btnNext));
    function check() {
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
  function viewWahl(ex, done) {
    const wrap = el('div', { class: 'ex ex-wahl' });
    const opts = ex.keepOrder ? ex.options.slice() : shuffle(ex.options);
    const fbSlot = el('div');
    const btnNext = el('button', { class: 'btn primary', style: { display: 'none' } }, 'Weiter');
    let outcome = null, mid = null;
    const list = el('div', { class: 'options' });
    opts.forEach((o) => {
      const b = el('button', { class: 'option' + (o.d ? ' has-diagram' : '') }, optionNode(o));
      b.addEventListener('click', () => {
        if (outcome) return;
        outcome = o.ok ? 'first' : 'wrong';
        [...list.children].forEach((c, k) => { c.disabled = true; if (opts[k].ok) c.classList.add('correct'); });
        if (!o.ok) { b.classList.add('wrong'); if (o.mid) { mid = o.mid; recordMistakes([o.mid], ex.id); } }
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
    put(wrap, el('p', { class: 'prompt', text: ex.prompt }), ex.formula ? formulaBox(ex.formula, 'big') : null, ex.diagram ? diagram(ex.diagram, { small: true }) : null,
      ex.sheet ? sheetGrid(ex.sheet, { maxHeight: '36vh' }) : null, list, fbSlot, el('div', { class: 'row-btns' }, btnNext));
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
      const r = Checker.checkValue(expected, input.value);
      if (r.status === 'leer') { toast(r.msgs[0]); return; }
      attempts++;
      fbSlot.innerHTML = '';
      const ans = XL.formatValue(expected, ex.fmt);
      if (r.status === 'richtig') {
        outcome = attempts === 1 ? 'first' : 'wrong';
        fbSlot.appendChild(feedbackBox({ status: 'richtig', title: 'Richtig', msgs: ['Excel zeigt: ' + ans].concat(ex.explain ? [ex.explain] : []) }));
      } else if (attempts < 2) {
        fbSlot.appendChild(feedbackBox({ status: 'falsch', title: 'Nicht ganz', msgs: (r.msgs || []).concat(['Rechne nochmal Schritt für Schritt.']) }));
        return;
      } else {
        outcome = 'wrong';
        fbSlot.appendChild(feedbackBox({ status: 'falsch', title: 'Leider falsch', msgs: ['Excel zeigt: ' + ans].concat(ex.explain ? [ex.explain] : []) }));
      }
      btnCheck.style.display = 'none';
      btnNext.style.display = '';
    }
    put(wrap, el('p', { class: 'prompt', text: ex.prompt }), sheetGrid(ex.sheet, { target: ex.target, maxHeight: '40vh' }),
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
    put(wrap, el('p', { class: 'prompt', text: ex.prompt }), answer, chips, fbSlot, el('div', { class: 'row-btns' }, btnCheck, btnNext));
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
  // Wiederholen
  // =====================================================================
  function viewReview() {
    const due = dueList();
    const mine = [...new Set(Object.values(P.mistakes).flatMap((r) => r.items))].map(exById).filter((e) => e && mySubjects().some((s) => s.id === topicById(e._topic)._subject));
    const row = (ic, title, sub, onclick, primary, disabled) => el('button', { class: 'action review-card' + (primary ? ' primary' : ''), style: primary ? { background: 'var(--blue)' } : null, disabled: !!disabled, onclick },
      el('span', { class: 'act-ic' }, icon(ic)), el('span', { class: 'act-text' }, el('b', { text: title }), el('span', { class: 'small', text: sub })), icon('chev', 'chev'));
    screen({ title: 'Wiederholen', nav: 'rep' },
      el('section', { class: 'actions' },
        row('repeat', due.length ? due.length + ' Aufgaben fällig' : 'Nichts fällig', due.length ? 'Jetzt wiederholen' : 'Schau morgen wieder rein',
          () => startSession(interleave(due).slice(0, 12), 'Wiederholen', '#/wiederholen'), due.length > 0, !due.length),
        row('grid', 'Gemischt üben', 'Alle Themen durcheinander – wie in der Klausur', () => startSession(mixSet(myExercises()), 'Gemischt', '#/wiederholen')),
        row('alert', 'Eigene Fehler', mine.length ? mine.length + ' Aufgaben mit typischem Fehler' : 'Noch keine Fehler gesammelt',
          () => startSession(interleave(shuffle(mine)).slice(0, 10), 'Fehler üben', '#/wiederholen'), false, !mine.length)),
      el('p', { class: 'small muted center', text: 'Richtige Aufgaben kommen nach 1, 3, 7 und 16 Tagen wieder, falsche schon am selben Tag.' }));
  }
  function mixSet(all) {
    const weighted = all.map((e) => {
      const t = topicById(e._topic);
      const it = P.items[e.id];
      return { e, k: Math.random() * (t.focus ? 3 : 1) * (it ? (6 - it.box) : 3) };
    });
    weighted.sort((a, b) => b.k - a.k);
    return interleave(weighted.slice(0, 10).map((x) => x.e));
  }

  // =====================================================================
  // Erfolge: Streak, Tagesziel, Medaillen
  // =====================================================================
  function viewRewards() {
    const s = streak();
    const goalSel = el('div', { class: 'seg' }, [5, 10, 20].map((g) => el('button', { class: 'seg-btn' + (goal() === g ? ' on' : ''), onclick: () => { P.settings.goal = g; checkGoal(); checkRewards(null); route(); } }, g + ' Aufgaben')));
    const earned = MEDALS.filter((m) => P.medals[m.id]).length;
    const grid = el('div', { class: 'medal-grid' }, MEDALS.map((m) => el('div', { class: 'medal-cell' + (P.medals[m.id] ? '' : ' locked') },
      medal({ color: m.color, glyph: m.glyph, size: 52, locked: !P.medals[m.id] }), el('b', { text: m.name }), el('span', { class: 'small muted', text: m.desc }))));
    const topicMedals = [];
    for (const sub of mySubjects()) {
      topicMedals.push(el('h3', { class: 'group-h', style: { color: sub.color }, text: sub.name }));
      topicMedals.push(el('div', { class: 'tmedal-list' }, sub.topics.map((t) => {
        const tier = P.tiers[t.id];
        return el('a', { class: 'tmedal', href: '#/t/' + t.id }, medal({ color: tier || 'gold', locked: !tier, glyph: 'star', size: 30 }), el('span', { text: t.title }), el('span', { class: 'small muted', text: tier ? TIER_NAME[tier] : mastery(t) + ' %' }));
      })));
    }
    const answered = P.stats.answered, correctPct = answered ? Math.round(100 * P.stats.correct / answered) : 0;
    screen({ title: 'Erfolge', nav: 'win', right: el('button', { class: 'icon-btn', 'aria-label': 'Einstellungen', onclick: () => go('#/einstellungen') }, icon('gear')) },
      el('section', { class: 'card streak-card' },
        el('div', { class: 'sk-top' }, el('span', { class: 'sk-flame' + (s ? ' on' : '') }, icon('flame')), el('div', null, el('div', { class: 'sk-num', text: String(s) }), el('div', { class: 'muted small', text: (s === 1 ? 'Tag' : 'Tage') + ' in Folge · Rekord ' + (P.best || 0) }))),
        weekStrip(),
        el('div', { class: 'small muted', text: 'Ein Tag zählt, wenn du dein Tagesziel schaffst.' })),
      el('section', { class: 'card' }, el('b', { text: 'Tagesziel' }), goalSel),
      el('div', { class: 'row-head' }, el('h2', { text: 'Medaillen' }), el('span', { class: 'muted small', text: earned + ' von ' + MEDALS.length })),
      grid,
      el('h2', { text: 'Themen-Medaillen' }), el('p', { class: 'small muted', text: 'Bronze ab 30 %, Silber ab 65 %, Gold bei 100 % – je sicherer du ein Thema kannst.' }), ...topicMedals,
      el('section', { class: 'card stats' },
        el('div', null, el('b', { text: String(answered) }), el('span', { class: 'small muted', text: 'Aufgaben' })),
        el('div', null, el('b', { text: correctPct + ' %' }), el('span', { class: 'small muted', text: 'gleich richtig' })),
        el('div', null, el('b', { text: String(P.stats.examsDone) }), el('span', { class: 'small muted', text: 'Probeklausuren' }))));
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
    screen({ title: 'Probeklausur', sub: s.name, back: '#/f/' + s.id, color: s.color, nav: false }, ...parts);
  }
  function viewExamStart(id) {
    const k = examById(id);
    if (!k) return viewHome();
    const s = subjectById(k._subject);
    if (examState && examState.k.id === id && !examState.submitted) return renderExam();
    if (examState && examState.k.id === id && examState.submitted) return renderExamResult();
    screen({ title: k.title, back: '#/f/' + s.id + '/klausur', nav: false },
      el('section', { class: 'card' }, el('p', { text: k.intro }),
        el('ul', { class: 'small' }, el('li', { text: k.tasks.length + ' Aufgaben, ' + examMax(k) + ' Punkte, ' + k.minutes + ' Minuten' }),
          el('li', { text: 'Gelbe Zellen = hier gehört eine Formel hin. Die Werte zeigen, was herauskommen soll.' }), el('li', { text: 'Tippe auf eine Zelle, um sie in die Formel einzufügen.' }))),
      el('button', { class: 'btn primary block', style: { background: s.color }, onclick: () => { examState = { k, answers: {}, end: Date.now() + k.minutes * 60000, submitted: false, active: null }; renderExam(); } }, 'Klausur starten'));
  }
  function renderExam() {
    const st = examState, k = st.k;
    const timer = el('span', { class: 'timer' }, icon('clock'), el('b', { text: '' }));
    const submit = el('button', { class: 'btn small-btn', onclick: () => { if (confirm('Klausur jetzt abgeben?')) submitExam(); } }, 'Abgeben');
    const main = screen({ title: k.title, nav: false, right: el('div', { class: 'top-right' }, timer, submit), cls: 'exam' });
    const inputs = {};
    const grid = sheetGrid(k.sheet, { showTarget: 'value', maxHeight: '42vh', onCell: (a) => { if (st.active && inputs[st.active]) inputs[st.active].insertRef(a); } });
    main.appendChild(grid);
    k.tasks.forEach((t, i) => {
      const key = t.cell || ('mc' + i);
      const head = el('div', { class: 'task-head' }, el('span', { class: 'cell-chip', text: t.cell || ('Aufgabe ' + (i + 1)) }), el('span', { class: 'small muted', text: t.points + ' P' }));
      const box = el('section', { class: 'card task' }, head, el('p', { text: t.prompt }));
      if (t.type === 'wahl') {
        if (t.diagram) box.appendChild(diagram(t.diagram, { small: true }));
        const list = el('div', { class: 'options' });
        t.options.forEach((o, j) => {
          const b = el('button', { class: 'option' + (st.answers[key] === j ? ' picked' : '') }, optionNode(o));
          b.addEventListener('click', () => { st.answers[key] = j; [...list.children].forEach((c, q) => c.classList.toggle('picked', q === j)); });
          list.appendChild(b);
        });
        box.appendChild(list);
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
        box.appendChild(fi.box);
      }
      main.appendChild(box);
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
    saveP();
    renderExamResult();
    checkRewards(null);
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
        startSession(interleave(shuffle(items)).slice(0, 10), 'Schwächen üben', '#/f/' + s.id);
      } }, 'Schwache Themen üben'));
    }
    parts.push(el('button', { class: 'btn ghost block', onclick: () => { examState = null; go('#/f/' + s.id + '/klausur'); } }, 'Fertig'));
    screen({ title: k.title, nav: false }, ...parts);
  }

  // =====================================================================
  // Einstellungen
  // =====================================================================
  function viewSettings() {
    screen({ title: 'Einstellungen', back: '#/', nav: false },
      el('a', { class: 'link-row card', href: '#/faecher' }, icon('grid'), el('span', { text: 'Fächer wählen' }), icon('chev', 'chev')),
      el('section', { class: 'card' }, el('b', { text: 'App aufs Handy legen' }),
        el('p', { class: 'small', text: 'iPhone: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.' }),
        el('p', { class: 'small', text: 'Android: Seite in Chrome öffnen → ⋮ → „App installieren“.' })),
      el('section', { class: 'card' }, el('b', { text: 'Fortschritt' }), el('p', { class: 'small muted', text: 'Dein Fortschritt, deine Medaillen und dein Streak werden nur auf diesem Gerät gespeichert.' }),
        el('button', { class: 'btn ghost block', onclick: () => { if (confirm('Wirklich den ganzen Fortschritt löschen (auch Medaillen und Streak)?')) { P = defaults(); saveP(); toast('Fortschritt gelöscht'); go('#/'); } } }, 'Fortschritt löschen')),
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
    for (const t of TOPICS.values()) { const tier = tierOf(mastery(t)); if (tier && (TIER_RANK[tier] || 0) > (TIER_RANK[P.tiers[t.id]] || 0)) P.tiers[t.id] = tier; }
    for (const m of MEDALS) if (!P.medals[m.id] && m.test()) P.medals[m.id] = today();
    saveP();
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
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  boot();
})();
