# vid2friend

Freunde empfehlen sich gegenseitig YouTube-Videos, und die Empfehlungen erscheinen
direkt ganz oben auf der YouTube-Startseite des Empfängers. Kein Link mehr, der in
WhatsApp untergeht.

Chrome Extension (Manifest V3) plus Supabase als Backend. Kein eigener Server,
kein YouTube Data API Key, kein E-Mail-Login, kein Passwort.

Die Extension selbst ist auf Englisch. Diese Anleitung ist auf Deutsch.

---

## Inhalt

1. [Voraussetzungen](#1-voraussetzungen)
2. [Supabase-Projekt anlegen](#2-supabase-projekt-anlegen)
3. [Schema einspielen](#3-schema-einspielen)
4. [Anonyme Anmeldung aktivieren](#4-anonyme-anmeldung-aktivieren)
5. [Verifikation](#5-verifikation-hat-alles-geklappt)
6. [.env einrichten](#6-env-einrichten)
7. [Bauen und in Chrome laden](#7-bauen-und-in-chrome-laden)
8. [Zu zweit testen](#8-zu-zweit-testen-das-wichtigste-kapitel)
9. [Troubleshooting](#9-troubleshooting)
10. [GitHub](#10-github)
11. [Im Chrome Web Store veröffentlichen](#11-im-chrome-web-store-veröffentlichen)
12. [Roadmap und bewusst weggelassen](#12-roadmap-und-bewusst-weggelassen)

Wenn du diese Anleitung von oben nach unten durcharbeitest, steht am Ende eine
laufende Extension, die du mit Freunden benutzen kannst. Rechne mit etwa
45 Minuten, davon 20 Minuten Warten auf Supabase.

---

## 1. Voraussetzungen

| Werkzeug | Version | Prüfen mit |
|---|---|---|
| Node.js | 22 LTS oder 24 LTS (23.x funktioniert auch) | `node -v` |
| npm | 10 oder neuer | `npm -v` |
| Google Chrome | aktuell | `chrome://version` |
| Git | beliebig aktuell | `git --version` |

Node bekommst du von <https://nodejs.org>. Nimm die LTS-Version, die installiert
npm gleich mit.

Dann im Projektordner:

```bash
npm install --legacy-peer-deps
```

Das `--legacy-peer-deps` ist kein Schlamperei-Flag. npm 10.9 hat einen Bug beim
Auflösen der optionalen Peer-Dependencies von Vitest und bricht sonst mit
`Cannot read properties of null (reading 'edgesOut')` ab. Mit dem Flag läuft die
Installation normal durch.

---

## 2. Supabase-Projekt anlegen

Supabase ist Postgres mit einer REST-API und Authentifizierung davor. Der freie
Tarif reicht für dieses Projekt mit großem Abstand.

**2.1 Account anlegen**

1. <https://supabase.com> öffnen, oben rechts **Start your project**.
2. Mit GitHub anmelden. Das ist der schnellste Weg und du brauchst GitHub
   ohnehin (Kapitel 10).

**2.2 Organisation und Projekt**

3. Beim ersten Login fragt Supabase nach einer **Organization**. Name frei
   wählbar (z. B. dein Name), Plan **Free**.
4. Dann **New project**:
   - **Name:** `vid2friend`
   - **Database Password:** auf **Generate a password** klicken und das Passwort
     in deinem Passwortmanager speichern. Du brauchst es nur, falls du dich
     später direkt mit der Datenbank verbindest, aber Supabase zeigt es nie
     wieder an.
   - **Region:** `Central EU (Frankfurt)` bzw. `eu-central-1`. Kürzeste Wege für
     dich und deine Freunde, und die Daten bleiben in der EU.
   - **New project** klicken.

<!-- SCREENSHOT: Supabase "New project" Dialog mit ausgefülltem Namen und Region Frankfurt -->

5. Jetzt dauert es zwei bis fünf Minuten, bis das Projekt bereitsteht. Der
   Fortschritt wird oben angezeigt. Kaffee holen.

**2.3 Project URL und Anon Key finden**

Diese zwei Werte brauchst du in Kapitel 6.

6. Links unten in der Seitenleiste auf das Zahnrad **Project Settings**.
7. Im Untermenü auf **API** (bei neueren Dashboards heißt der Punkt
   **API Keys**).
8. Dort stehen:
   - **Project URL**, etwa `https://abcdefghijklm.supabase.co`
   - **Project API keys**, und darunter der Schlüssel mit der Beschriftung
     **anon** **public**. In neueren Projekten heißt er stattdessen
     **publishable key** und beginnt mit `sb_publishable_`. Beides funktioniert.

<!-- SCREENSHOT: Project Settings > API mit markierter Project URL und anon key -->

> **Wichtig:** Auf derselben Seite steht auch ein **service_role** bzw.
> **secret key**. Den brauchst du für dieses Projekt **nie**. Er umgeht sämtliche
> Sicherheitsregeln. Er darf niemals in die `.env`, niemals ins Repo und niemals
> in die Extension.

---

## 3. Schema einspielen

Es gibt zwei Wege. **Nimm Weg A.** Weg B ist die saubere Variante für später,
wenn du das Schema öfter änderst.

### Weg A: SQL Editor (empfohlen für den ersten Aufbau)

1. In der Supabase-Seitenleiste auf **SQL Editor**.
2. **New query**.
3. Die Datei [`supabase/schema.sql`](supabase/schema.sql) aus diesem Repo
   komplett öffnen, alles markieren, kopieren, in den Editor einfügen.
4. Unten rechts **Run** (oder Strg+Enter).
5. Es sollte `Success. No rows returned` erscheinen.

<!-- SCREENSHOT: SQL Editor mit eingefügtem Schema und "Success. No rows returned" -->

`schema.sql` ist die Zusammenfassung aller Migrationen aus
`supabase/migrations/` in einer Datei, in der richtigen Reihenfolge. Sie wird
mit `npm run sql:bundle` erzeugt und ist im Repo eingecheckt, damit du dafür
nichts ausführen musst.

**Warum ich Weg A empfehle:** ein einziger Copy-Paste-Schritt, keine
CLI-Installation, kein Docker, kein Datenbankpasswort. Für ein Schema, das du
genau einmal einspielst, ist alles andere Zeitverschwendung.

Wenn du das Schema aus Versehen zweimal einspielst, bricht es mit
`type "friendship_status" already exists` ab. Das ist gut so, es bedeutet, dass
schon alles da ist.

### Weg B: Supabase CLI

Sinnvoll, sobald du das Schema weiterentwickelst, weil dann jede Änderung als
eigene Migrationsdatei versioniert ist.

```bash
npm install -g supabase
supabase login
supabase link --project-ref DEIN-PROJECT-REF
supabase db push
```

Den `project-ref` findest du in der Project URL: bei
`https://abcdefghijklm.supabase.co` ist es `abcdefghijklm`. Beim `link` fragt
die CLI nach dem Datenbankpasswort aus Schritt 2.2.

---

## 4. Anonyme Anmeldung aktivieren

Das ist der eine Schalter, den garantiert niemand von allein findet, und ohne
ihn funktioniert gar nichts.

Warum wir ihn brauchen: die Extension meldet jeden Nutzer im Hintergrund anonym
an. Der Nutzer merkt davon nichts, aber dadurch hat jeder eine echte
`auth.uid()`, und nur damit funktionieren die Sicherheitsregeln der Datenbank.

1. In der Seitenleiste auf **Authentication**.
2. Im Untermenü auf **Sign In / Providers** (in älteren Dashboards:
   **Providers**, in ganz alten: **Settings**).
3. Runterscrollen bis zum Abschnitt **User Signups**.
4. **Allow anonymous sign-ins** einschalten.
5. **Save**.

<!-- SCREENSHOT: Authentication > Sign In / Providers mit aktiviertem "Allow anonymous sign-ins" -->

Falls du den Punkt nicht siehst: oben im Dashboard gibt es eine Suche
(Strg+K). Tippe dort `anonymous` ein, Supabase springt direkt zur richtigen
Einstellung.

---

## 5. Verifikation: hat alles geklappt?

Bevor du weitermachst, prüfe die Datenbank einmal durch. Dauert 30 Sekunden und
erspart dir später eine halbe Stunde Suche.

1. **SQL Editor**, **New query**.
2. Inhalt von [`supabase/verify.sql`](supabase/verify.sql) einfügen, **Run**.

Du bekommst eine Tabelle mit zwei Spalten. Alles sollte `PASS` sein. Probleme
stehen oben:

| Zeile | Bedeutet |
|---|---|
| `table: shares` → `MISSING` | Schema wurde nicht (vollständig) eingespielt, Kapitel 3 wiederholen |
| `RLS enabled: shares` → `FAIL - RLS IS OFF` | Nur ein Teil des Schemas lief durch, alles nochmal einspielen |
| `function: recalculate_slots` → `MISSING` | dito |
| `policies on shares` → `FAIL - NO POLICIES` | dito |
| `anonymous sign-ins enabled` → `UNKNOWN` | Normal, solange sich noch niemand angemeldet hat. Prüfe es nach dem ersten Öffnen der Extension nochmal |

Zusätzlich kannst du dir die Tabellen im **Table Editor** ansehen. Es müssen
vier sein: `profiles`, `profile_secrets`, `friendships`, `shares`. Neben jedem
Tabellennamen steht ein grünes Schloss-Symbol mit `RLS enabled`.

**Optional, aber empfehlenswert:** die Sicherheitsregeln selbst testen. Kopiere
[`supabase/tests/rls_test.sql`](supabase/tests/rls_test.sql) in den SQL Editor
und führe es aus. Das Skript legt drei Testnutzer an, prüft vierzehnmal, dass
keiner die Daten der anderen lesen oder verändern kann, und macht am Ende ein
`ROLLBACK`. Es hinterlässt also nichts und ist auch gegen die produktive
Datenbank gefahrlos.

Erwartetes Ergebnis: eine Tabelle mit vierzehn Zeilen, in der ersten Spalte
überall `PASS`. Schlägt eine Prüfung fehl, bricht das Skript sofort rot ab mit
`RLS TEST FAILED: <welche Prüfung>`, und die Tabelle erscheint gar nicht erst.

> Der Supabase SQL Editor zeigt `RAISE NOTICE` nicht an. Verlass dich also auf
> die Ergebnistabelle, nicht auf Meldungen. In `psql` siehst du zusätzlich jede
> einzelne Prüfung mitlaufen.

---

## 6. `.env` einrichten

```bash
cp .env.example .env
```

Dann `.env` öffnen und die zwei Werte aus Kapitel 2.3 eintragen:

```
VITE_SUPABASE_URL=https://abcdefghijklm.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### Ist es ein Problem, dass der Key in der Extension landet?

Nein, und das ist wichtig zu verstehen, bevor du das Repo öffentlich machst.

Der Anon Key landet zwangsläufig im gebauten JavaScript. Jeder, der die
Extension installiert, kann ihn auslesen. Das ist bei Supabase so vorgesehen:
der Anon Key **identifiziert das Projekt, er berechtigt zu nichts**. Was ein
Nutzer lesen und schreiben darf, entscheidet allein Row Level Security anhand
seines JWT.

Konkret heißt das: mit dem Anon Key allein kommt man an keine einzige Zeile.
Erst mit einer gültigen anonymen Anmeldung, und dann sieht man ausschließlich
das eigene Profil, die Profile der eigenen Freunde und die eigenen Empfehlungen.
Genau das prüft `rls_test.sql` aus Kapitel 5.

Der **service_role Key** ist das Gegenteil: er umgeht RLS vollständig. Er darf
niemals in die `.env` dieses Projekts, nicht ins Repo, nicht in die Extension.
Wenn du ihn versehentlich veröffentlichst, sofort im Dashboard unter
Project Settings > API rotieren.

`.env` steht in `.gitignore` und wird nicht committet.

---

## 7. Bauen und in Chrome laden

```bash
npm run build
```

Das Ergebnis liegt in `dist/`. Dann:

1. Chrome öffnen, in die Adresszeile `chrome://extensions` eingeben.
2. Oben rechts **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** klicken.
4. Den Ordner **`dist`** auswählen. Nicht das Projekt-Root, nicht `src`.

<!-- SCREENSHOT: chrome://extensions mit Entwicklermodus und geladener vid2friend-Extension -->

Danach:

5. Klick auf das blaue vid2friend-Icon in der Toolbar. Falls es nicht sichtbar
   ist: auf das Puzzleteil-Symbol klicken und vid2friend anpinnen.
6. Das Popup fragt nach einem Anzeigenamen. Namen eingeben, **Get started**.
7. Fertig. Unter **Friends** steht jetzt dein achtstelliger Freundescode.

**Nach Code-Änderungen** entweder erneut `npm run build` und in
`chrome://extensions` auf das Reload-Symbol bei vid2friend, oder im
Entwicklungsmodus arbeiten:

```bash
npm run dev
```

Dann lädt CRXJS die Extension bei Änderungen weitgehend selbst neu. Das Popup
aktualisiert sich sofort. Content Script und Service Worker brauchen
gelegentlich trotzdem einen manuellen Reload plus F5 auf dem YouTube-Tab.

### Nützliche Kommandos

| Kommando | Was es tut |
|---|---|
| `npm run dev` | Entwicklungsserver mit Hot Reload |
| `npm run build` | Typecheck plus Produktions-Build nach `dist/` |
| `npm run typecheck` | Nur TypeScript prüfen |
| `npm test` | Vitest einmal durchlaufen lassen (Slot-Algorithmus) |
| `npm run icons` | Icons aus `public/icons/logo.svg` neu rendern |
| `npm run sql:bundle` | `supabase/schema.sql` aus den Migrationen neu bauen |
| `npm run zip` | Store-fertiges Zip aus `dist/` erzeugen |

---

## 8. Zu zweit testen (das wichtigste Kapitel)

Das Kernfeature besteht darin, dass zwei Leute sich Videos schicken. Zum Testen
brauchst du also zwei Identitäten. Die anonyme Anmeldung hängt am
Chrome-Profil, deshalb genügen zwei Chrome-Profile auf demselben Rechner.

**8.1 Zweites Chrome-Profil anlegen**

1. Oben rechts in Chrome auf dein Profilbild klicken.
2. **Hinzufügen** anklicken.
3. **Ohne Konto fortfahren** wählen, Name z. B. `Testnutzer`, Farbe egal.
4. Es öffnet sich ein zweites Chrome-Fenster. Dieses Fenster ist Nutzer B, dein
   normales Fenster ist Nutzer A.

<!-- SCREENSHOT: Chrome Profilmenü mit "Hinzufügen" -->

**8.2 Extension in beide Profile laden**

5. Im neuen Fenster ebenfalls `chrome://extensions`, Entwicklermodus an,
   **Entpackte Erweiterung laden**, denselben `dist`-Ordner auswählen.

Beide Profile benutzen dieselbe Datenbank, aber jeweils eine eigene anonyme
Identität. Genau das wollen wir.

**8.3 Konten anlegen und befreunden**

6. **Profil A:** Popup öffnen, Name `Henri`, Get started.
7. **Profil B:** Popup öffnen, Name `Niklas`, Get started.
8. **Profil B:** Tab **Friends**, unten steht **Your friend code**, z. B.
   `K7M2PQR4`. Auf **Copy code**.
9. **Profil A:** Tab **Friends**, den Code oben in das Feld einfügen,
   **Add** klicken.
10. **Profil B:** Popup öffnen. Oben steht jetzt **Wants to connect** mit Henri.
    Auf **Accept**.
11. Beide sehen sich jetzt gegenseitig in der Freundesliste.

Alternativ der persönliche Link: in Profil B **Copy invite link**, den Text in
Profil A in die Adresszeile einfügen. Es öffnet sich YouTube und die Extension
fragt direkt, ob du Niklas hinzufügen möchtest.

**8.4 Ein Video teilen**

12. **Profil B (Niklas):** <https://www.youtube.com> öffnen.
13. Bei irgendeiner Videokachel im Feed auf die drei Punkte klicken. Ganz unten
    im Menü steht jetzt **Share with friends**.
14. Anklicken. Ein Dialog öffnet sich, Henri anhaken, optional eine Notiz
    schreiben, **Share**.
15. Unten links erscheint kurz **Sent to Henri, at the top of their YouTube
    homepage**.

<!-- SCREENSHOT: YouTube Drei-Punkte-Menü mit dem zusätzlichen Eintrag "Share with friends" -->

Der zweite Weg: ein Video öffnen, links neben dem Like-Button sitzt ein Button
**Share with friends**.

**8.5 Die Empfehlung ankommen sehen**

16. **Profil A (Henri):** <https://www.youtube.com> öffnen oder mit F5 neu laden.
17. Ganz oben, über dem normalen Feed, steht eine Reihe **From your friends** mit
    dem geteilten Video und dem Hinweis **Suggested by Niklas**.

<!-- SCREENSHOT: YouTube-Startseite mit der vid2friend-Reihe ganz oben -->

**8.6 Den kompletten Kreislauf prüfen**

18. **Profil A:** das Video anklicken und laufen lassen, bis entweder 60 Prozent
    oder drei Minuten geschaut sind. Zum Testen nimm ein kurzes Video, dann geht
    es schneller.
19. Zurück auf die Startseite: das Video ist aus der Reihe verschwunden, und
    falls weitere in der Warteschlange waren, ist eines nachgerückt.
20. **Profil B:** Popup, Tab **Shared**. Dort steht das Video jetzt unter
    **already handled** mit **Watched vor x Minuten**.

Wenn diese zwanzig Schritte durchlaufen, funktioniert die Extension vollständig.

**Weitere Dinge, die einen Test lohnen:**

- In Profil B mehrere Videos schicken und im Tab **Shared** die Reihenfolge per
  Drag-and-drop ändern. In Profil A ändert sich die Reihe entsprechend.
- In Profil A auf einer Karte oben rechts auf das × gehen. Die Karte
  verschwindet, unten links erscheint ein **Undo**.
- In Profil A unter Settings die Anzahl der Slots auf 3 stellen und die
  Startseite neu laden.

---

## 9. Troubleshooting

### Die Reihe erscheint nicht auf der Startseite

Der Reihe nach prüfen:

1. **Hat der Empfänger überhaupt eine Empfehlung?** Popup öffnen, Tab
   **For you**. Steht dort nichts, ist das Problem beim Teilen, nicht beim
   Anzeigen.
2. **Bist du wirklich auf der Startseite?** Die Reihe erscheint nur auf
   `youtube.com/`, nicht auf Suchergebnissen, Kanalseiten oder im Abo-Feed.
3. **Ist die Extension pausiert?** Settings, Schalter **Pause vid2friend**.
4. **Konsole ansehen:** F12, Tab Console, `localStorage.v2fDebug = '1'` eingeben,
   Seite neu laden. Es sollte `[vid2friend] ready on /` erscheinen. Kommt
   stattdessen eine Warnung mit `no element matched "homeContents"`, hat YouTube
   sein DOM geändert, siehe weiter unten.
5. **Seite hart neu laden** mit Strg+Shift+R. YouTube cached seine Startseite
   aggressiv.

### Der Eintrag im Drei-Punkte-Menü fehlt

- Er wird als **letzter** Eintrag angehängt, nicht als siebter. Ganz nach unten
  scrollen, das Menü ist teilweise scrollbar.
- Er erscheint nur bei Menüs, die zu einer Videokachel gehören. Im Kontomenü
  oben rechts erscheint er absichtlich nicht.
- Menü einmal schließen und neu öffnen. Beim allerersten Öffnen nach dem
  Seitenaufbau kann der Eintrag einen Wimpernschlag zu spät kommen.

### Fehler mit "row-level security" oder "permission denied"

Fast immer eine von zwei Ursachen:

- **Anonyme Anmeldung ist aus.** Kapitel 4. Im Service-Worker-Log steht dann
  `anonymous sign-in failed`.
- **Das Schema wurde nur teilweise eingespielt.** `supabase/verify.sql` laufen
  lassen (Kapitel 5) und schauen, was `MISSING` ist.

Meldet die Extension **You can only share with confirmed friends**, dann hat der
andere die Freundschaftsanfrage noch nicht angenommen. Das ist kein Fehler,
sondern der Spamschutz.

### Der Service Worker steht auf "inactive"

Das ist normal und kein Fehler. Chrome beendet MV3-Service-Worker nach etwa
30 Sekunden Untätigkeit. Er startet automatisch neu, sobald eine Nachricht
eintrifft oder der Fünf-Minuten-Alarm feuert.

Zum Debuggen: `chrome://extensions`, bei vid2friend auf **Service Worker**
klicken, dann öffnen sich dessen DevTools. Solange dieses Fenster offen ist,
bleibt der Worker am Leben.

Wenn dort ein roter Fehler steht: **Errors** aufklappen, das ist die einzige
Stelle, an der Fehler aus dem Service Worker sichtbar werden.

### Realtime kommt nicht an

Symptom: neue Empfehlungen erscheinen erst nach einem Neuladen oder nach ein
paar Minuten.

- Das ist teilweise eingebaut. Der Service Worker wird von Chrome beendet und
  nimmt die Websocket-Verbindung mit. Der Alarm alle fünf Minuten holt das nach.
  Ein Neuladen der YouTube-Seite holt es sofort nach.
- Prüfen, ob Realtime für die Tabellen aktiv ist: Supabase-Dashboard,
  **Database** > **Publications** > `supabase_realtime`. Dort müssen `shares`
  und `friendships` angehakt sein. Falls nicht, die letzte Migration
  (`20260101000400_realtime.sql`) nochmal einspielen.

### YouTube hat sein DOM geändert

Das passiert. YouTube testet ständig neue Layouts, und dann greift ein Selektor
nicht mehr. Erkennbar an einer Warnung in der Konsole:

```
[vid2friend] no element matched "homeContents". YouTube probably changed its
DOM. See src/content/selectors.ts for how to fix this.
```

So reparierst du es selbst:

1. [`src/content/selectors.ts`](src/content/selectors.ts) öffnen. **Alle**
   Selektoren des Projekts stehen dort, es gibt keinen zweiten Ort.
2. Auf YouTube das Element, das nicht gefunden wird, mit Rechtsklick >
   **Untersuchen** öffnen.
3. Im Elements-Panel nach oben schauen, bis du ein Custom Element mit
   sprechendem Namen siehst (`ytd-rich-grid-renderer`, `yt-lockup-view-model`
   und so weiter). Tag-Namen und `id`s sind stabil, generierte Klassennamen
   nicht.
4. Den neuen Selektor **an den Anfang** des passenden Arrays schreiben. Die
   Arrays werden der Reihe nach durchprobiert, der erste Treffer gewinnt. Wenn
   der neue vorne steht, funktionieren die alten weiter als Fallback für alle,
   die noch das alte Layout sehen.
5. `npm run build`, Extension neu laden, YouTube mit F5 neu laden.

### "Extension context invalidated"

Erscheint, wenn du die Extension neu geladen hast, während ein YouTube-Tab noch
offen war. F5 auf dem Tab, weg ist es.

### npm install schlägt fehl

```
npm error Cannot read properties of null (reading 'edgesOut')
```

Bug in npm 10.9. Lösung: `npm install --legacy-peer-deps`.

---

## 10. GitHub

Falls das Repo noch nicht verbunden ist:

```bash
git branch -M main
git remote add origin https://github.com/DEIN-NAME/vid2friend.git
git push -u origin main
```

Die URL steht auf der Repo-Seite hinter dem grünen **Code**-Button, Tab HTTPS.
Beim ersten Push öffnet der Git Credential Manager ein Browser-Fenster zur
Anmeldung, danach merkt Windows sich das.

Wird der Push abgelehnt (`rejected ... fetch first`), hast du das Repo auf
GitHub mit README oder .gitignore angelegt. Dann einmal:

```bash
git pull --rebase origin main
```

und den Push wiederholen.

**Was nicht ins Repo gehört** und schon in `.gitignore` steht: `.env`,
`node_modules/`, `dist/`, `*.zip`. Der Supabase `service_role` Key gehört
nirgendwohin außer ins Dashboard.

### GitHub Actions

Zwei Workflows liegen bereit:

- [`.github/workflows/build.yml`](.github/workflows/build.yml) läuft bei jedem
  Push auf `main`: Install, Typecheck, Tests, Build. Prüft außerdem, dass
  `supabase/schema.sql` zu den Migrationen passt.
- [`.github/workflows/release.yml`](.github/workflows/release.yml) läuft bei
  einem Tag `v*`, baut die Extension und hängt das Zip an ein GitHub Release.

Für den Release-Workflow hinterlegst du deine Supabase-Werte einmalig im Repo:
**Settings** > **Secrets and variables** > **Actions** > Tab **Variables** >
**New repository variable**, einmal `VITE_SUPABASE_URL`, einmal
`VITE_SUPABASE_ANON_KEY`.

Ein Release erzeugst du so:

```bash
npm version patch
git push --follow-tags
```

---

## 11. Im Chrome Web Store veröffentlichen

### 11.1 Developer-Account

1. <https://chrome.google.com/webstore/devconsole> öffnen, mit dem Google-Konto
   anmelden, unter dem die Extension laufen soll.
2. Einmalig **5 US-Dollar** Registrierungsgebühr per Kreditkarte. Gilt für alle
   Extensions dieses Kontos, dauerhaft.

### 11.2 Zip bauen

```bash
npm run build
npm run zip
```

Ergebnis: `vid2friend-0.1.0.zip` im Projektordner.

Zwei Dinge, an denen Uploads regelmäßig scheitern und die das Skript für dich
erledigt: `manifest.json` liegt in der Wurzel des Zips, nicht in einem
Unterordner, und `node_modules` ist nicht drin.

**Vor dem Zip unbedingt prüfen**, dass die `.env` gefüllt war. Sonst steht im
Manifest `https://*.supabase.co/*` statt deiner konkreten Projekt-URL, und genau
danach fragt das Review. Kontrolle:

```bash
cat dist/manifest.json
```

Bei `host_permissions` muss deine Projekt-URL stehen.

### 11.3 Listing ausfüllen

Im Developer Dashboard **Add new item**, das Zip hochladen. Dann:

**Store listing**

| Feld | Was rein muss |
|---|---|
| Name | `vid2friend` (max. 75 Zeichen) |
| Kurzbeschreibung | Max. 132 Zeichen, z. B. `Send YouTube videos to friends. Their picks appear at the top of your YouTube homepage instead of getting lost in chat.` |
| Ausführliche Beschreibung | Was es macht, wie man es benutzt, dass ein Freund es ebenfalls installieren muss |
| Kategorie | `Social & Communication` |
| Sprache | English |

**Grafiken** (das ist der Teil, der am längsten dauert)

| Asset | Maße | Pflicht |
|---|---|---|
| Store-Icon | 128 × 128 PNG | ja, liegt als `public/icons/icon-128.png` bereit |
| Screenshots | 1280 × 800 oder 640 × 400 PNG, 1 bis 5 Stück | ja, mindestens einer |
| Kleines Promo-Kachelbild | 440 × 280 PNG | nein, aber empfohlen |
| Marquee-Promo | 1400 × 560 PNG | nein |

Für die Screenshots eignen sich: die Reihe auf der YouTube-Startseite, der
Share-Dialog, das Popup mit der Freundesliste.

**Privacy**

- **Single purpose description:** eine Erklärung, dass die Extension genau einen
  Zweck hat, nämlich YouTube-Videoempfehlungen zwischen Freunden zu übermitteln.
- **Permission justifications:** jede Berechtigung wird einzeln abgefragt. Diese
  Begründungen kannst du übernehmen:

| Berechtigung | Begründung für das Review |
|---|---|
| `storage` | Stores the user's login session and a cached copy of their current recommendations locally, so the recommendation row renders instantly on page load. |
| `alarms` | Runs a five minute background check for new recommendations, because MV3 service workers are terminated and cannot rely on a persistent websocket. |
| `https://*.youtube.com/*` | The extension's entire function is adding a recommendation row, a menu entry and a share button to YouTube pages, and reading the video title and channel from the page when the user shares a video. |
| Supabase-Projekt-URL | The extension's backend. Stores friendships and shared video ids so recommendations reach the recipient. |
| Remote code | **No**, the extension executes no remote code. Everything is bundled. |

- **Data usage:** ankreuzen, dass persönlich identifizierbare Informationen
  (nur der selbstgewählte Anzeigename) und Nutzeraktivität (die geteilten
  Video-IDs) erhoben werden. Die drei Zusicherungen unten (kein Verkauf, keine
  zweckfremde Nutzung, keine Bonitätsprüfung) alle bestätigen.
- **Privacy policy URL:** Der Store verlangt eine erreichbare URL. Nimm die
  gerenderte [`PRIVACY.md`](PRIVACY.md) aus deinem GitHub-Repo, also
  `https://github.com/DEIN-NAME/vid2friend/blob/main/PRIVACY.md`. Das wird
  akzeptiert.

### 11.4 Sichtbarkeit

Für den Test im Freundeskreis: unter **Visibility** die Option **Unlisted**
wählen. Die Extension ist dann über den direkten Link installierbar, taucht aber
nicht in der Suche auf. Später jederzeit auf **Public** umstellbar.

### 11.5 Review

**Submit for review**. Realistische Dauer:

- Unlisted, erste Einreichung: meist wenige Stunden bis 2 Tage.
- Public, erste Einreichung: 1 bis 3 Werktage, gelegentlich länger.
- Updates: oft unter 24 Stunden.

Was Verzögerung verursacht: breite Host-Permissions (deshalb Kapitel 11.2),
fehlende oder oberflächliche Permission-Begründungen, und eine Beschreibung, die
nicht zu den Berechtigungen passt.

---

## 12. Roadmap und bewusst weggelassen

**Was v1 nicht kann, mit Absicht:**

- **Keine Gruppen.** Teilen geht 1:1, an mehrere Freunde gleichzeitig, aber es
  gibt keine benannten Gruppen.
- **Keine Kommentare oder Reaktionen.** Es gibt eine Notiz beim Teilen, mehr
  nicht. Ein Chat gehört in einen Messenger.
- **Keine Push-Benachrichtigungen.** Nur das Badge am Extension-Icon. Eine
  Desktop-Benachrichtigung für jedes empfohlene Video wäre nach zwei Tagen
  ausgeschaltet.
- **Kein Firefox, kein Safari.** Der Content Script wäre portierbar, das
  Manifest und die Service-Worker-Logik nur teilweise.
- **Keine Sortierung der Reihe nach Interesse.** Round Robin nach Absender,
  fertig. Ein Ranking-Algorithmus ist genau das, was dieses Feature nicht sein
  will.
- **Kein E2E-Test-Framework.** Getestet wird die Logik, die es lohnt: der
  Slot-Algorithmus, mit Vitest.

**Sinnvolle nächste Schritte:**

1. **Shorts unterstützen.** Aktuell greift der Menüeintrag bei normalen Kacheln,
   die Shorts-Oberfläche hat ein eigenes DOM.
2. **Zeitstempel im Link.** "Schau ab Minute 4" als echter `&t=`-Parameter statt
   nur als Notiz.
3. **Wiedersehen-Liste.** Geschaute Empfehlungen bleiben in der Datenbank, aber
   das Popup zeigt sie nur beim Absender. Ein Archiv für den Empfänger wäre
   billig zu bauen.
4. **Selektor-Telemetrie.** Wenn ein Selektor nicht greift, merkt das aktuell
   nur der Nutzer in seiner Konsole. Ein anonymer Zähler wäre nützlich, kostet
   aber die Aussage "keinerlei Telemetrie" in der Privacy Policy.
5. **Mehrsprachigkeit** über `_locales`, falls die Extension über den
   Freundeskreis hinauswächst.

---

## Projektstruktur

```
vid2friend/
├─ src/
│  ├─ background/           Service Worker: Realtime, Badge, Polling, Messaging
│  ├─ content/              Alles, was auf youtube.com läuft
│  │  ├─ selectors.ts       ALLE DOM-Selektoren, zentral an einer Stelle
│  │  ├─ shelf.ts           Die Reihe auf der Startseite
│  │  ├─ menu-item.ts       Eintrag im Drei-Punkte-Menü
│  │  ├─ watch-button.ts    Button auf der Watch-Page
│  │  ├─ share-modal.ts     Teilen-Dialog (Shadow DOM)
│  │  ├─ watch-tracker.ts   Erkennung, wann etwas als geschaut gilt
│  │  └─ connect-prompt.ts  Der ?v2f=-Einladungslink
│  ├─ popup/                React-Popup mit vier Tabs
│  ├─ shared/               Supabase-Client, API, Typen, Slot-Logik, Storage
│  └─ styles/
├─ supabase/
│  ├─ migrations/           Schema, RLS, Funktionen, Realtime
│  ├─ schema.sql            Alle Migrationen in einer Datei (generiert)
│  ├─ verify.sql            Setup-Prüfung
│  ├─ tests/rls_test.sql    Sicherheitsregeln gegen drei Testnutzer
│  └─ seed.sql              Demodaten, nur für die lokale CLI
├─ public/icons/            16/32/48/128 px, generiert aus logo.svg
├─ .github/workflows/       CI und Release
├─ manifest.config.ts       Das Manifest, als TypeScript
├─ PRIVACY.md               Datenschutzerklärung für den Store
└─ CONTRIBUTING-NOTES.md    Entscheidungen, Kompromisse, bekannte Schwachstellen
```

Wenn dich interessiert, warum etwas so gebaut ist, wie es gebaut ist, steht das
in [CONTRIBUTING-NOTES.md](CONTRIBUTING-NOTES.md).
