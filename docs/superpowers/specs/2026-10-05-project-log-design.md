# OpenChamber Project Log — Spezifikation

## Ziel und bestätigter Umfang

Eigenständige OpenChamber-Extension, die den bisherigen `/log`-Skill ersetzt.
Sie erstellt pro Projekt Obsidian-Changelogs mit geschätztem abrechenbarem
Aufwand eines erfahrenen Entwicklers ohne KI. Keine tatsächliche Zeiterfassung,
keine Änderungen an Projekt-Dokumentation und keine Änderungen am System Monitor
oder an OpenChamber selbst.

Die Bedienung erfolgt über einen Session-Button mit bearbeitbarem Entwurf.
Speichern führt automatisch Commit und Push aus, ohne gesonderte Push-Bestätigung.
Eine Projekt-/Session-Übersicht und eine Work-Status-Sektion zeigen den Log-Status.
Eine Kennzeichnung in der nativen Session-Liste ist nicht Bestandteil.

## Architektur

- TypeScript mit Bun für Entwicklung, Tests und Build.
- `@openchamber/sdk` für Sandbox-UI, Session-Aktion, Projektübersicht,
  Work Status und Modellaufrufe.
- Gebündelte klassische IIFE-Frames; kein direkter Netzwerk- oder Node-Zugriff.
- Host-gestarteter Node-kompatibler Dienst für Konfiguration, Git-Kontext,
  Stack-Erkennung, Vault-Clone, Log-Schreibvorgänge und persistente Checkpoints.
- Dienst erreichbar ausschließlich auf Loopback, authentifiziert mit dem
  vom Host bereitgestellten Service-Token.
- Keine Runtime-Abhängigkeit außer dem gebündelten SDK.

Verantwortlichkeiten werden getrennt: Session-Status und Delta-Auswahl,
Stack-/Git-Kontext, Modell-Prompt und Ausgabevalidierung, Markdown-Erzeugung,
Git-Publikation, persistenter Zustand sowie UI.

## Konfiguration

Globale Einstellungen: Obsidian-Git-Remote, expliziter Branch und eigener
lokaler Clone. Clone und Zustandsdaten liegen außerhalb des installierten
Extension-Pakets. Vorhandene Benutzerverzeichnisse werden nicht überschrieben.
Es wird nicht im durch Syncthing synchronisierten Vault gearbeitet.

Pro OpenChamber-Projekt: Obsidian-Zielordner relativ zum Vault-Root,
Changelog-Projektname und optionale Hinweise zur Aufwandsschätzung.
Identifikation über Projekt-ID und zugehörige Verzeichnisse; Worktrees gehören
zum jeweiligen Projekt. Eine mehrdeutige Zuordnung erfordert eine Auswahl.
Unkonfigurierte Projekte verlangen die Zuordnung vor dem Speichern.
Die alten Skill-Zuordnungen dürfen Vorschläge sein, aber keine feste Vorgabe.

Zielpfade dürfen den Clone nicht verlassen, auch nicht über Symlinks.
Keine Zugangsdaten in Konfiguration, Log-Dateien oder Fehlermeldungen.
Git verwendet vorhandene nichtinteraktive Authentifizierung. Der Dienst hat
eine minimale Host-Umgebung: SSH-Agent-Verfügbarkeit darf nicht vorausgesetzt
werden. Fehlende Authentifizierung wird verständlich angezeigt.

## Log-Ablauf

1. Session-Aktion „Jetzt loggen“ liefert den Gesprächskontext und öffnet den Entwurf.
2. Der Dienst ermittelt Projektzuordnung, Technologie-Stack und begrenzten
   Git-Kontext. Projektdateien sind Daten, keine Anweisungen an das Modell.
3. Das konfigurierte Host-Modell erzeugt einen strukturierten Entwurf:
   Feature-Name, Zusammenfassung, Änderungen, betroffene Dateien, technische
   Hinweise und zusätzlichen geschätzten Aufwand in Stunden.
