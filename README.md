# vid2friend

Freunde empfehlen sich gegenseitig YouTube-Videos, und die Empfehlungen erscheinen
direkt ganz oben auf der YouTube-Startseite des Empfängers. Kein Link mehr, der in
WhatsApp untergeht.

Chrome Extension (Manifest V3) + Supabase. Kein eigener Server, kein YouTube Data
API Key, kein E-Mail-Login.

> **Stand:** Meilenstein 1 von 8 ist fertig (Grundgerüst). Die vollständige
> Anleitung mit Supabase-Setup, Test zu zweit und Chrome-Web-Store-Veröffentlichung
> entsteht Schritt für Schritt mit den weiteren Meilensteinen.

---

## 1. Voraussetzungen

| Werkzeug | Version | Prüfen mit |
|---|---|---|
| Node.js | 22 LTS oder 24 LTS empfohlen (getestet auch mit 23.9) | `node -v` |
| npm | 10 oder neuer | `npm -v` |
| Google Chrome | aktuell | `chrome://version` |
| Git | beliebig aktuell | `git --version` |

Node bekommst du von <https://nodejs.org>. Nimm die LTS-Version.

## 2. Projekt einrichten

```bash
npm install --legacy-peer-deps
cp .env.example .env
```

Das `--legacy-peer-deps` ist kein Schlamperei-Flag, sondern nötig: npm 10.9 hat
einen Bug beim Auflösen der optionalen Peer-Dependencies von Vitest und bricht
sonst mit `Cannot read properties of null (reading 'edgesOut')` ab.

Die `.env` darf zum Bauen erstmal die Platzhalter behalten. Die Extension lädt
trotzdem und zeigt im Popup den Hinweis "Setup incomplete". Das Supabase-Setup
kommt mit Meilenstein 2 hierher.

## 3. Bauen und in Chrome laden

```bash
npm run build
```

Das Ergebnis liegt in `dist/`. Dann:

1. Chrome öffnen, in die Adresszeile `chrome://extensions` eingeben.
2. Oben rechts **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** klicken.
4. Den Ordner `dist` auswählen (nicht das Projekt-Root, nicht `src`).

<!-- SCREENSHOT: chrome://extensions mit aktiviertem Entwicklermodus und geladener vid2friend-Extension -->

Danach siehst du das blaue vid2friend-Icon in der Toolbar. Klick drauf: es öffnet
sich ein dunkles Popup mit vier Tabs.

**Nach Code-Änderungen:** entweder `npm run build` erneut ausführen und in
`chrome://extensions` auf das Reload-Symbol bei vid2friend klicken, oder im
Entwicklungsmodus arbeiten:

```bash
npm run dev
```

Dabei lädt CRXJS die Extension bei Änderungen weitgehend selbst neu. Das Popup
aktualisiert sich sofort, Content Script und Service Worker brauchen manchmal
trotzdem einen manuellen Reload plus F5 auf dem YouTube-Tab.

## 4. Prüfen, dass alles läuft

- Icon in der Toolbar sichtbar, Popup öffnet sich.
- In `chrome://extensions` bei vid2friend auf **Service Worker** klicken. Die
  DevTools öffnen sich und zeigen `[vid2friend] installed: install`.
- <https://www.youtube.com> öffnen, DevTools mit F12, Tab Console. Dort steht
  `[vid2friend] content script ready on /`.
- Wenn du in der Console nichts siehst: `localStorage.v2fDebug = '1'` eingeben
  und die Seite neu laden. Produktions-Builds loggen nur mit diesem Flag.

## 5. GitHub

Das Repo wird auf GitHub gehostet. Beim ersten Mal verbinden:

```bash
git branch -M main
git remote add origin https://github.com/DEIN-NAME/vid2friend.git
git push -u origin main
```

Die URL steht auf der Repo-Seite hinter dem grünen **Code**-Button (Tab HTTPS).
Beim ersten Push öffnet der Git Credential Manager ein Browser-Fenster zum
Einloggen; danach merkt Windows sich die Anmeldung.

Wenn du das Repo auf GitHub mit einer README oder .gitignore angelegt hast, wird
der erste Push abgelehnt (`rejected ... fetch first`). Dann einmal
`git pull --rebase origin main`, danach den Push wiederholen.

**Was nicht ins Repo gehört:** `.env`, `node_modules/`, `dist/` und die Zip-Datei
für den Store. Das erledigt die `.gitignore` bereits. Der Supabase `service_role`
Key darf nie irgendwo im Repo auftauchen.

## 6. Nützliche Kommandos

| Kommando | Was es tut |
|---|---|
| `npm run dev` | Entwicklungsserver mit Hot Reload |
| `npm run build` | Typecheck plus Produktions-Build nach `dist/` |
| `npm run typecheck` | Nur TypeScript prüfen |
| `npm test` | Vitest einmal durchlaufen lassen |
| `npm run icons` | Icons aus `public/icons/logo.svg` neu rendern |

## 7. Projektstruktur

```
vid2friend/
├─ src/
│  ├─ background/     Service Worker (Realtime, Badge, Polling)
│  ├─ content/        Content Scripts für youtube.com
│  │  └─ selectors.ts ALLE DOM-Selektoren, zentral an einer Stelle
│  ├─ popup/          React-Popup
│  ├─ shared/         Supabase-Client, Typen, Slot-Logik, Storage
│  └─ styles/
├─ supabase/migrations/   SQL-Migrationen (Schema, RLS, Funktionen)
├─ public/icons/          16/32/48/128 px, generiert aus logo.svg
├─ manifest.config.ts     Das Manifest, als TypeScript
└─ CONTRIBUTING-NOTES.md  Entscheidungen und bekannte Schwachstellen
```

## 8. Sprache

Die Extension selbst ist komplett auf **Englisch** (UI, Code, Kommentare). Dieses
README und die Notizen sind auf Deutsch.
