# Notizen an dich

Entscheidungen, Abweichungen von der Spec und Stellen, die ich für brüchig
halte. Wenn du in drei Monaten wissen willst, warum etwas so gebaut ist: hier.

---

## Die drei wichtigsten Abweichungen von der Spec

### 1. `profiles.id` ist nicht `auth.uid()`

Die Spec wollte beides: `profiles.id = auth.uid()` **und** einen Backup-Code,
mit dem der Account auf einen anderen Rechner umzieht. Das geht nicht zusammen.
Auf einem zweiten Rechner erzeugt die anonyme Anmeldung eine neue `auth.uid()`,
und die kann man nicht auf die bestehende Zeile umbiegen: `profiles.id` hinge
per Foreign Key an `auth.users` und würde von `friendships` und `shares`
referenziert.

Gebaut ist es deshalb so: `profiles.id` ist eine eigene UUID, dazu gibt es eine
Spalte `auth_uid` mit einem Unique-Constraint auf `auth.users`. Der Backup-Code
ist ein `recovery_token`, und `claim_profile(token)` tauscht **nur** `auth_uid`
aus. Alle Fremdschlüssel bleiben unangetastet.

Der Preis ist eine Indirektionsebene: jede RLS-Policy geht über
`current_profile_id()` statt direkt über `auth.uid()`. Dafür funktioniert
Account-Recovery wirklich, statt nur ungefähr.

### 2. Der Recovery-Token steht in einer eigenen Tabelle

RLS ist zeilenbasiert, nicht spaltenbasiert. Stünde der Token auf `profiles`,
würde jede Policy, die einem Freund das Lesen deines Profils erlaubt, ihm auch
deinen Account aushändigen. Deshalb `profile_secrets` mit einer eigenen,
strengeren Policy.

Das ist der Punkt, an dem ich beim Schreiben am längsten gestockt habe, und der,
den ich in einem Review als Erstes prüfen würde.

### 3. `profiles` ist nicht für alle lesbar

Die Spec sagte: "jeder authentifizierte Nutzer darf `profiles` lesen, nötig um
Freunde zu finden". Das erlaubt aber, die komplette Nutzerliste samt aller
Freundescodes auszulesen, und der Anon Key liegt offen in der Extension.

Stattdessen: lesbar ist nur das eigene Profil und die Profile von Leuten, mit
denen eine Freundschaftszeile existiert. Das Nachschlagen per Code läuft über
`find_profile_by_code()`, die als SECURITY DEFINER genau drei Felder
zurückgibt und nichts sonst.

---

## Weitere Entscheidungen

**Der Menüeintrag hängt hinten, nicht an Position sieben.** Die Spec wollte ihn
als siebten Eintrag unter "Melden". Die Anzahl der Einträge im
Drei-Punkte-Menü schwankt aber je nach Login-Status, Kacheltyp und A/B-Test.
Optisch ist "letzter Eintrag" dasselbe, nur ohne die Annahme, dass es genau
sechs andere gibt.

**Der Content Script hat keinen Supabase-Client.** Alles läuft über
`chrome.runtime`-Messaging zum Service Worker. Zwei Gründe: rund 60 kB
Client-Bibliothek weniger auf jedem YouTube-Seitenaufbau, und genau eine Stelle,
die den Auth-Token erneuert, egal wie viele Tabs offen sind.

**Das Popup hat einen eigenen Client.** Es ist eine normale Extension-Seite mit
DOM und lebt nur, solange es offen ist. Jeden Lesezugriff über Messaging zu
schicken wäre ein zusätzlicher Hop ohne Gegenwert. Popup und Service Worker
teilen sich die Session über `chrome.storage.local`; supabase-js koordiniert das
Token-Refresh über die Web Locks API, die es in beiden Kontexten gibt.

**Shelf ohne Shadow DOM, Modal mit.** Die Reihe soll YouTubes Schriftart und
Theme-Variablen erben, damit sie nicht wie ein Fremdkörper aussieht, also
striktes Klassen-Prefix `v2f-` statt Isolation. Der Dialog will das Gegenteil,
weil YouTubes globale Styles für Buttons und Inputs sonst dagegenhalten.

**Dark Mode über YouTubes eigene CSS-Variablen.** `--yt-spec-text-primary` und
Verwandte, jeweils mit literalem Fallback. YouTube tauscht sie aus, wenn es
`dark` auf `<html>` setzt, wir folgen automatisch. Deutlich robuster, als selbst
auf das Attribut zu reagieren.

**Kein `tabs`-Permission.** Für den Broadcast an offene YouTube-Tabs fragen wir
alle Tabs ab und behalten die, deren URL wir überhaupt sehen dürfen. Das sind
dank `host_permissions` genau die YouTube-Tabs. Spart eine Berechtigung, die im
Store-Review sonst begründet werden müsste.

**Expiry lazy statt per Cron.** `pg_cron` ist auf dem Supabase-Free-Tier nicht
garantiert verfügbar. Abgelaufene Einträge werden deshalb in
`recalculate_slots()` mit erledigt. Nachteil: eine Warteschlange läuft erst ab,
wenn sie das nächste Mal angefasst wird. Genau dann fällt es aber auch auf.

