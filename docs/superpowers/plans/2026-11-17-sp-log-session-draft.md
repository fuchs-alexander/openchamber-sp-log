# Session-Entwurf durch die geloggte Session: Umsetzungsplan

> **Für ausführende Agenten:** Pflicht-Unterskill: superpowers:subagent-driven-development. Schritte sind als Checkboxen geführt.

**Ziel:** Den Log-Entwurf schreibt der Agent der geloggten Session mit ihrem eigenen Modell. Aus seiner Zusammenfassung ist Git- und Deploy-Routine herausgefiltert. Ist die Session nicht erreichbar, entwirft das Small Model mit denselben Regeln.

**Architektur:** Ein neuer Dienst der Erweiterung (`dist/service/main.js`, Node, Loopback) nutzt `createServiceHost` → `sessions.send`, `sessions.status` und `sessions.lastReply`. Der Dialog spricht ihn per `host.serviceRequest` an und fragt den Stand regelmäßig ab.

**Tech-Stack:** wie bisher. Der Dienst wird mit `bunx openchamber-guest-bundle --node` gebündelt.

**Spezifikation:** `docs/superpowers/specs/2026-11-17-sp-log-design.md`, Abschnitt „Nachtrag 2026-11-17“

## Globale Vorgaben

- Alle bisherigen Vorgaben aus `docs/superpowers/plans/2026-11-17-sp-log.md` gelten weiter.
- **`host.serviceRequest`:**
  - `body` ist ein JSON-String.
  - Die Antwort `body` wird defensiv geparst.
  - Jeder einzelne Aufruf muss deutlich unter 20 s bleiben.
- **Dienst:**
  - nur `node:`-Module plus das gebündelte `@openchamber/sdk`
  - lauscht auf `127.0.0.1:$OPENCHAMBER_SERVICE_PORT`
  - prüft jeden Request auf `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`
- **Keine Tokens oder Session-Inhalte** in Logs.
- Die `version` steigt auf `0.2.0`.

## Prüfschwerpunkte

1. **Die Session war schon vorher fertig:** Die alte `lastReply` darf nicht als Antwort gelten. Geprüft wird über die `logId` (Task 7, Test `service: ignores old reply`).
2. **Die Session ist beschäftigt:** Der Status bleibt `pending` mit `sessionStatus:'busy'`, ohne Fehler (Task 7).
3. **Der Agent hängt Text an das JSON oder setzt es in Codefences:** Der Parser nimmt das JSON-Objekt mit passender `logId` (Task 6, Test `parseSessionDraft: fenced`).
4. **Dienst fehlt oder Berechtigung nicht erteilt** (`NO_SERVICE`/`NOT_GRANTED`): sofort Rückfall auf das Small Model mit Hinweis (Task 8, Test `flow: falls back without service`).
5. **Dialog geschlossen, bevor die Antwort da ist:** Es bleibt kein Dienstzustand hängen, der einen späteren Log blockiert. Der Dienst hält ausstehende Anfragen höchstens 15 Minuten (Task 7).

---

### Task 6: Geschärfte Prompts und Session-Entwurf

**Dateien:** Ändern `src/log/draft.ts`. Erstellen `src/log/session-draft.ts`, `test/session-draft.test.ts`. Tests in `test/log.test.ts` erweitern.

**Schnittstellen:**
- Liefert:
  - `WORK_RULES: string`: gemeinsames Regelwerk für Session- und Small-Model-Prompt.
  - `DRAFT_SYSTEM_PROMPT` bindet `WORK_RULES` ein.
  - `buildSessionDraftPrompt(logId: string): string`: die Nachricht an die Session.
  - `parseSessionDraft(text: string, logId: string): Draft | null`: `null`, wenn kein JSON mit dieser `logId` vorkommt. Sonst gelten dieselben Prüfungen wie bei `parseDraft`.
