# Notizen an dich

Hier sammle ich Entscheidungen, Abweichungen von der Spec und Stellen, die ich
fuer bruechig halte. Chronologisch nach Meilenstein.

---

## Meilenstein 1 - Grundgeruest

### Entscheidungen

**Vite 8 + CRXJS 2.7.1.** CRXJS deklariert Vite 8 explizit als unterstuetzt.
Falls es doch klemmt, ist der Rueckweg auf Vite 7 ein Einzeiler in
`package.json`, weil wir keine Vite-8-spezifischen APIs nutzen.

**Manifest als TypeScript** (`manifest.config.ts`) statt statischer JSON-Datei.
Grund: die Version kommt so automatisch aus `package.json`, und die
Host-Permission fuer Supabase wird zur Buildzeit aus `VITE_SUPABASE_URL`
abgeleitet. Ohne `.env` faellt sie auf `https://*.supabase.co/*` zurueck, damit
ein frischer Clone ueberhaupt baut. **Fuer die Store-Einreichung immer mit
gefuellter `.env` bauen**, sonst steht im Manifest eine viel breitere Permission
als noetig, und genau danach fragt das Review.

**Icons werden generiert, aber committet.** `npm run icons` rendert
`public/icons/logo.svg` ueber sharp in die vier PNG-Groessen. Die PNGs liegen im
Repo, damit `npm install && npm run build` auch dann funktioniert, wenn sharp
seine Plattform-Binary nicht laden kann (CI, anderer Rechner).

**Kein Tailwind.** Das Popup ist ~380px breit und hat vielleicht 40 Elemente.
Eine CSS-Datei mit CSS-Variablen ist hier kleiner und schneller als ein
Tailwind-Build, und im Content Script waere Tailwind ohnehin gefaehrlich (globale
Resets auf YouTube loslassen: keine gute Idee).

**Logging.** `src/shared/log.ts` statt `console.log`. Warnungen und Fehler sind
immer sichtbar, `debug`/`info` nur in DEV-Builds oder wenn man
`localStorage.v2fDebug = '1'` setzt. Dazu `warnOnce(key, ...)` fuer kaputte
DOM-Selektoren, weil ein MutationObserver dieselbe Warnung sonst hundertfach
druckt.

### Stolpersteine, auf die ich gestossen bin

**`npm install` crasht mit `edgesOut`.** npm 10.9 verschluckt sich beim
Aufloesen der optionalen Peer-Dependencies von Vitest 4 (`@vitest/browser` ->
`webdriverio`). Kein Problem im Projekt, ein Bug in npm. `--legacy-peer-deps`
loest es. Steht auch im README.

**Vitest 4 will Node ^20 / ^22 / >=24.** Auf deinem Node 23.9 gibt npm eine
`EBADENGINE`-Warnung aus, Vitest laeuft aber problemlos. Wenn dich die Warnung
stoert: Node 24 LTS installieren.

### Wo ich es bewusst noch nicht sauber gemacht habe

- `src/content/index.ts` und `src/background/index.ts` sind noch Geruest. Der
  Bootstrap-Guard und die try/catch-Klammer stehen aber schon, damit sich das
  Muster nicht spaeter erst einschleicht.
- Noch keine Tests. Der erste sinnvolle Test ist der Slot-Algorithmus in
  Meilenstein 2, alles davor waere Test-Theater.
