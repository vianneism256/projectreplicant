# Hosting a playtest from your own computer

Your computer runs the database and the game server. Testers open a link in their browser; they install nothing.

## One-time setup (host)

1. Install **Node.js 20+** and **Docker Desktop**. Start Docker Desktop.
2. For testers outside your Wi-Fi, install **cloudflared**:
   - Windows: `winget install --id Cloudflare.cloudflared`
   - macOS: `brew install cloudflared`
   - Open a new terminal afterwards so it's found.
3. Clone the repo and run `npm install`.

## Every playtest session (host)

From the repo folder:

| Who's playing | Command | What testers open |
| --- | --- | --- |
| Only people on your Wi-Fi | `npm run playtest` | `http://<your-ip>:2567` (printed in the terminal) |
| Anyone, anywhere | `npm run playtest -- --tunnel` | The `https://….trycloudflare.com` link printed in the terminal |

Keep the terminal open while people play. Press **Ctrl+C** to stop.

Things to know:

- **Keep your computer awake.** Turn off sleep while hosting. If it sleeps, the game goes down for everyone.
- **The tunnel link changes every time** you restart with `--tunnel`. Send testers the new link each session.
- **Characters and items are saved** in the Docker database and survive restarts. To wipe everything for a fresh test: `npm run db:down -- -v`.
- **No passwords yet.** Anyone with the link can make a character, so share it privately.
- On Windows, if testers on your Wi-Fi can't connect, allow Node.js through Windows Firewall when it asks (or in Windows Security → Firewall → Allow an app).

## For testers

1. Open the link the host sent you.
2. Type a handle and press **Create**.
3. Copy the **ID** shown in the top bar and keep it. It's how you get back into your character from another browser or device (there are no passwords yet).

### What to try

- **Salvage** in each district. Rustline and Ashfields have better materials than Helix Arcology.
- **Haul** materials back to Helix Arcology, the only place with refineries and factories.
- **Refine and build** something, then **sell** it on the market.
- **Find price differences** between districts and profit from them.
- Watch the **Economy** panel: it shows where credits come from and where they disappear.

### What to report

- Anything that felt confusing, slow or pointless.
- Prices that seemed broken (too cheap, too expensive, impossible to profit).
- Errors, with what you clicked just before.
