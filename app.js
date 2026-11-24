/* Lernapp – Hauptprogramm: Anmeldung, Themen, Üben, Wiederholen (Lernkartei), Probeklausuren, häufige Fehler. */
(function () {
  'use strict';
  const { el, icon, toast, formulaBox, sheetGrid, diagram, formulaInput, progressRing } = UI;
  // wie Element.append, aber ohne leere Teile (null, false)
  const put = (node, ...kids) => { for (const k of kids.flat()) { if (k === null || k === undefined || k === false) continue; node.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); } return node; };
  const app = document.getElementById('app');
  let META = null, COURSE = null, KEY = null;
  const COLORS = { indigo: '#4F5BD5', teal: '#0E9F8E', green: '#2E9D4F', orange: '#E8762B', amber: '#C98A00', blue: '#2F7DE1', purple: '#8A4FD8', red: '#DD4238' };
  const colorOf = (t) => COLORS[t.color] || '#2F7DE1';

  // =====================================================================
  // Fortschritt (Lernkartei mit 5 Fächern) – gespeichert nur auf diesem Gerät
  // =====================================================================
  const PKEY = 'lernapp.progress.v1';
  const INTERVAL = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 16 };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const today = () => iso(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const defaults = () => ({ items: {}, mistakes: {}, seen: {}, exams: {}, streak: { last: null, days: 0 }, settings: {}, tips: {} });
  let P = loadP();
  function loadP() { try { const p = JSON.parse(localStorage.getItem(PKEY) || '{}'); return Object.assign(defaults(), p); } catch (e) { return defaults(); } }
  function saveP() { try { localStorage.setItem(PKEY, JSON.stringify(P)); } catch (e) { /* voll oder privat */ } }
  function touchStreak() {
    const t = today();
    if (P.streak.last === t) return;
    P.streak.days = P.streak.last === addDays(t, -1) ? P.streak.days + 1 : 1;
    P.streak.last = t;
  }
  function grade(id, outcome) {
    const it = P.items[id] || { box: 0, right: 0, wrong: 0 };
    const t = today();
    if (outcome === 'first' || outcome === 'known') { it.box = Math.min(5, Math.max(1, it.box) + 1); it.right++; }
    else if (outcome === 'fast') { it.box = Math.max(1, it.box); it.right++; }
    else { it.box = 1; it.wrong++; }
    it.due = addDays(t, outcome === 'fast' ? 1 : INTERVAL[it.box]);
    it.last = t;
    P.items[id] = it;
    touchStreak();
    saveP();
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
  const allExercises = () => COURSE.topics.flatMap((t) => t.exercises.map((e) => Object.assign(e, { _topic: t.id })));
  const exById = (id) => allExercises().find((e) => e.id === id);
  const topicById = (id) => COURSE.topics.find((t) => t.id === id);
  const mistakeById = (id) => COURSE.mistakes.find((m) => m.id === id);
  function mastery(topic) {
    const ex = topic.exercises;
    if (!ex.length) return 0;
    let s = 0;
    for (const e of ex) { const it = P.items[e.id]; if (it && it.box) s += Math.min(1, (it.box - 1) / 3); }
    return Math.round(100 * s / ex.length);
  }
  function dueList() {
    const t = today();
    return allExercises().filter((e) => P.items[e.id] && P.items[e.id].due <= t)
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
  function fitness() {
    const focus = COURSE.topics.filter((t) => t.focus), other = COURSE.topics.filter((t) => !t.focus);
    const avg = (arr) => (arr.length ? arr.reduce((s, t) => s + mastery(t), 0) / arr.length : 0);
    return Math.round(avg(focus) * 0.7 + avg(other) * 0.3);
  }
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const a = new Date(today() + 'T12:00:00'), b = new Date(dateStr + 'T12:00:00');
    return Math.round((b - a) / 86400000);
  }

  // =====================================================================
  // Rahmen und Navigation
  // =====================================================================
  function screen(opts, ...content) {
    app.innerHTML = '';
    app.className = opts.cls || '';
    const top = el('header', { class: 'top' + (opts.color ? ' colored' : ''), style: opts.color ? { background: opts.color } : null });
    if (opts.back) top.appendChild(el('button', { class: 'icon-btn', 'aria-label': 'Zurück', onclick: () => go(opts.back) }, icon('back')));
    top.appendChild(el('div', { class: 'top-title' }, el('h1', { text: opts.title || 'Lernapp' }), opts.sub ? el('div', { class: 'top-sub', text: opts.sub }) : null));
    if (opts.right) top.appendChild(opts.right);
    const main = el('main', { class: 'content' }, ...content);
    app.appendChild(top);
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
    return el('nav', { class: 'bottom' }, item('#/', 'home', 'Start', 'home'), rep, item('#/klausur', 'exam', 'Klausur', 'exam'), item('#/fehler', 'alert', 'Fehler', 'err'));
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
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean);
    if (!parts.length) return viewHome();
    if (parts[0] === 't' && parts[1]) {
      const t = topicById(parts[1]);
      if (!t) return viewHome();
      if (parts[2] === 'karten') return viewCards(t);
      if (parts[2] === 'beispiel') return viewExample(t);
      if (parts[2] === 'ueben') return startTopicPractice(t);
      if (parts[2] === 'fehler') return viewTopicMistakes(t);
      return viewTopic(t);
    }
    if (parts[0] === 'wiederholen') return viewReview();
    if (parts[0] === 'klausur') return parts[1] ? viewExamStart(parts[1]) : viewExams();
    if (parts[0] === 'fehler') return viewMistakes();
    if (parts[0] === 'einstellungen') return viewSettings();
    if (parts[0] === 'session') return session ? renderSession() : viewHome();
    return viewHome();
  }

  // =====================================================================
  // Start
  // =====================================================================
  function viewHome() {
    const right = el('div', { class: 'top-right' },
      P.streak.days ? el('span', { class: 'streak', title: 'Tage in Folge gelernt' }, icon('flame'), String(P.streak.days)) : null,
      el('button', { class: 'icon-btn', 'aria-label': 'Einstellungen', onclick: () => go('#/einstellungen') }, icon('gear')));
    const kd = daysUntil(P.settings.examDate);
    const fit = fitness();
    const examCard = el('section', { class: 'card exam-card' },
      el('div', { class: 'exam-card-text' },
        el('div', { class: 'eyebrow', text: 'Nächste Klausur' }),
        kd === null ? el('button', { class: 'link', onclick: () => go('#/einstellungen'), text: 'Datum eintragen' })
          : el('div', { class: 'big', text: kd > 1 ? 'in ' + kd + ' Tagen' : kd === 1 ? 'morgen' : kd === 0 ? 'heute' : 'vorbei' }),
        el('div', { class: 'muted small', text: 'Klausur-Fitness: ' + fit + ' %' })),
      progressRing(fit, '#2F7DE1', 58));
    const due = dueList();
    const todayCard = el('section', { class: 'card today' },
      due.length
        ? [el('div', null, el('div', { class: 'eyebrow', text: 'Heute dran' }), el('div', { class: 'big', text: due.length + (due.length === 1 ? ' Aufgabe' : ' Aufgaben') }), el('div', { class: 'muted small', text: 'Wiederholen festigt, was du schon geübt hast.' })),
          el('button', { class: 'btn primary', onclick: () => startSession(interleave(due).slice(0, 12), 'Wiederholen', '#/') }, 'Wiederholen')]
        : [el('div', null, el('div', { class: 'eyebrow', text: 'Heute dran' }), el('div', { class: 'big', text: Object.keys(P.items).length ? 'Alles wiederholt' : 'Los geht’s' }),
          el('div', { class: 'muted small', text: Object.keys(P.items).length ? 'Weiter mit einem Thema oder einer Probeklausur.' : 'Fang mit einem Thema an – am besten mit einem Schwerpunkt.' }))]);
    const tips = [];
    if (!P.tips.install && !window.matchMedia('(display-mode: standalone)').matches) {
      tips.push(el('section', { class: 'card tip' },
        el('div', null, el('b', { text: 'Tipp: Als App aufs Handy' }),
          el('div', { class: 'small', text: 'iPhone: in Safari auf Teilen → „Zum Home-Bildschirm“. Android: in Chrome auf ⋮ → „App installieren“.' })),
        el('button', { class: 'icon-btn', 'aria-label': 'Tipp schließen', onclick: (e) => { P.tips.install = true; saveP(); e.currentTarget.parentNode.remove(); } }, icon('close'))));
    }
    const list = el('section', { class: 'topics' }, el('h2', { text: 'Themen' }));
    for (const t of COURSE.topics) {
      const m = mastery(t);
      list.appendChild(el('a', { class: 'topic-tile', href: '#/t/' + t.id, style: { '--c': colorOf(t) } },
        el('span', { class: 'tile-bar' }),
        el('span', { class: 'tile-text' }, el('b', { text: t.title }), el('span', { class: 'small muted', text: t.short }),
          t.focus ? el('span', { class: 'chip', text: 'Klausur-Schwerpunkt' }) : null),
        progressRing(m, colorOf(t), 44)));
    }
    const examBtn = el('a', { class: 'btn block exam-btn', href: '#/klausur' }, icon('exam'), 'Probeklausur schreiben');
    screen({ title: 'Lernapp', sub: COURSE.subject + ' · ' + COURSE.title, right, nav: 'home' }, examCard, todayCard, ...tips, list, examBtn);
  }

  // =====================================================================
  // Thema
  // =====================================================================
  function viewTopic(t) {
    const seen = P.seen[t.id] || {};
    const m = mastery(t);
    const done = t.exercises.filter((e) => P.items[e.id] && P.items[e.id].box >= 3).length;
    const row = (n, ic, title, sub, onclick, ok) => el('button', { class: 'step-row', onclick },
      el('span', { class: 'step-n' + (ok ? ' ok' : ''), style: { '--c': colorOf(t) } }, ok ? icon('check') : String(n)),
      el('span', { class: 'step-text' }, el('b', { text: title }), el('span', { class: 'small muted', text: sub })), icon(ic, 'step-ic'));
    const rows = [];
    let n = 1;
    if (t.video && META.videos && META.videos[t.video]) rows.push(row(n++, 'play', 'Lernvideo', 'Bo und Nick erklären · ca. 1 Min.', () => playVideo(t), seen.video));
    rows.push(row(n++, 'cards', 'Kurz erklärt', t.cards.length + ' Merkkarten', () => go('#/t/' + t.id + '/karten'), seen.cards));
    rows.push(row(n++, 'steps', 'Schritt für Schritt', t.example.title, () => go('#/t/' + t.id + '/beispiel'), seen.example));
    rows.push(row(n++, 'pencil', 'Üben', t.exercises.length + ' Aufgaben · ' + done + ' sicher', () => go('#/t/' + t.id + '/ueben'), done === t.exercises.length));
    rows.push(row(n++, 'alert', 'Häufige Fehler', t.mistakes.length + ' typische Fehler', () => go('#/t/' + t.id + '/fehler'), seen.mistakes));
    let nextLabel, nextFn;
    if (t.video && META.videos && META.videos[t.video] && !seen.video) { nextLabel = 'Video ansehen'; nextFn = () => playVideo(t); }
    else if (!seen.cards) { nextLabel = 'Mit den Merkkarten anfangen'; nextFn = () => go('#/t/' + t.id + '/karten'); }
    else if (!seen.example) { nextLabel = 'Beispiel ansehen'; nextFn = () => go('#/t/' + t.id + '/beispiel'); }
    else { nextLabel = done === t.exercises.length ? 'Nochmal üben' : 'Üben'; nextFn = () => go('#/t/' + t.id + '/ueben'); }
    const head = el('section', { class: 'card topic-head' }, el('div', null, el('div', { class: 'eyebrow', text: t.focus ? 'Klausur-Schwerpunkt' : 'Grundlage' }), el('p', { text: t.short })),
      progressRing(m, colorOf(t), 58));
    screen({ title: t.title, back: '#/', color: colorOf(t), nav: 'home' }, head, el('section', { class: 'steps' }, rows), el('button', { class: 'btn primary block', style: { background: colorOf(t) }, onclick: nextFn }, nextLabel));
  }
  function markSeen(tid, key) { P.seen[tid] = Object.assign({}, P.seen[tid], { [key]: true }); touchStreak(); saveP(); }

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
      v.addEventListener('timeupdate', () => { if (v.duration && v.currentTime / v.duration > 0.8 && !(P.seen[t.id] || {}).video) { markSeen(t.id, 'video'); } });
      v.addEventListener('ended', () => { markSeen(t.id, 'video'); });
      status.replaceWith(v);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); route(); } });
      close.onclick = () => { overlay.remove(); route(); };
    } catch (e) {
      status.textContent = 'Das Video konnte nicht geladen werden. Prüfe die Internetverbindung.';
    }
  }

  // ---------- Merkkarten ----------
  function viewCards(t) {
    let i = 0;
    const main = screen({ title: 'Kurz erklärt', sub: t.title, back: '#/t/' + t.id, color: colorOf(t), nav: false });
    function draw() {
      main.innerHTML = '';
      const c = t.cards[i];
      const card = el('section', { class: 'card learn-card', style: { '--c': colorOf(t) } },
        el('div', { class: 'eyebrow', text: 'Karte ' + (i + 1) + ' von ' + t.cards.length }),
        el('h2', { text: c.title }), el('p', { text: c.body }),
        c.formula ? formulaBox(c.formula, 'big') : null,
        c.diagram ? diagram(c.diagram) : null);
      const dots = el('div', { class: 'dots' }, t.cards.map((_, k) => el('i', { class: k === i ? 'on' : '' })));
      const nav = el('div', { class: 'row-btns' },
        el('button', { class: 'btn ghost', disabled: i === 0, onclick: () => { i--; draw(); } }, 'Zurück'),
        i < t.cards.length - 1
          ? el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { i++; draw(); } }, 'Weiter')
          : el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { markSeen(t.id, 'cards'); go('#/t/' + t.id); } }, 'Fertig'));
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

  // ---------- Beispiel Schritt für Schritt ----------
  function viewExample(t) {
    const ex = t.example;
    let i = 0;
    const main = screen({ title: 'Schritt für Schritt', sub: ex.title, back: '#/t/' + t.id, color: colorOf(t), nav: false });
    function draw() {
      main.innerHTML = '';
      const s = ex.steps[i];
      const show = s.show || {};
      const grid = sheetGrid(ex.sheet, { target: show.range ? null : ex.target, hl: s.hl, show: show.range ? show : null, autoScroll: false });
      const bar = el('div', { class: 'f-line static' }, el('span', { class: 'fx', text: 'fx' }), formulaBox(s.formula || ''));
      const card = el('section', { class: 'card step-card' }, el('div', { class: 'eyebrow', text: 'Schritt ' + (i + 1) + ' von ' + ex.steps.length }), el('p', { text: s.text }),
        show.diagram ? diagram(show.diagram, { small: true }) : null);
      const nav = el('div', { class: 'row-btns sticky-nav' },
        el('button', { class: 'btn ghost', disabled: i === 0, onclick: () => { i--; draw(); } }, 'Zurück'),
        i < ex.steps.length - 1
          ? el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { i++; draw(); } }, 'Weiter')
          : el('button', { class: 'btn primary', style: { background: colorOf(t) }, onclick: () => { markSeen(t.id, 'example'); go('#/t/' + t.id + '/ueben'); } }, 'Jetzt selbst üben'));
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
    markSeen(t.id, 'mistakes');
    const list = t.mistakes.map((id) => mistakeById(id)).filter(Boolean).map((m) => mistakeCard(m, P.mistakes[m.id] && P.mistakes[m.id].n));
    screen({ title: 'Häufige Fehler', sub: t.title, back: '#/t/' + t.id, color: colorOf(t), nav: false },
      el('p', { class: 'muted', text: 'Diese Fehler passieren bei diesem Thema am häufigsten. Tippe auf einen Fehler, um Beispiel und Tipp zu sehen.' }), ...list,
      el('button', { class: 'btn primary block', style: { background: colorOf(t) }, onclick: () => go('#/t/' + t.id + '/ueben') }, 'Üben'));
  }
  function viewMistakes() {
    const mine = Object.entries(P.mistakes).filter(([id]) => mistakeById(id)).sort((a, b) => b[1].n - a[1].n);
    const parts = [];
    if (mine.length) {
      parts.push(el('h2', { text: 'Deine häufigsten Fehler' }));
      mine.slice(0, 8).forEach(([id, r]) => parts.push(mistakeCard(mistakeById(id), r.n)));
      const items = [...new Set(mine.flatMap(([, r]) => r.items))].map(exById).filter(Boolean);
      if (items.length) parts.push(el('button', { class: 'btn primary block', onclick: () => startSession(interleave(shuffle(items)).slice(0, 10), 'Fehler üben', '#/fehler') }, 'Diese Fehler üben'));
    } else {
      parts.push(el('section', { class: 'card' }, el('b', { text: 'Noch keine eigenen Fehler gesammelt.' }), el('p', { class: 'small muted', text: 'Wenn dir beim Üben ein typischer Fehler passiert, erscheint er hier – mit Zähler, damit du siehst, woran du arbeiten solltest.' })));
    }
    parts.push(el('h2', { text: 'Alle häufigen Fehler' }));
    for (const t of COURSE.topics) {
      const ms = COURSE.mistakes.filter((m) => m.topic === t.id);
      if (!ms.length) continue;
      parts.push(el('h3', { class: 'group-h', style: { color: colorOf(t) }, text: t.title }));
      ms.forEach((m) => parts.push(mistakeCard(m, P.mistakes[m.id] && P.mistakes[m.id].n)));
    }
    screen({ title: 'Häufige Fehler', nav: 'err' }, ...parts);
  }

  // =====================================================================
  // Üben: Sitzung mit mehreren Aufgaben
  // =====================================================================
  let session = null;
  function startTopicPractice(t) {
    const order = t.exercises.slice().sort((a, b) => {
      const A = P.items[a.id], B = P.items[b.id];
      const ka = !A ? 0 : A.box, kb = !B ? 0 : B.box;
      return ka - kb;
    });
    const first = order.filter((e) => !P.items[e.id] || P.items[e.id].box < 5);
    startSession(first.length ? first : shuffle(order), t.title, '#/t/' + t.id, t);
  }
  function startSession(items, title, back, topic) {
    if (!items.length) { toast('Keine Aufgaben gefunden.'); return; }
    session = { items: items.map((e) => (e._topic ? e : exById(e.id) || e)), idx: 0, title, back, topic, results: [], requeued: new Set(), mids: [] };
    if (location.hash !== '#/session') location.hash = '#/session'; else renderSession();
  }
  function renderSession() {
    const s = session;
    if (s.idx >= s.items.length) return renderSessionEnd();
    const ex = s.items[s.idx];
    const t = topicById(ex._topic) || s.topic;
    const prog = el('div', { class: 'progress' }, el('i', { style: { width: Math.round(100 * s.idx / s.items.length) + '%', background: t ? colorOf(t) : '#2F7DE1' } }));
    const main = screen({ title: s.title, sub: 'Aufgabe ' + (s.idx + 1) + ' von ' + s.items.length + (s.requeued.has(ex.id) && s.idx >= s.items.length - s.requeued.size ? ' · Wiederholung' : ''),
      back: s.back, color: t ? colorOf(t) : null, nav: false, cls: 'session' });
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
    const parts = [el('section', { class: 'card done-card' }, el('div', { class: 'eyebrow', text: 'Runde fertig' }), el('div', { class: 'big', text: ok + ' von ' + n + ' beim ersten Versuch richtig' }),
      el('p', { class: 'muted small', text: 'Was du falsch hattest, kommt in den nächsten Tagen beim Wiederholen wieder dran.' }))];
    if (mids.length) {
      parts.push(el('h2', { text: 'Fehler in dieser Runde' }));
      mids.forEach((m) => parts.push(mistakeCard(m, P.mistakes[m.id] && P.mistakes[m.id].n)));
    }
    parts.push(el('div', { class: 'row-btns' }, el('button', { class: 'btn ghost', onclick: () => go(s.back) }, 'Zurück'),
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
  function feedbackBox(r, ex) {
    const cls = r.status === 'richtig' ? 'ok' : r.status === 'fast' ? 'warn' : 'bad';
    const box = el('div', { class: 'feedback ' + cls, role: 'status' }, el('b', { class: 'fb-title', text: r.title || (cls === 'ok' ? 'Richtig' : 'Noch nicht richtig') }));
    for (const m of r.msgs || []) box.appendChild(el('p', { text: m }));
    const mm = (r.mids || []).map(mistakeById).filter(Boolean)[0];
    if (mm) box.appendChild(mistakeCard(mm, P.mistakes[mm.id] && P.mistakes[mm.id].n));
    return box;
  }
  function viewFormel(ex, done, t) {
    let attempts = 0, firstStatus = null, solved = false, shown = false;
    const lastMids = [];
    const wrap = el('div', { class: 'ex ex-formel' });
    const fi = formulaInput({ fns: FNS[ex._topic] || FNS.exam, onEnter: () => check() });
    const grid = sheetGrid(ex.sheet, { target: ex.target, fill: ex.fill, onCell: (a) => fi.insertRef(a), maxHeight: '44vh' });
    const fbSlot = el('div');
    const btnCheck = el('button', { class: 'btn primary', onclick: () => check() }, 'Prüfen');
    const btnSol = el('button', { class: 'btn ghost', onclick: () => showSolution(), style: { display: 'none' } }, 'Lösung zeigen');
    const btnNext = el('button', { class: 'btn primary', onclick: () => next(), style: { display: 'none' } }, 'Weiter');
    put(wrap, 
      el('p', { class: 'prompt', text: ex.prompt }),
      ex.diagram ? diagram(ex.diagram, { small: true }) : null,
      grid,
      el('div', { class: 'hint-line small muted' }, 'Gesucht: Formel für ', el('b', { text: ex.target }), ex.fill ? ' (herunterziehbar bis ' + ex.fill.split(':')[1] + ')' : '', ' · Tippe auf Zellen, um sie einzufügen.'),
      fi.box, fbSlot, el('div', { class: 'row-btns' }, btnSol, btnCheck, btnNext));
    function check() {
      const r = Checker.checkFormula(ex, fi.value(), { attempt: attempts + 1 });
      if (r.status === 'leer') { toast(r.msgs[0]); return; }
      attempts++;
      if (firstStatus === null) firstStatus = r.status;
      (r.mids || []).forEach((m) => lastMids.push(m));
      recordMistakes(r.mids, ex.id);
      fbSlot.innerHTML = '';
      fbSlot.appendChild(feedbackBox(r, ex));
      if (r.status === 'richtig') {
        solved = true;
        fbSlot.appendChild(el('div', { class: 'solution' }, el('span', { class: 'small muted', text: 'Musterlösung' }), formulaBox(ex.solution), ex.explain ? el('p', { class: 'small', text: ex.explain }) : null));
        btnCheck.style.display = 'none';
        btnSol.style.display = 'none';
        btnNext.style.display = '';
      } else if (r.status === 'fast') {
        // fast richtig: verbessern oder weitermachen
        solved = true;
        btnCheck.textContent = 'Verbessert prüfen';
        btnSol.style.display = 'none';
        btnNext.style.display = '';
      } else if (attempts >= 2) btnSol.style.display = '';
      fbSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function showSolution() {
      shown = true;
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
        if (!o.ok) { const c = opts.find((x) => x.ok); if (c && c.why) r.msgs.push('Richtig ist: ' + (c.t || c.f || 'die markierte Antwort') + ' – ' + c.why); }
        fbSlot.appendChild(feedbackBox(r, ex));
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
    const all = allExercises();
    const mineItems = [...new Set(Object.values(P.mistakes).flatMap((r) => r.items))].map(exById).filter(Boolean);
    const parts = [
      el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'Lernkartei' }),
        el('div', { class: 'big', text: due.length ? due.length + ' fällig' : 'Nichts fällig' }),
        el('p', { class: 'small muted', text: 'Richtig gelöste Aufgaben kommen in immer größeren Abständen wieder (1, 3, 7, 16 Tage). Falsche kommen schnell wieder dran.' }),
        due.length ? el('button', { class: 'btn primary block', onclick: () => startSession(interleave(due).slice(0, 12), 'Wiederholen', '#/wiederholen') }, 'Fällige wiederholen') : null),
      el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'Gemischt üben' }),
        el('p', { class: 'small muted', text: 'Aufgaben aus allen Themen durcheinander – so wie in der Klausur. Schwerpunkt-Themen kommen öfter dran.' }),
        el('button', { class: 'btn primary block', onclick: () => startSession(mixSet(all), 'Gemischt', '#/wiederholen') }, 'Mix starten'))];
    if (mineItems.length) parts.push(el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'Eigene Fehler' }),
      el('p', { class: 'small muted', text: mineItems.length + ' Aufgaben, bei denen dir ein typischer Fehler passiert ist.' }),
      el('button', { class: 'btn primary block', onclick: () => startSession(interleave(shuffle(mineItems)).slice(0, 10), 'Fehler üben', '#/wiederholen') }, 'Fehler üben')));
    const boxes = [0, 0, 0, 0, 0, 0];
    all.forEach((e) => { const it = P.items[e.id]; boxes[it ? it.box : 0]++; });
    parts.push(el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'Deine Kartei' }),
      el('div', { class: 'boxes' }, ['neu', '1', '2', '3', '4', '5'].map((lab, k) => el('div', { class: 'box-col' }, el('div', { class: 'box-bar', style: { height: Math.max(4, Math.round(70 * boxes[k] / all.length)) + 'px' } }), el('b', { text: String(boxes[k]) }), el('span', { class: 'small muted', text: k ? 'Fach ' + lab : lab })))),
      el('p', { class: 'small muted', text: 'Fach 5 = sitzt sicher.' })));
    screen({ title: 'Wiederholen', nav: 'rep' }, ...parts);
  }
  function mixSet(all) {
    const weighted = [];
    for (const e of all) {
      const t = topicById(e._topic);
      const it = P.items[e.id];
      const w = (t.focus ? 3 : 1) * (it ? (6 - it.box) : 3);
      weighted.push({ e, k: Math.random() * w });
    }
    weighted.sort((a, b) => b.k - a.k);
    return interleave(weighted.slice(0, 10).map((x) => x.e));
  }

  // =====================================================================
  // Probeklausuren
  // =====================================================================
  let examState = null, examTimer = null;
  function stopExamTimer() { if (examTimer) { clearInterval(examTimer); examTimer = null; } }
  function examMax(k) { return k.tasks.reduce((s, t) => s + t.points, 0); }
  function noteFor(pct) { return pct >= 92 ? 1 : pct >= 81 ? 2 : pct >= 67 ? 3 : pct >= 50 ? 4 : pct >= 30 ? 5 : 6; }
  function viewExams() {
    const parts = [el('p', { class: 'muted', text: 'So wie in der Klausur: Eine Tabelle mit Werten, gelbe Zellen – du schreibst die Formeln dazu. Ohne Hilfen, mit Zeit. Danach siehst du Punkte, Note und jeden Fehler.' })];
    for (const k of COURSE.exams) {
      const st = P.exams[k.id];
      parts.push(el('section', { class: 'card exam-item' },
        el('div', null, el('b', { text: k.title }), el('div', { class: 'small muted', text: k.minutes + ' Minuten · ' + examMax(k) + ' Punkte' + (st ? ' · bestes Ergebnis: ' + st.best + ' Punkte' : '') })),
        el('a', { class: 'btn primary', href: '#/klausur/' + k.id }, st ? 'Nochmal' : 'Starten')));
    }
    screen({ title: 'Probeklausur', nav: 'exam' }, ...parts);
  }
  function viewExamStart(id) {
    const k = COURSE.exams.find((x) => x.id === id);
    if (!k) return viewExams();
    if (examState && examState.k.id === id && !examState.submitted) return renderExam();
    if (examState && examState.k.id === id && examState.submitted) return renderExamResult();
    screen({ title: k.title, back: '#/klausur', nav: false },
      el('section', { class: 'card' }, el('p', { text: k.intro }),
        el('ul', { class: 'small' }, el('li', { text: k.tasks.length + ' Aufgaben, ' + examMax(k) + ' Punkte' }), el('li', { text: k.minutes + ' Minuten Zeit' }),
          el('li', { text: 'Gelbe Zellen = hier gehört eine Formel hin. Die Werte zeigen, was herauskommen soll.' }), el('li', { text: 'Tippe auf eine Zelle der Tabelle, um sie in die Formel einzufügen.' }))),
      el('button', { class: 'btn primary block', onclick: () => { examState = { k, answers: {}, end: Date.now() + k.minutes * 60000, submitted: false, active: null }; renderExam(); } }, 'Klausur starten'));
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
        fi.input.addEventListener('focus', () => { st.active = key; });
        fi.input.addEventListener('input', () => { st.answers[key] = fi.value(); });
        inputs[key] = fi;
        box.appendChild(fi.box);
      }
      main.appendChild(box);
    });
    main.appendChild(el('button', { class: 'btn primary block', onclick: () => { if (confirm('Klausur jetzt abgeben?')) submitExam(); } }, 'Abgeben'));
    const tick = () => {
      const left = Math.max(0, st.end - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      timer.querySelector('b').textContent = m + ':' + String(s).padStart(2, '0');
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
      const p = r.status === 'richtig' ? t.points : r.status === 'fast' ? Math.floor(t.points) / 2 : 0;
      pts += p;
      recordMistakes(r.mids, null);
      return { t, key, p, r, ans };
    });
    st.points = pts;
    st.max = examMax(k);
    st.submitted = true;
    const rec = P.exams[k.id] || { best: 0, history: [] };
    rec.best = Math.max(rec.best, pts);
    rec.history.push({ date: today(), points: pts, max: st.max });
    P.exams[k.id] = rec;
    touchStreak();
    saveP();
    renderExamResult();
  }
  function renderExamResult() {
    const st = examState, k = st.k;
    const pct = Math.round(100 * st.points / st.max);
    const parts = [el('section', { class: 'card result-card' },
      el('div', { class: 'eyebrow', text: 'Ergebnis' }), el('div', { class: 'big', text: st.points + ' von ' + st.max + ' Punkten (' + pct + ' %)' }),
      el('div', { text: 'Ungefähre Note: ' + noteFor(pct) }), el('p', { class: 'small muted', text: 'Der Notenschlüssel deiner Lehrkraft kann etwas anders sein.' }))];
    const weakTopics = new Set();
    st.results.forEach((res, i) => {
      const t = res.t;
      const full = res.p === t.points;
      if (!full && t.topic) weakTopics.add(t.topic);
      const card = el('section', { class: 'card task-res ' + (full ? 'ok' : res.p > 0 ? 'warn' : 'bad') },
        el('div', { class: 'task-head' }, el('span', { class: 'cell-chip', text: t.cell || ('Aufgabe ' + (i + 1)) }), el('b', { text: res.p + ' / ' + t.points + ' P' })),
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
      parts.push(el('button', { class: 'btn primary block', onclick: () => {
        const items = COURSE.topics.filter((t) => weakTopics.has(t.id)).flatMap((t) => t.exercises.map((e) => Object.assign(e, { _topic: t.id }))).filter((e) => e.type === 'formel');
        startSession(interleave(shuffle(items)).slice(0, 10), 'Schwächen üben', '#/klausur');
      } }, 'Schwache Themen üben'));
    }
    parts.push(el('button', { class: 'btn ghost block', onclick: () => { examState = null; go('#/klausur'); } }, 'Zur Übersicht'));
    screen({ title: k.title, nav: false, back: '#/klausur' }, ...parts);
  }

  // =====================================================================
  // Einstellungen
  // =====================================================================
  function viewSettings() {
    const date = el('input', { type: 'date', class: 'v-input', value: P.settings.examDate || '' });
    date.addEventListener('change', () => { P.settings.examDate = date.value || null; saveP(); toast('Gespeichert'); });
    screen({ title: 'Einstellungen', back: '#/', nav: false },
      el('section', { class: 'card' }, el('label', { class: 'v-label' }, 'Datum der nächsten Klausur', date)),
      el('section', { class: 'card' }, el('b', { text: 'App aufs Handy' }),
        el('p', { class: 'small', text: 'iPhone: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.' }),
        el('p', { class: 'small', text: 'Android: Seite in Chrome öffnen → ⋮ → „App installieren“ oder „Zum Startbildschirm hinzufügen“.' })),
      el('section', { class: 'card' }, el('b', { text: 'Fortschritt' }), el('p', { class: 'small muted', text: 'Dein Fortschritt wird nur auf diesem Gerät gespeichert.' }),
        el('button', { class: 'btn ghost block', onclick: () => { if (confirm('Wirklich den ganzen Fortschritt löschen?')) { P = defaults(); saveP(); toast('Fortschritt gelöscht'); go('#/'); } } }, 'Fortschritt löschen')),
      el('section', { class: 'card' }, el('b', { text: 'Abmelden' }), el('p', { class: 'small muted', text: 'Beim nächsten Öffnen wird wieder nach dem Kennwort gefragt.' }),
        el('button', { class: 'btn ghost block', onclick: () => { LCrypto.forgetKey(); location.hash = ''; location.reload(); } }, 'Abmelden')),
      el('p', { class: 'small muted center', text: 'Lernapp · Inhalte: ' + COURSE.subject + ' – ' + COURSE.title + ' · Stand ' + (META.built || '') }));
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
      el('h1', { text: 'Lernapp' }), el('p', { class: 'muted', text: 'Informatik · Excel · Jahrgang 11' }), pw, err, btn,
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
    COURSE.topics.forEach((t) => t.exercises.forEach((e) => { e._topic = t.id; }));
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
