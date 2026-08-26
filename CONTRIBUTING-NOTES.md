# Notizen an dich

Hier sammle ich Entscheidungen, Abweichungen von der Spec und Stellen, die ich für
brüchig halte. Chronologisch nach Meilenstein.

---

## Meilenstein 1 - Grundgerüst

### Entscheidungen

**Vite 8 + CRXJS 2.7.1.** CRXJS deklariert Vite 8 explizit als unterstützt. Falls
es doch klemmt, ist der Rückweg auf Vite 7 ein Einzeiler in `package.json`, weil
wir keine Vite-8-spezifischen APIs nutzen.

**Manifest als TypeScript** (`manifest.config.ts`) statt statischer JSON-Datei.
Grund: die Version kommt so automatisch aus `package.json`, und die
Host-Permission für Supabase wird zur Buildzeit aus `VITE_SUPABASE_URL`
abgeleitet. Ohne `.env` fällt sie auf `https://*.supabase.co/*` zurück, damit ein
frischer Clone überhaupt baut. **Für die Store-Einreichung immer mit gefüllter
`.env` bauen**, sonst steht im Manifest eine viel breitere Permission als nötig,
und genau danach fragt das Review.

**Icons werden generiert, aber committet.** `npm run icons` rendert
`public/icons/logo.svg` über sharp in die vier PNG-Größen. Die PNGs liegen im
Repo, damit `npm install && npm run build` auch dann funktioniert, wenn sharp
seine Plattform-Binary nicht laden kann (CI, anderer Rechner).

**Kein Tailwind.** Das Popup ist ~380px breit und hat vielleicht 40 Elemente. Eine
CSS-Datei mit CSS-Variablen ist hier kleiner und schneller als ein Tailwind-Build,
und im Content Script wäre Tailwind ohnehin gefährlich (globale Resets auf YouTube
loslassen: keine gute Idee).

**Logging.** `src/shared/log.ts` statt `console.log`. Warnungen und Fehler sind
immer sichtbar, `debug`/`info` nur in DEV-Builds oder wenn man
`localStorage.v2fDebug = '1'` setzt. Dazu `warnOnce(key, ...)` für kaputte
DOM-Selektoren, weil ein MutationObserver dieselbe Warnung sonst hundertfach
druckt.

### Stolpersteine, auf die ich gestoßen bin

**`npm install` crasht mit `edgesOut`.** npm 10.9 verschluckt sich beim Auflösen
der optionalen Peer-Dependencies von Vitest 4 (`@vitest/browser` ->
`webdriverio`). Kein Problem im Projekt, ein Bug in npm. `--legacy-peer-deps` löst
es. Steht auch im README.

**Vitest 4 will Node ^20 / ^22 / >=24.** Auf deinem Node 23.9 gibt npm eine
`EBADENGINE`-Warnung aus, Vitest läuft aber problemlos. Wenn dich die Warnung
stört: Node 24 LTS installieren.

### Wo ich es bewusst noch nicht sauber gemacht habe

- `src/content/index.ts` und `src/background/index.ts` sind noch Gerüst. Der
  Bootstrap-Guard und die try/catch-Klammer stehen aber schon, damit sich das
  Muster nicht später erst einschleicht.
- Noch keine Tests. Der erste sinnvolle Test ist der Slot-Algorithmus in
  Meilenstein 2, alles davor wäre Test-Theater.
