# SP Log – OpenChamber → Super Productivity

OpenChamber-Erweiterung, die aus einer Session einen Arbeitslog-Eintrag entwirft und ihn als neue Aufgabe oder als Notiz-Anhang an eine bestehende Aufgabe in Super Productivity schreibt. Der Zugriff läuft über ein kleines Gateway (`gateway/`), das auf dem Dell neben der SP-REST-API läuft und per Cloudflare-Tunnel unter `https://dev-sp.nomobo.de` erreichbar ist.

## Erweiterung installieren

1. In OpenChamber: Settings → Extensions → Ordner oder Git-URL dieses Repos hinzufügen.
2. Settings → Integrations → „Super Productivity“ verbinden und den Gateway-Token eintragen.
   Token lesen: `ssh dell-pro-max 'cat ~/.config/sp-gateway/gateway-token'`
3. In einer Session die Aktion „Nach Super Productivity loggen“ ausführen.

## Gateway deployen (Dell, systemd --user)
```sh
ssh dell-pro-max 'mkdir -p ~/.local/opt/sp-gateway ~/.config/systemd/user; mkdir -p -m 700 ~/.config/sp-gateway'
scp gateway/*.ts dell-pro-max:.local/opt/sp-gateway/
scp deploy/sp-gateway.service dell-pro-max:.config/systemd/user/
ssh dell-pro-max bash -s <<'EOF'
f=~/.config/sp-gateway/gateway-token
[ -e "$f" ] || (umask 077; openssl rand -hex 32 > "$f")
systemctl --user daemon-reload && systemctl --user enable --now sp-gateway.service
EOF
```

Das Gateway lauscht nur auf `127.0.0.1:3877`; ohne Token liefert `https://dev-sp.nomobo.de/me` 401.

Zeitbuchung (ab 0.5.0): Jeder Log mit Stunden wird als erledigte Unteraufgabe „TT.MM. · Titel“ unter der Aufgabe angelegt und trägt die Zeit; die Aufgabe zeigt die Summe. So greift SPs Grenze von 24 h pro Aufgabe und Tag nicht für die Summe mehrerer Logs. Ein einzelner Log darf bis 100 h haben (ab 0.7.1); über 24 h legt das Gateway mehrere Unteraufgaben „TT.MM. · Titel (i/n)“ zu je 24 h an, den Rest zuletzt. Hat eine Aufgabe noch eigene Zeit ohne Unteraufgaben (Logs vor 0.5.0), zieht das Gateway diese zuerst in eine Unteraufgabe „Frühere Logs“ um.

Erledigen (ab 0.6.0): Nach jedem gespeicherten Log markiert das Gateway die Aufgabe als erledigt (Antwortfeld `completed`). Weitere Logs derselben Session hängen weiter an die gebundene Aufgabe an, auch wenn sie erledigt ist; das Panel prüft sie über `GET /tasks/:id` und zeigt sie als „Titel (erledigt)“. Erst eine gelöschte oder archivierte Aufgabe gilt als weg, dann wird eine neue angelegt.

Aufgabenansicht (ab 0.8.0): Das SP-Log-Panel in der Seitenleiste zeigt ohne Session-Aktion die SP-Aufgabe der aktuellen Session schreibgeschützt und live aus Super Productivity (`GET /tasks/:id/details`): Titel, Projekt, Status, Gesamtzeit, die Logs als Unteraufgaben und die Notizen. Es lädt beim Sessionwechsel, nach jedem Log und über „Aktualisieren“ neu. Ohne Log bietet es „Jetzt loggen“ wie der Work Status.
Entwicklung: `bun run check` führt Typecheck, Build und Tests aus.