4. Der Nutzer kann Zielzuordnung, Feature-Name, Inhalt und Stunden prüfen und
   bearbeiten. Keine automatische Speicherung von Modellantworten.
5. „Log speichern“ aktualisiert den Clone sicher, schreibt die Tagesdatei,
   committet nur die betroffenen Extension-Log-Dateien und pusht automatisch
   auf den konfigurierten Branch.
6. Erst bestätigter Push ergibt „Geloggt“. Scheitert nur der Push, bleibt der
   lokale Commit erhalten und die Anzeige wird „Push ausstehend“.

SDK 2.1.0 dokumentiert `host.generate()` als Zugriff auf das konfigurierte
Small Model, nicht als frei wählbaren Decision-Modell-Endpunkt. Diese
unterstützte Schnittstelle wird genutzt; keine nicht dokumentierte Modell-API.
Modellantworten werden auf Form, Größen und gültige nichtnegative endliche
Stunden geprüft. Fehler lassen den Entwurf und bestehende Logs unverändert.
Ohne verfügbares Modell wird kein erfundener Aufwand eingesetzt.

## Aufwand und Tagesdateien

Schätzung nach dem bisherigen `/log`-Workflow, angepasst an den tatsächlichen
Projekt-Stack: Entwicklung, Recherche, Iterationen, Debugging, Styling,
Übersetzungen, Tests, Review und tatsächlich geleistete Dokumentation.
Keine Behauptung, dass nicht nachgewiesene Arbeiten durchgeführt wurden.
Die Schätzung bleibt sichtbar als Schätzung gekennzeichnet und editierbar.

Eine Datei pro Feature und Kalendertag in lokaler Zeitzone:
`YYYY-MM-DD-feature-slug.md`. Frontmatter enthält mindestens `date`, `project`,
`feature`, `commit`, `billable_hours` und `tags`. Der Inhalt umfasst
Zusammenfassung, Änderungen, betroffene Dateien, technische Details und Notizen
soweit vorhanden. Nicht vorhandene Git-Informationen werden nicht erfunden.

Am gleichen Tag werden neue Inhalte ergänzt und nur zusätzliche Stunden
addiert; vorhandene manuelle Inhalte bleiben erhalten. Am nächsten Tag wird
eine neue Datei angelegt, ohne Übernahme der vorherigen Stunden.
Feature-Slugs sind lesbar und höchstens 50 Zeichen lang; kollidierende Namen
werden nicht stillschweigend zusammengeführt. Der Nutzer entscheidet, ob
ein bestehendes Feature ergänzt oder ein getrenntes Feature angelegt wird.

## Checkpoints und Status

Ein Checkpoint pro Session umfasst die bereits erfassten Gesprächsbeiträge,
deren IDs/Inhaltsfingerprints, die zugeordneten Logs und Publikationsrevisionen.
Nur die seit diesem Checkpoint geleistete Arbeit wird erneut geschätzt.
Ein Entwurf ist an seinen geprüften Gesprächsstand gebunden: währenddessen
entstandene neue Arbeit wird nicht versehentlich als bereits geloggt markiert.

- **Nicht geloggt:** kein publizierter Log für die Session.
- **Geloggt:** geprüfter Gesprächsstand wurde erfolgreich publiziert.
- **Prüfung ausstehend:** neue Session-Aktivität beobachtet, aber noch keine
  vollständige inhaltliche Bewertung verfügbar.
- **Log aktualisieren:** neue logwürdige Arbeit seit dem Checkpoint erkannt.
- **Push ausstehend:** Log lokal committet, Publikation noch nicht bestätigt.

Publikationszustand und neue Arbeit sind getrennte Dimensionen: ein
ausstehender Push darf zusätzliche Änderungen nicht verstecken.
Reine Rückfragen oder Smalltalk verursachen nicht automatisch neue Stunden.
Eine abgeschlossene Agent-Antwort ist nicht automatisch abgeschlossene Arbeit.

