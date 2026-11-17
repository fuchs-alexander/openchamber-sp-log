# Ordner, Sortierung, Work Status und Seitenleiste: Umsetzungsplan

> **Für ausführende Agenten:** Pflicht-Unterskill: superpowers:subagent-driven-development.

**Ziel:** Version 0.3.0 gemäß Spezifikation, Abschnitt „Nachtrag 2“.

**Architektur:**
- Der Gateway liefert die Ordner aus dem SP-Backup.
- Der Dialog gruppiert und sortiert die Projekte und erweitert die Bindung.
- Ein neuer Work-Status-Frame liest die Bindung.
- Der Dienst führt den Zustand pro Session und setzt Markierungen in der Seitenleiste.

**Spezifikation:** `docs/superpowers/specs/2026-11-17-sp-log-design.md`, „Nachtrag 2“

## Globale Vorgaben

- Es gelten alle bisherigen Vorgaben: keine Laufzeitabhängigkeiten, IIFE-Frames, JSON-String-Bodies, keine Tokens oder Session-Inhalte in Logs, deutsche UI, 360 px.
- **Gateway:** bleibt Node-type-stripping-tauglich und nutzt nur `node:`-Module.
- **SDK-Verträge:** maßgeblich sind `node_modules/@openchamber/sdk/API.md` und `GUEST_SERVICES.md`, Abschnitte Work Status, Marks, Session Events und `keepRunning`. Dazu kommt das Manifest-Schema in `dist/`.
- **Version und Prüfung:** Version `0.3.0`; `bun run check` grün, einschließlich `openchamber-guest-check`.

## Prüfschwerpunkte

1. **Kaputtes oder fehlendes SP-Backup:** `/projects` liefert trotzdem 200 mit `folder:null` (Task 9).
2. **Verschachtelte Ordner:** Der Pfad lautet `A / B` (Task 9).
3. **Der Turn der SP-Log-Anfrage:** Er darf nach dem Speichern nicht „neue Arbeit“ auslösen (Task 11).
4. **Dienst-Neustart:** Die Markierungen werden aus dem gespeicherten Zustand wiederhergestellt (Task 11).
5. **Alte Bindungen ohne `logs`/`taskTitle`:** Der Work Status zeigt trotzdem sinnvolle Werte (Task 10).

---

### Task 9: Gateway liefert Ordner

**Dateien:** Ändern `gateway/gateway.ts` und `gateway/server.ts`, Erstellen `gateway/folders.ts`, Tests in `test/gateway.test.ts` bzw. `test/folders.test.ts`.

- `folderIndex(menuTree: unknown): Map<projectId, folderPath>`:
  - Knoten `{k:'f', name, children}` sind Ordner, Knoten `{k:'p', id}` sind Projekte.
  - Verschachtelte Pfade werden mit ` / ` verbunden.
  - Ungültige Strukturen ergeben eine leere Map.
- `createGateway` bekommt die Option `folders?: () => Promise<Map<string,string>>`. `/projects` liefert damit `[{id,title,folder}]`, mit `folder` als `string|null`.
- `server.ts`:
  - Liest `SP_BACKUP_DIR` (Standard `~/.config/superProductivity/backups`).
  - Nimmt die neueste `*.json` nach mtime, parst nur bei geänderter mtime neu und nutzt `menuTree.projectTree`.
  - Bei jedem Fehler entsteht eine leere Map, ohne Absturz und ohne Inhalte im Log.
- **Tests:** flacher und verschachtelter Ordner, Projekt ohne Ordner, Müll-Eingabe ergibt eine leere Map, `/projects` mit `folder`, wirft `folders` → `folder:null` bei Status 200.
- **Deploy:**
  - `gateway/*.ts` nach `dell-pro-max:~/.local/opt/sp-gateway/` kopieren und `systemctl --user restart sp-gateway`.
  - Prüfen: Auf dem Dell liefert `GET http://127.0.0.1:3877/projects`, mit dem Token aus der Datei (nie ausgeben), Projekte mit `folder` „Posylka“, „Nomobo“, „Möbel“.
- **Commit:** `feat: expose Super Productivity folders from backups`

### Task 10: Dialog-Gruppierung, erweiterte Bindung, Work-Status-Frame