- `WORK_RULES` enthält wörtlich die Regeln aus dem Spezifikations-Nachtrag (Abschnitt „Session-Prompt“). Dazu kommen die bisherigen Richtwerte für die Stunden und die Formulierung „Aufwand eines erfahrenen Entwicklers ohne KI“.
- `buildSessionDraftPrompt` beginnt mit `[SP-Log-Anfrage <logId>]` und enthält:
  - die Aufforderung, nur Arbeit seit der letzten `[SP-Log-Anfrage …]` in dieser Session zu berücksichtigen
  - „Verwende keine Tools.“
  - das JSON-Format `{"logId":"<logId>","title":…,"summary":…,"hours":…}`

- [ ] **Schritt 1: Fehlschlagende Tests schreiben:**
  - `WORK_RULES` nennt Pull, Fast-Forward, Merge, Push, Commit, Neustarts und „per Pull hereingekommene Änderungen anderer“ als Nicht-Arbeit.
  - `DRAFT_SYSTEM_PROMPT` enthält `WORK_RULES`.
  - `buildSessionDraftPrompt("L1")` beginnt mit `[SP-Log-Anfrage L1]` und enthält `"logId":"L1"` sowie „Verwende keine Tools“.
  - `parseSessionDraft: plain`: richtig mit passender `logId`.
  - `parseSessionDraft: fenced`: JSON in Codefences mit Text davor.
  - `parseSessionDraft: wrong logId`: ergibt `null`.
  - `parseSessionDraft: invalid hours`: ergibt einen Draft mit `hours: null`.
- [ ] **Schritt 2:** Tests rot. **Schritt 3:** implementieren. **Schritt 4:** `bun run check` grün.
- [ ] **Schritt 5:** Commit `feat: sharpen work log rules and add session draft prompt`.

### Task 7: Dienst für den Session-Entwurf

**Dateien:** Erstellen `src/service/drafts.ts` (reine Logik), `src/service/main.ts` (HTTP-Adapter + `createServiceHost`), `test/service.test.ts`. Ändern `scripts/build.ts`, damit auch `src/service/main.ts` nach `dist/service/main.js` gebündelt wird (`--node`).

**Schnittstellen:**
- `createDrafts(deps: { sessions: { send(id: string, prompt: string): Promise<unknown>; status(id: string): Promise<'idle'|'busy'|'waiting'|string>; lastReply(id: string): Promise<string | null> }; now: () => number })` liefert:
  - `start({sessionId, logId, prompt}): Promise<void>`: Sie merkt sich die vorherige `lastReply` und den Zeitpunkt, dann folgt `send`.
  - `poll({sessionId, logId}): Promise<{state:'pending'|'done'|'failed', text?: string, sessionStatus: string}>`:
    - `done`, sobald `lastReply` die `logId` enthält und sich von der gemerkten Antwort unterscheidet.
    - `failed`, wenn die Session dreimal hintereinander `idle` ist und keine Antwort mit `logId` vorliegt, oder bei unbekannter `logId`.
  - Einträge, die älter als 15 Minuten sind, verfallen.
- `ServiceSessionReply` aus `@openchamber/sdk` ist eventuell ein Objekt und kein String. Exakte Typen stehen in `node_modules/@openchamber/sdk/dist/service-host.d.ts`. Der Text wird dann aus dem passenden Feld gelesen.
- **HTTP:**
  - `POST /draft` mit dem Body `{sessionId, logId, prompt}`, Antwort `{started:true}`
  - `GET /draft?sessionId=…&logId=…` liefert das Ergebnis von `poll`
  - Prüfungen:
    - Bearer-Token fehlt oder ist falsch → 401
    - `sessionId` oder `logId` passen nicht zu `/^[A-Za-z0-9_-]{1,128}$/` → 400
    - `prompt` ist länger als 8000 Zeichen → 400
    - Fehler aus `ServiceHostError` → 502 `{error: code}`

- [ ] **Schritt 1: Fehlschlagende Tests** mit einem Fake für `sessions`:
  - `service: start sends prompt`: Der Prompt geht genau einmal an die `sessionId`.
  - `service: ignores old reply`: Die alte Antwort enthält zufällig dieselbe `logId` nicht, die Session ist `idle`, also `pending`. Erst eine neue Antwort mit `logId` ergibt `done`.
  - `service: busy stays pending`: ergibt `pending` mit `sessionStatus:'busy'`.
  - `service: fails after idle without reply`: Nach dreimal `idle` ohne Treffer kommt `failed`.
  - `service: unknown logId`: ergibt `failed`.
  - `service: expiry`: Nach 15 Minuten ist der Eintrag weg.
  - `service: http auth/validation`: deckt 401, 400 und 200 über den Adapter ab. Dafür wird der Handler (`(req: Request) => Promise<Response>`) separat exportiert.
