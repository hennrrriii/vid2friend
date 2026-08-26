# vid2friend

Freunde empfehlen sich gegenseitig YouTube-Videos, und die Empfehlungen erscheinen
direkt ganz oben auf der YouTube-Startseite des Empfaengers. Kein Link mehr, der in
WhatsApp untergeht.

Chrome Extension (Manifest V3) + Supabase. Kein eigener Server, kein YouTube Data
API Key, kein E-Mail-Login.

> **Hinweis zum Stand:** Dieses README waechst mit dem Projekt. Aktuell ist
> Meilenstein 1 (Grundgeruest) fertig. Die vollstaendige Anleitung inklusive
> Supabase-Setup, Test zu zweit und Chrome-Web-Store-Veroeffentlichung kommt mit
> Meilenstein 8. Was schon geht, steht unten.

---

## 1. Voraussetzungen

| Werkzeug | Version | Pruefen mit |
|---|---|---|
| Node.js | 22 LTS oder 24 LTS empfohlen (getestet auch mit 23.9) | `node -v` |
| npm | 10 oder neuer | `npm -v` |
| Google Chrome | aktuell | `chrome://version` |
| Git | beliebig aktuell | `git --version` |

Node bekommst du von <https://nodejs.org>. Nimm die LTS-Version.

**Bekannter Stolperstein unter Windows:** `npm install` bricht mit
`Cannot read properties of null (reading 'edgesOut')` ab. Das ist ein Bug in
npm 10.9 beim Aufloesen von Vitest' optionalen Peer-Dependencies, nicht dein
Fehler. Loesung:

```bash
npm install --legacy-peer-deps
```

## 2. Projekt einrichten

```bash
git clone <dein-repo> vid2friend
cd vid2friend
npm install --legacy-peer-deps
cp .env.example .env
```

Die `.env` darf zum Bauen erstmal die Platzhalter behalten. Die Extension laedt
dann trotzdem und zeigt im Popup den Hinweis "Setup incomplete". Wie du ein
Supabase-Projekt anlegst und die zwei Werte findest, steht ab Meilenstein 2 hier
im README.

## 3. Bauen und in Chrome laden

```bash
npm run build
```

Das Ergebnis liegt in `dist/`. Dann:

1. Chrome oeffnen, in die Adresszeile `chrome://extensions` eingeben.
2. Oben rechts **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** klicken.
4. Den Ordner `dist` auswaehlen (nicht das Projekt-Root, nicht `src`).

<!-- SCREENSHOT: chrome://extensions mit aktiviertem Entwicklermodus und geladener vid2friend-Extension -->

Danach solltest du das blaue vid2friend-Icon in der Toolbar sehen. Klick drauf:
es oeffnet sich ein dunkles Popup mit vier Tabs.

**Nach Code-Aenderungen:** entweder `npm run build` erneut ausfuehren und in
`chrome://extensions` auf das Reload-Symbol bei vid2friend klicken, oder im
Entwicklungsmodus arbeiten:

```bash
npm run dev
```

Dabei laedt CRXJS die Extension bei Aenderungen weitgehend selbst neu. Das Popup
aktualisiert sich sofort, Content Script und Service Worker brauchen manchmal
trotzdem einen manuellen Reload plus F5 auf dem YouTube-Tab.

## 4. Pruefen, dass alles laeuft

- Icon in der Toolbar sichtbar, Popup oeffnet sich.
- In `chrome://extensions` bei vid2friend auf **Service Worker** klicken. Die
  DevTools oeffnen sich und zeigen `[vid2friend] installed: install`.
- <https://www.youtube.com> oeffnen, DevTools mit F12, Tab Console. Dort steht
  `[vid2friend] content script ready on /`.
- Wenn du in der Console nichts siehst: `localStorage.v2fDebug = '1'` eingeben
  und die Seite neu laden. Produktions-Builds loggen nur mit diesem Flag.

## 5. Nuetzliche Kommandos

| Kommando | Was es tut |
|---|---|
| `npm run dev` | Entwicklungsserver mit Hot Reload |
| `npm run build` | Typecheck plus Produktions-Build nach `dist/` |
| `npm run typecheck` | Nur TypeScript pruefen |
| `npm test` | Vitest einmal durchlaufen lassen |
| `npm run icons` | Icons aus `public/icons/logo.svg` neu rendern |

## 6. Projektstruktur

```
vid2friend/
├─ src/
│  ├─ background/     Service Worker (Realtime, Badge, Polling)
│  ├─ content/        Content Scripts fuer youtube.com
│  │  └─ selectors.ts ALLE DOM-Selektoren, zentral an einer Stelle
│  ├─ popup/          React-Popup
│  ├─ shared/         Supabase-Client, Typen, Slot-Logik, Storage
│  └─ styles/
├─ supabase/migrations/   SQL-Migrationen (Schema, RLS, Funktionen)
├─ public/icons/          16/32/48/128 px, generiert aus logo.svg
├─ manifest.config.ts     Das Manifest, als TypeScript
└─ CONTRIBUTING-NOTES.md  Entscheidungen und bekannte Schwachstellen
```

## 7. Sprache

Die Extension selbst ist komplett auf **Englisch** (UI, Code, Kommentare). Dieses
README ist auf Deutsch.
