/* Lernapp – einfache Textprüfung für Schreibaufgaben (Englisch): Wörter, Sätze, Absätze, Kurzformen,
   linking words, Meinung, Schluss. Wird von der App und vom Inhaltstest benutzt. */
(function (root) {
  'use strict';
  const low = (s) => String(s || '').toLowerCase().replace(/[’`´]/g, "'");
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = (s) => (String(s || '').match(/[A-Za-zÄÖÜäöüß0-9]+(?:'[A-Za-z]+)?/g) || []).length;
  const sentences = (s) => String(s || '').split(/[.!?]+/).map((x) => x.trim()).filter((x) => words(x) >= 2).length;
  // Absatz = Zeile mit mindestens 3 Wörtern (Leerzeilen dazwischen sind egal)
  const paragraphs = (s) => String(s || '').split(/\n+/).map((x) => x.trim()).filter((x) => words(x) >= 3);
  const CONTR = /\b(?:[a-z]+n't|it's|that's|there's|here's|what's|who's|he's|she's|let's|i'm|you're|we're|they're|i've|you've|we've|they've|i'll|you'll|we'll|they'll|it'll|i'd|you'd|we'd|they'd|he'd|she'd|gonna|wanna|gotta)\b/g;
  const contractions = (s) => [...new Set(low(s).match(CONTR) || [])];
  // Wortgruppe kommt als ganze Wörter vor? „first(ly)“ steht für first und firstly
  function variants(phrase) {
    const p = low(phrase).trim();
    const m = /^(.*)\((\w+)\)(.*)$/.exec(p);
    return m ? [m[1] + m[3], m[1] + m[2] + m[3]].map((x) => x.trim()) : [p];
  }
  const has = (text, phrase) => variants(phrase).some((v) => new RegExp('(^|[^a-z])' + esc(v) + '(?![a-z])').test(low(text)));
  const found = (text, list) => list.filter((p) => has(text, p));
  const bankWords = (bank) => (bank || []).flatMap((g) => g.words.map((w) => w[0]));
  // Prüfpunkte einer Schreibaufgabe: [{label, ok, hint}]
  function runChecks(text, checks, bank) {
    const out = [];
    for (const c of checks || []) {
      if (c.k === 'min') out.push({ label: 'Mindestens ' + c.n + ' Wörter', ok: words(text) >= c.n, hint: words(text) + ' Wörter' });
      else if (c.k === 'sentences') out.push({ label: 'Mindestens ' + c.n + ' Sätze', ok: sentences(text) >= c.n, hint: sentences(text) + ' Sätze' });
      else if (c.k === 'formal') { const cs = contractions(text); out.push({ label: 'Keine Kurzformen (formeller Stil)', ok: !cs.length, hint: cs.length ? 'gefunden: ' + cs.join(', ') : '' }); }
      else if (c.k === 'avoid') { const f = found(text, c.words); out.push({ label: c.label || 'Ohne ' + c.words.join(', '), ok: !f.length, hint: f.length ? 'gefunden: ' + f.join(', ') : '' }); }
      else if (c.k === 'any') { const f = found(text, c.words); out.push({ label: c.label, ok: f.length > 0, hint: f.length ? f.join(', ') : '' }); }
      else if (c.k === 'linking') { const f = found(text, bankWords(bank)); out.push({ label: 'Mindestens ' + c.n + ' linking words', ok: f.length >= c.n, hint: f.length ? f.join(', ') : 'keine gefunden' }); }
    }
    return out;
  }
  // ganzer Comment: automatische Prüfpunkte
  function analyse(text, opts) {
    const bank = bankWords(opts.bank);
    const paras = paragraphs(text);
    const linking = found(text, bank);
    const opinion = found(text, opts.opinion || []);
    const last = paras.length ? paras[paras.length - 1] : '';
    const concl = found(last, opts.conclude || []);
    const cs = contractions(text);
    const think = (low(text).match(/\bi think\b/g) || []).length;
    const n = words(text);
    const checks = [
      { label: 'Mindestens ' + opts.minWords + ' Wörter', ok: n >= opts.minWords, hint: n + ' Wörter' },
      { label: 'Mindestens 4 Absätze (Einleitung, 2× Hauptteil, Schluss)', ok: paras.length >= 4, hint: paras.length + ' Absätze' },
      { label: 'Mindestens 6 verschiedene linking words', ok: linking.length >= 6, hint: linking.length + ': ' + linking.join(', ') },
      { label: 'Deine Meinung kommt klar vor', ok: opinion.length > 0, hint: opinion.join(', ') },
      { label: 'Der Schluss beginnt mit einem Signalwort', ok: concl.length > 0, hint: concl.join(', ') },
      { label: 'Keine Kurzformen (formeller Stil)', ok: !cs.length, hint: cs.length ? 'gefunden: ' + cs.join(', ') : '' },
      { label: '„I think“ höchstens zweimal', ok: think <= 2, hint: think + '×' },
    ];
    return { checks, linking, words: n, paragraphs: paras.length };
  }
  // linking words im Text markieren (für die Auswertung)
  function markHtml(text, list) {
    const e = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const vs = list.flatMap(variants).sort((a, b) => b.length - a.length).map(esc);
    if (!vs.length) return e(text);
    const re = new RegExp('(^|[^A-Za-z])(' + vs.join('|') + ')(?![A-Za-z])', 'gi');
    return e(text).replace(re, (m, pre, w) => pre + '<mark>' + w + '</mark>');
  }
  root.TextCheck = { words, sentences, paragraphs, contractions, has, found, bankWords, runChecks, analyse, markHtml };
})(typeof window !== 'undefined' ? window : globalThis);