- [ ] **Schritt 2:** Tests rot. **Schritt 3:** implementieren. **Schritt 4:** `bun run check` grün, und `dist/service/main.js` existiert.
- [ ] **Schritt 5:** Commit `feat: add session draft service`.

### Task 8: Dialog nutzt den Session-Entwurf, Manifest, Version

**Dateien:** Ändern `src/panel/api.ts` (bzw. neu `src/panel/drafts-client.ts`), `src/panel/flow.ts`, `src/panel/main.ts`, `package.json`, `test/flow.test.ts`. Build `dist/`.

**Manifest-Ergänzung** in `openchamber.contributes`:

```json
"service": { "entry": "dist/service/main.js", "runtime": "host" },
"sessionControl": { "content": true }
```

Die Form für `sessionControl` steht in `node_modules/@openchamber/sdk`, Manifest-Typen bzw. Schema. Falls sie dort abweicht, gilt das Schema. `engines.openchamber` ist `>=2.7.0` und deckt das ab (der Host muss neuer als 2.6.1 sein). Die `version` steigt auf `0.2.0`.

**Ablauf in `flow.start`:**
- Der Entwurf wird zuerst über den Dienst angefordert:
  - `logId` per `crypto.randomUUID()` (über `deps`, damit Tests ihn festlegen können)
  - `POST /draft` mit `buildSessionDraftPrompt(logId)`
  - dann alle 2 s `GET /draft`, höchstens 10 Minuten lang. Den Takt liefern `deps.sleep` und `deps.now`.
- `state.message` während des Wartens:
  - „Session erstellt Entwurf …“
  - bei `busy`: „Wartet, bis die Session frei ist …“
- `done` → `parseSessionDraft`. Kommt `null`, folgt der Rückfall.
- **Rückfall** auf `generate` mit `buildDraftRequest`:
  - Auslöser: `failed`, Zeitablauf, ein Dienstfehler (`NO_SERVICE`, `NOT_GRANTED`, `SERVICE_FAILED`, `REQUEST_FAILED`, HTTP ≥ 400) oder ein ungültiger Entwurf.
  - Dazu der Hinweis „Session-Entwurf nicht verfügbar – Entwurf vom Small Model.“
- Der Abgleich mit SP-Aufgaben und `save` bleiben unverändert.
- Ein `start`-Neulauf verwirft laufende Abfragen (der bestehende Run-ID-Schutz).
- „Abbrechen“ beendet die Abfragen.

- [ ] **Schritt 1: Fehlschlagende Tests** in `test/flow.test.ts`:
  - `flow: uses session draft`: Der Dienst liefert erst `pending`, dann `done` mit JSON. Der Entwurf kommt aus der Session, `generate` wird nur für den Abgleich aufgerufen.
  - `flow: falls back without service`: `serviceRequest` wirft `NO_SERVICE`. `generate` erzeugt den Entwurf, und `message` enthält den Hinweis.
  - `flow: falls back on timeout`: Mit `now`, das voranschreitet, und dauerhaft `pending` folgt nach 10 Minuten der Rückfall.
  - `flow: busy message`: Bei `sessionStatus:'busy'` steht in `message` „Wartet, bis die Session frei ist“.
  - `flow: restart cancels polling`: Ein zweites `start` beendet die Abfragen des ersten Laufs.
- [ ] **Schritt 2:** Tests rot. **Schritt 3:** implementieren. Für den Test reicht es, `HostLike` um `serviceRequest` zu erweitern.
- [ ] **Schritt 4:** `bun run check` grün, inklusive `openchamber-guest-check`.
- [ ] **Schritt 5:** Commit `feat: draft work logs in the logged session` mit `dist/`.
- [ ] **Schritt 6:** `git push origin main`. Der Nutzer hat den Remote freigegeben; ein Update braucht die neue Version im Repo.
