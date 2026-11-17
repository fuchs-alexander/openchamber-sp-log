# SP Log – OpenChamber → Super Productivity

OpenChamber-Erweiterung, die aus einer Session einen Arbeitslog-Eintrag entwirft und ihn als neue Aufgabe oder als Notiz-Anhang an eine bestehende Aufgabe in Super Productivity schreibt. Der Zugriff läuft über ein kleines Gateway (`gateway/`), das auf dem Dell neben der SP-REST-API läuft und per Cloudflare-Tunnel unter `https://dev-sp.nomobo.de` erreichbar ist.

## Erweiterung installieren

1. In OpenChamber: Settings → Extensions → Ordner oder Git-URL dieses Repos hinzufügen.
2. Settings → Integrations → „Super Productivity“ verbinden und den Gateway-Token eintragen.
   Token lesen: `ssh dell-pro-max 'cat ~/.config/sp-gateway/gateway-token'`
3. In einer Session die Aktion „Nach Super Productivity loggen“ ausführen.

## Gateway deployen (Dell, systemd --user)

```sh
scp gateway/*.ts dell-pro-max:.local/opt/sp-gateway/
scp deploy/sp-gateway.service dell-pro-max:.config/systemd/user/
ssh dell-pro-max bash -s <<'EOF'
f=~/.config/sp-gateway/gateway-token
[ -e "$f" ] || (umask 077; openssl rand -hex 32 > "$f")
systemctl --user daemon-reload && systemctl --user enable --now sp-gateway.service
EOF
```

Das Gateway lauscht nur auf `127.0.0.1:3877`; ohne Token liefert `https://dev-sp.nomobo.de/me` 401.
Entwicklung: `bun run check` führt Typecheck, Build und Tests aus.