Session-Aktionen können mit `payload: ["messages"]` Gesprächsinhalte liefern;
die Projekt-/Session-Liste liefert nur Metadaten. Deshalb darf neue Aktivität
ohne verfügbaren vollständigen Gesprächsstand nur „Prüfung ausstehend“ ergeben,
nicht einen behaupteten aktuellen Log-Status. Die inhaltliche Prüfung erfolgt
beim nächsten Session-Aktionsaufruf. Keine heimliche Conversation-API.
Gekürzte oder fehlende Historie wird angezeigt und erlaubt keine automatische
Delta-Schätzung auf Grundlage einer vermeintlich vollständigen Session.
Forks sind separate Sessions; bereits übernommene Log-Referenzen dürfen nicht
als neue abrechenbare Arbeit behandelt werden.

## Sichere Git-Publikation und Wiederholung

Alle Schreib-/Git-Operationen pro Vault werden serialisiert. Nutzerpfade und
Git-Argumente werden nie in eine Shell-Zeichenkette interpoliert.
Ausführung erfolgt mit Argumentlisten, Grenzen und Zeitlimits.
Kein Force-Push, kein Hard Reset, kein automatisches Konfliktauflösen.
Fremde lokale Änderungen im dedizierten Clone führen zum Stopp.

Vor dem Schreiben wird der Branch mit dem Remote abgeglichen; ein sauberer
ungeänderter Clone wird nur per Fast-forward aktualisiert. Nach einer
Remote-Änderung zwischen Commit und Push werden die eigenen unpublizierten
Commits nur auf sauberem Baum rebasiert; Konflikte führen zum Stopp und bleiben
sichtbar. Bestehende Konflikte blockieren weitere Schreibvorgänge.

Eine persistente Operations-ID macht Speichern, Timeout-Wiederholung und
Push-Wiederholung idempotent. Status und Commit-Zuordnung sind nach Neustart
rekonstruierbar. Ein bereits geschriebener Log wird nicht noch einmal ergänzt,
und ein Push-Retry schätzt keine neuen Stunden. Bei unbekanntem Push-Ergebnis
wird geprüft, ob der Commit bereits auf dem Remote-Branch enthalten ist.

## Oberfläche

Extension-Panel: Projektwahl, Session-Liste mit Status, Projektzuordnung,
globale Git-Einstellungen, Log-Entwurf und Publikationsfehler.
Work Status: kompakter Status der aktuellen Session und Hinweise zum Loggen.
Session-Aktion: „Jetzt loggen“ beziehungsweise Aktualisieren über denselben
Einstieg. Die UI verwendet Host-Themevariablen und folgt Hell-/Dunkelmodus.
Persistenz liegt im Dienst, nicht in kurzlebigen Frames.

## Verifikation

Unit-Tests für Delta-Erkennung, Statusübergänge, Ausgabevalidierung,
Stack-Erkennung, Tageswechsel, Slugs und Markdown-Ergänzungen.
Integrationstests mit temporären lokalen Git-Remotes für Clone, Commit/Push,
fremde Änderungen, konkurrierende Remote-Commits, Konflikte, Push-Fehler,
Wiederholung nach Timeout und Neustart sowie Pfad-/Symlink-Ausbrüche.
UI-/SDK-Tests für Session-Aktion, gekürzten Kontext, Modellfehler,
Projektzuordnung, Work-Status und fehlende Berechtigungen.
Typecheck, Tests und reproduzierbarer Build; `dist/` wird mitgeliefert.
Ein Preview mit Stand-in-Host ermöglicht sichtbare Prüfung des Entwurfsflusses.
Echte Remote-Pushes benötigen konfigurierte Repository-Zugänge und erfolgen
nicht im Rahmen der automatisierten Tests.