**Dateien:** Ändern `src/panel/api.ts` (`SpProject` + `folder`), `src/panel/store.ts` (Binding + `taskTitle`, `projectTitle`, `logs`), `src/panel/flow.ts` (Save schreibt die neuen Felder und hängt an `logs` an), `src/panel/main.ts` (`<optgroup>`). Erstellen `src/panel/projects.ts` (`groupProjects`), `src/status/main.ts`, `src/status/index.html`. Ändern `scripts/build.ts`. Tests.

- `groupProjects(projects): { ungrouped: SpProject[]; groups: {folder: string; projects: SpProject[]}[] }`:
  - Sortierung alphabetisch mit `localeCompare(…, 'de', {sensitivity:'base'})`.
  - Ordner und Projekte innerhalb der Ordner sind sortiert. Projekte ohne Ordner stehen in `ungrouped`.
- **Status-Frame:**
  - `connectHost`, `applyHostReady`, aktuelle Session aus `onSession`/`ready.session`.
  - Liest die Bindung über `createStore` und zeigt sie gemäß Spezifikation, mit `setHeight` passend.
  - Reagiert auf einen Session-Wechsel.
  - Keine Netzwerkaufrufe.
- **Manifest:** `statusSection: { entry: 'dist/status/index.html', title: 'SP Log', height: 120 }`.
- **Tests:**
  - `groupProjects` mit Umlauten und gemischter Groß-/Kleinschreibung
  - Save hängt `logs` an und setzt `taskTitle`/`projectTitle`
  - Status-Formatierung als reine Funktion `describeBinding(binding|null, now)` → Zeilen, inklusive alter Bindung ohne `logs`
- **Commit:** `feat: group projects by folder and add SP Log work status`

### Task 11: Dienst setzt Markierungen in der Seitenleiste

**Dateien:** Erstellen `src/service/marks.ts` (reine Zustandslogik), Erweitern `src/service/main.ts`, Ändern `src/panel/flow.ts` (nach erfolgreichem Save `serviceRequest POST /logged`; Fehler sind nicht fatal) und `package.json` (Manifest + Version 0.3.0). Tests.

- **Zustand pro Session:** `{ loggedAt: number|null, logs: number, hours: number, lastTurnAt: number|null, pendingLogId: string|null }`.
- **Ableitung des Markierungs-Zustands:**
  - **Nichts:** kein `lastTurnAt` und nicht geloggt → keine Markierung.
  - **Grau:** nie geloggt, aber `lastTurnAt` gesetzt → `{icon:'time-line', tone:'muted', text:'SP: noch nicht geloggt'}`.
  - **Grün:** geloggt und `lastTurnAt <= loggedAt` → `{icon:'checkbox-circle-line', tone:'success', text:'SP: N Logs · ≈ X h'}`.
  - **Orange:** geloggt und `lastTurnAt > loggedAt` → `{icon:'time-line', tone:'warning', text:'SP: neue Arbeit seit Log am TT.MM.'}`.
  - Erlaubte Tones und Icons laut SDK prüfen und bei Abweichung anpassen.
- **Der Turn der SP-Log-Anfrage zählt nicht als neue Arbeit:**
  - `POST /draft` merkt sich `pendingLogId`.
  - `POST /logged {sessionId, at, hours}` setzt `loggedAt = max(at, lastTurnAt)` und löscht `pendingLogId`.
- **`POST /session-events`** (Vertrag laut `GUEST_SERVICES.md`): Bei `turn-finished` wird `lastTurnAt = now` gesetzt und die Markierung aktualisiert.
- **Persistenz:** JSON in `OPENCHAMBER_SERVICE_DATA_DIR/state.json`, atomar geschrieben. Beim Start werden alle Markierungen erneut gesetzt, mit Ratenbegrenzung (höchstens 60 pro Minute, SDK-Limit).
- **Manifest:**
  - `service.keepRunning: true`, `marks: true`, `sessionEvents: { events: ['turn-finished'] }`
  - Die genaue Form steht im SDK-Schema.
- **Tests:**
  - Zustandsübergänge: grau → grün → orange → grün
  - Ein Log-Anfrage-Turn vor dem Save bleibt grün
  - Neustart setzt die Markierungen erneut
  - Ungültiges Event wird mit 400 abgelehnt
- **Commit:** `feat: mark logged and unlogged sessions in the sidebar`
- **Abschluss:** `bun run check` grün.
