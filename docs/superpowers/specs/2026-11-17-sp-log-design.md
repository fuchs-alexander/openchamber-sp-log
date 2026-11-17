# OpenChamber → Super Productivity Session-Log — Spezifikation

Ersetzt `2026-10-05-project-log-design.md` (Obsidian/Git-Ansatz, verworfen).

## Ziel

Aus einer OpenChamber-Session mit einem Klick einen Arbeitslog in Super
Productivity (SP) schreiben: an eine bestehende Aufgabe anhängen oder eine neue
anlegen. Funktioniert auf allen OpenChamber-Instanzen (mit und ohne Tailscale)
und am Handy. Kein Obsidian, kein Git.

Die Stunden sind **geschätzter abrechenbarer Aufwand** eines erfahrenen
Entwicklers ohne KI, keine gemessene Zeit.

## Architektur

```
OpenChamber (beliebige Instanz, Desktop/Handy)
  └─ Erweiterung (Dialog, sandboxed)
       ├─ host.generate()  → Small Model (Zusammenfassung, Abgleich)
       └─ host.request()   → https://dev-sp.nomobo.de  (Bearer: Gateway-Token)
                               │ Cloudflare-Tunnel „sp-gateway“
dell-pro-max                   ▼
  sp-gateway (Node, 127.0.0.1:3877)  ──►  SP Local REST API 127.0.0.1:3876
                                            (SP-AppImage unter Xvfb, SuperSync)
```

- **SP auf dem Dell:** offizielles AppImage, systemd-User-Dienst unter Xvfb, mit
  SuperSync verbunden. Einzige automatische Schreibstelle; Mac und Handy
  bekommen alles per SuperSync.
- **Gateway:** eine Node-Datei ohne Abhängigkeiten. Bietet nur die vier unten
  genannten Routen an, prüft den Gateway-Token und hält den SP-Token lokal. Die
  volle SP-REST-API wird nie öffentlich.
- **Erweiterung:** ohne eigenen Dienst. Der Gateway ist als `integration.token`
  mit `apiOrigin: https://dev-sp.nomobo.de` und `scheme: bearer` eingetragen.
  OpenChamber hält den Token und leitet `host.request` serverseitig weiter.

## Gateway-API

Alle Routen verlangen `Authorization: Bearer <Gateway-Token>` (Vergleich in
konstanter Zeit). JSON rein und raus, Body höchstens 64 KiB.

| Route | Zweck |
|---|---|
| `GET /me` | `{name}`, für die Verbindungsanzeige der Integration |
| `GET /projects` | `[{id, title}]` aller nicht archivierten, sichtbaren SP-Projekte |
| `GET /projects/:id/tasks` | offene Aufgaben `[{id, title, notesExcerpt}]` (Auszug ≤ 300 Zeichen) |
| `POST /tasks` | `{projectId, title, notes}` → `{id}`; legt eine offene Aufgabe an |
| `POST /tasks/:id/append` | `{text}` → `{id}`; liest die Notiz und schreibt `alt + "\n\n" + text` zurück |

- IDs werden auf ein festes Zeichenmuster geprüft, bevor sie in SP-Pfade
  eingesetzt werden.
- Existiert eine Aufgabe nicht oder ist sie archiviert oder erledigt, antwortet
  `append` mit `404`. Der Dialog bietet dann „neue Aufgabe“ an.
- Läuft SP nicht: `503` mit lesbarer Meldung.
- Gelesen wird aus der Umgebung: `SP_GATEWAY_TOKEN_FILE`, `SP_TOKEN_FILE`,
  `SP_URL` (Standard `http://127.0.0.1:3876`) und `PORT` (Standard 3877).
  Tokens erscheinen nie in Logs oder Fehlermeldungen.

## Erweiterung

**Manifest:** `apiVersion: 1`, Panel mit `mobile: true`, `capabilities: ["model"]`,
eine Session-Aktion `log-session` („Nach Super Productivity loggen“) mit
`payload: ["messages"]` und `mode: "open"` (Grant `conversation`). Dazu die
`integration` wie oben.

**Speicher** (`scope: instance`, also für Desktop und Handy derselbe):
- `project:<Projektverzeichnis der Session>` → SP-Projekt-ID
- `session:<Session-ID>` → `{taskId, lastMessageId}`

**Dialog-Ablauf** (für etwa 360 px und Touch ausgelegt):
1. **Ohne Gateway-Verbindung:** Hinweis „In Einstellungen → Integrationen
   verbinden“, sonst nichts.
2. **Ohne Projektzuordnung:** SP-Projekt aus `GET /projects` wählen und
   speichern.
