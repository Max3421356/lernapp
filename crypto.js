/* Lernapp – Inhalte sind mit dem Kennwort verschlüsselt (AES-GCM, Schlüssel per PBKDF2 aus dem Kennwort).
   Ohne Kennwort sieht man auf der Website nur die Anmeldung. */
(function (root) {
  'use strict';
  const KEY_STORE = 'lernapp.key.v1';
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function b64ToBytes(b64) { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  function bytesToB64(bytes) { let s = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)); return btoa(s); }

  async function deriveKey(password, saltB64, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  async function decryptBytes(key, buf) {
    const data = new Uint8Array(buf);
    const iv = data.subarray(0, 12);
    const body = data.subarray(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body);
    return new Uint8Array(plain);
  }
  async function saveKey(key) {
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    try { localStorage.setItem(KEY_STORE, bytesToB64(raw)); } catch (e) { /* privater Modus */ }
  }
  async function loadKey() {
    let b64 = null;
    try { b64 = localStorage.getItem(KEY_STORE); } catch (e) { /* ignorieren */ }
    if (!b64) return null;
    try { return await crypto.subtle.importKey('raw', b64ToBytes(b64), { name: 'AES-GCM' }, true, ['decrypt']); } catch (e) { return null; }
  }
  function forgetKey() { try { localStorage.removeItem(KEY_STORE); } catch (e) { /* ignorieren */ } }

  async function fetchBuf(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Datei fehlt: ' + url);
    return r.arrayBuffer();
  }

  // Lädt meta.json und den verschlüsselten Kurs. Gibt {key, course, meta} zurück oder wirft 'wrong'.
  async function unlock(password, meta) {
    // Groß-/Kleinschreibung und Leerzeichen am Rand spielen keine Rolle (leichter auf dem Handy)
    const key = await deriveKey(String(password).trim().toLowerCase(), meta.salt, meta.iter);
    const buf = await fetchBuf(meta.course);
    let plain;
    try { plain = await decryptBytes(key, buf); } catch (e) { throw new Error('wrong'); }
    const course = JSON.parse(dec.decode(plain));
    await saveKey(key);
    return { key, course };
  }
  async function unlockWithStoredKey(meta) {
    const key = await loadKey();
    if (!key) return null;
    try {
      const plain = await decryptBytes(key, await fetchBuf(meta.course));
      return { key, course: JSON.parse(dec.decode(plain)) };
    } catch (e) {
      if (e && /Datei fehlt|Failed to fetch|NetworkError/i.test(String(e.message || e))) throw e;
      forgetKey();
      return null;
    }
  }
  const blobCache = new Map();
  async function videoUrl(key, url) {
    if (blobCache.has(url)) return blobCache.get(url);
    const plain = await decryptBytes(key, await fetchBuf(url));
    const u = URL.createObjectURL(new Blob([plain], { type: 'video/mp4' }));
    blobCache.set(url, u);
    return u;
  }

  root.LCrypto = { unlock, unlockWithStoredKey, forgetKey, videoUrl, b64ToBytes, bytesToB64 };
})(window);