**Alle Share-Mutationen laufen über RPCs.** Auf `shares` gibt es überhaupt kein
UPDATE-Grant. "Nur der Absender darf `sender_priority` ändern, nur der
Empfänger den `status`" steht damit als lesbarer Code in vier kleinen
Funktionen, statt als Matrix aus Spalten-Grants und Policies.

**Icons werden generiert, aber committet.** `npm run icons` rendert
`public/icons/logo.svg` über sharp. Die PNGs liegen im Repo, damit
`npm install && npm run build` auch dort funktioniert, wo sharp seine
Plattform-Binary nicht laden kann.

**Kein Tailwind.** Das Popup ist 380px breit. Eine CSS-Datei mit Variablen ist
hier kleiner und schneller, und im Content Script wäre ein globaler Reset auf
YouTube eine schlechte Idee.

---

## Was ich für brüchig halte

**Der Bezug vom offenen Menü zur Videokachel.** YouTube benutzt einen einzigen
`ytd-menu-popup-renderer` für alle Menüs und befüllt ihn neu. Wenn das Menü
offen ist, führt kein Weg mehr zurück zur Kachel. Meine Lösung: beim `mousedown`
auf den Drei-Punkte-Button in der Capture-Phase merken, zu welcher Kachel er
gehört. Das funktioniert zuverlässig, hängt aber daran, dass der Klick über ein
`ytd-menu-renderer` läuft. Wenn hier etwas kaputt geht, ist es das.

**Das Schließen des YouTube-Menüs nach dem Klick.** Ich rufe `close()` auf dem
`tp-yt-iron-dropdown` auf, das ist eine Polymer-interne Methode. Fallback ist
ein Escape-Keydown. Beides kann YouTube jederzeit ändern; im schlimmsten Fall
bleibt das Menü offen, während der Dialog aufgeht. Unschön, nicht kaputt.

**Die Einfügestelle der Reihe.** Sie geht vor das erste Kind von
`#contents` in `ytd-browse[page-subtype="home"]`. Wenn YouTube dort einen
Container mehr einzieht, landet die Reihe an der falschen Stelle statt gar
nicht, und dann meldet auch keine Warnung etwas. Das ist der Fehlerfall, der am
schwersten zu bemerken ist.

**Der `?v2f=`-Parameter.** YouTube könnte unbekannte Query-Parameter irgendwann
entfernen. Als Absicherung wird `#v2f=CODE` genauso akzeptiert; Fragmente werden
nicht einmal an den Server geschickt.

**Realtime im MV3-Service-Worker.** Die Websocket-Verbindung stirbt mit dem
Worker, also nach ungefähr 30 Sekunden Untätigkeit. Der Fünf-Minuten-Alarm ist
die eigentliche Garantie, Realtime ist nur die Beschleunigung, solange der
Worker zufällig lebt. Realistisch heißt das: eine Empfehlung ist spätestens nach
fünf Minuten da, oft sofort.

**`chrome.action.openPopup()`** existiert erst ab Chrome 127 und funktioniert
nicht in jedem Kontext. Der "See all"-Button in der Reihe fängt das ab und
zeigt dann einen Hinweis auf das Toolbar-Icon.

---

## Stolpersteine beim Aufsetzen

**`npm install` crasht mit `edgesOut`.** npm 10.9 verschluckt sich an den
optionalen Peer-Dependencies von Vitest 4 (`@vitest/browser` zu `webdriverio`).
Ein npm-Bug, kein Projektproblem. `--legacy-peer-deps` löst es, steht im README.

**Vitest 4 will Node ^20 / ^22 / >=24.** Auf Node 23.9 gibt npm eine
`EBADENGINE`-Warnung aus, Vitest läuft aber. Node 24 LTS beseitigt die Warnung.

**Supabase-Query-Builder sind keine Promises.** Sie sind Thenables, die den
Request erst beim `await` abschicken. `withTimeout()` nimmt deshalb
`PromiseLike<T>`; mit `Promise<T>` bräuchte jeder Aufruf ein `.then()` und würde
die Anfrage doppelt so oft starten.

---

## Wo Tests sind und wo nicht

`src/shared/slots.test.ts` deckt den Slot-Algorithmus ab: leerer Zustand, ein
Absender mit zehn Videos, drei Absender im Round Robin, Prioritätsänderung,
Nachrücken nach dem Schauen, Stabilität bei einem neuen Absender, Idempotenz,
kleinere Slot-Zahl. Das ist die einzige Stelle mit echter Logik.

`supabase/tests/rls_test.sql` prüft die Sicherheitsregeln gegen drei
Testnutzer und endet auf `ROLLBACK`, ist also auch gegen die produktive
Datenbank gefahrlos.

Bewusst ungetestet: die DOM-Injektion. Ein Test dagegen würde YouTubes DOM
einfrieren und damit genau das prüfen, was sich als Einziges ändert.