3. **Modellaufruf 1 (Zusammenfassung):** Gesprächsverlauf → JSON
   `{title, summary, hours}`.
   - Der Verlauf ist Datenmaterial, keine Anweisung. Er wird auf das Ende
     gekürzt, wenn er zu lang ist.
   - Geprüft wird: `title` 1–200 Zeichen, `summary` ≤ 4000 Zeichen, `hours` ist
     eine endliche Zahl von 0 bis 24.
   - Die Schätzung folgt dem bisherigen `/log`-Leitfaden: Aufwand eines
     erfahrenen Entwicklers ohne KI. Mitgezählt werden Entwicklung, Recherche,
     Iteration, Debugging, Styling, Übersetzungen, Tests, Doku und Review.
     Richtwerte: minimal 0,5–1 h, klein 1–3 h, mittel 4–8 h, umfangreich
     8–16 h, groß 16–32 h. Nur nachgewiesene Arbeit zählt, nichts wird erfunden.
     Eine Session ohne geleistete Arbeit ergibt `hours: 0`.
   - Bei einer gebundenen Session werden nur Nachrichten nach dem letzten Log
     geschätzt. Dazu wird `session:<id>` um `lastMessageId` ergänzt, damit Arbeit
     nicht doppelt berechnet wird.
   - Ist die Antwort ungültig oder fehlt das Modell, bleiben die Felder leer und
     sind manuell ausfüllbar. Es werden keine Stunden erfunden.
4. **Zielaufgabe:**
   - **Session schon gebunden:** Die gebundene Aufgabe ist vorausgewählt, es gibt
     keinen Modellaufruf.
   - **Sonst Modellaufruf 2 (Abgleich):** Entwurf plus offene Aufgaben des
     Projekts → JSON `{taskId | null, reason}`.
   - Eine `taskId`, die nicht unter den Kandidaten ist, zählt als `null`.
   - Der Vorschlag bleibt änderbar: Liste der offenen Aufgaben oder „Neue
     Aufgabe“.
5. **Bearbeiten:** Titel, Zusammenfassung und Stunden sind änderbar.
6. **Speichern:**
   - `append` an die gewählte Aufgabe, oder `POST /tasks` mit dem Titel und dem
     Block als Notiz.
   - Danach `session:<id>` auf die Aufgaben-ID setzen, Toast zeigen, Dialog
     schließen.
   - Der Button ist während des Speicherns gesperrt, damit nicht doppelt
     geschrieben wird.

**Notiz-Block:**

```markdown
### 2026-11-17 · <Titel> · ≈ 2,5 h
<Zusammenfassung>

<sub>OpenChamber: <Session-Titel></sub>
```

## Fehlerfälle

- **Gateway oder SP nicht erreichbar:** Meldung, der Entwurf bleibt im Dialog,
  es wird nichts geschrieben.
- **Gebundene Aufgabe fehlt (`404`):** Bindung lösen, Hinweis, Auswahl fällt auf
  „Neue Aufgabe“.
- **Modellfehler:** siehe Ablauf Schritt 3. Der Abgleich fällt auf „Neue
  Aufgabe“ zurück.

## Tests

- **Unit (bun test):**
  - Prüfung der Modellantworten
  - Format des Notiz-Blocks
  - Ablauf-Logik mit simuliertem `host`
  - Gateway gegen einen simulierten SP-Server: Auth, Routen, ID-Prüfung,
    404/503, Body-Limit
- **Manuell:**
  - Dialog am Desktop und am Handy
  - Neue Aufgabe und Anhängen erscheinen auf dem Mac
  - Die Session-Bindung wirkt beim zweiten Log

## Infrastruktur (dell-pro-max)

- **systemd-User-Dienste:**
  - `super-productivity.service` (AppImage unter Xvfb)
  - `sp-gateway.service` (Node)
  - `sp-gateway-tunnel.service` (cloudflared, Tunnel `sp-gateway`,
    `dev-sp.nomobo.de` → `127.0.0.1:3877`)
- **Einmalige GUI-Einrichtung:** über ein temporäres VNC nur auf der
  Tailscale-IP. Dabei werden SuperSync angemeldet, die Local REST API aktiviert
  und der Token erzeugt.
- **Token-Dateien:**
  - Der SP-Token wird direkt aus `~/.config/superProductivity/local-rest-api-token`
    gelesen. SP legt die Datei selbst an, und sie wird beim Neuerzeugen
    aktualisiert.
  - Der Gateway-Token liegt in `~/.config/sp-gateway/`, Modus 600.
- **Stand 2026-11-17:**
  - SP v20.0.0 ist mit SuperSync verbunden und entschlüsselt, die REST-API läuft.
  - VNC und Debug-Zugänge sind wieder entfernt.
  - Die GUI-Einrichtung lief per CDP (Remote-Debugging) und geschützter Eingabe,
    weil VNC von macOS aus nicht funktionierte.

## Nicht enthalten

Obsidian, Git, gemessene Zeiterfassung, Rückspiegelung von Änderungen,
Verwaltungs-UI außer der Projektwahl, mehrere SP-Instanzen.
