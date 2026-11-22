# monet

Self-hosted photos for a household, replacing Google Photos: a Bun server, a Svelte web app, and agents for Mac and
Android that upload from the devices. Live at https://monet.kaleve.dev on kaleve-home (the laptop in toolbox/home),
passkeys only. The contract every part builds against is `docs/spec.md`; `CLAUDE.md` says how to work here.

## Layout

| Path | What |
| --- | --- |
| `app/` | Server (`server/`), web client (`client/`), in-browser and server-side ML, `deploy/`. `app/README.md` explains it. |
| `mac/` | The Mac agent: a Swift app built with swiftc, no Xcode project. |
| `android/` | The Android app (Gradle). |
| `docs/`, `design/` | The spec and the design material. |
| `tools/validate.sh` | Every check, by part; CI runs one part per job. |

## Run, check, deploy

```sh
cd app && bun install && bun run build.ts && bun server/main.ts   # the server, prints a setup link on first start
tools/validate.sh app                                             # also: mac, android; none means every part this machine can build
app/deploy/deploy.sh                                              # Linux binary and models to kaleve-home, restart, /healthz
```

## Hosting it yourself

Monet is for people who trust each other, on a server one of them runs. Everyone signs in with a passkey; there are
no passwords and no mail. `app/docs/accounts.md` has the full rules.

1. Run it behind HTTPS (passkeys need it), listening on 127.0.0.1: a Cloudflare Tunnel, or Caddy with automatic
   certificates (`reverse_proxy 127.0.0.1:4320`). Set `MONET_ORIGIN` to the public address; passkeys are bound to
   its host name, so pick it once. The proxy must set `X-Forwarded-For` and overwrite what the client sent.
2. Set `MONET_SETUP_TOKEN` to a long random string. The first start prints `https://<host>/setup#<token>`; opening it
   makes the first account, an admin.
3. Invite from Haushalt (or `monet invite <name>` on the server). The invite is a link that works once, within a
   week; send it over a messenger. Whoever opens it makes their own passkey.
4. A lost phone: an admin taps "Neuer Passkey" next to the person, which gives a link that replaces their passkeys.
   If the only admin is locked out, `monet reset-passkeys <name>` on the server prints such a link.

Test photos are not in the repo: the end-to-end tests read the folder `MONET_TESTDATA` names. Deploy from `main`, right
after a pull, with nothing uncommitted. `app/deploy/README.md` explains the shared deploy template.
