#!/usr/bin/env node
/**
 * One command to host a playtest from your own computer:
 *   npm run playtest            -> game on http://localhost:2567 (same Wi-Fi: http://<your-ip>:2567)
 *   npm run playtest -- --tunnel -> also opens a public Cloudflare Quick Tunnel link for remote testers
 *
 * Needs: Node 20+, Docker Desktop running, and (for --tunnel) cloudflared installed.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wantTunnel = process.argv.includes("--tunnel");
const PORT = 2567;

function step(title, cmd, args) {
  console.log(`\n▶ ${title}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`\n✖ "${title}" failed. See the output above.`);
    process.exit(r.status ?? 1);
  }
}

function has(cmd) {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return r.status === 0;
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
}

// 1. Checks
if (!has("docker")) {
  console.error("✖ Docker isn't installed or isn't running. Install Docker Desktop and start it, then try again.");
  process.exit(1);
}
if (wantTunnel && !has("cloudflared")) {
  console.error(
    "✖ cloudflared isn't installed.\n" +
      "  Windows: winget install --id Cloudflare.cloudflared\n" +
      "  macOS:   brew install cloudflared\n" +
      "  Then open a new terminal and run this again.",
  );
  process.exit(1);
}
if (!existsSync(path.join(root, ".env"))) {
  copyFileSync(path.join(root, ".env.example"), path.join(root, ".env"));
  console.log("Created .env from .env.example");
}
if (!existsSync(path.join(root, "node_modules"))) step("Installing packages", "npm", ["install"]);

// 2. Build the game page and start the database
step("Building the game client", "npm", ["run", "build", "-w", "client"]);
step("Starting Postgres (Docker)", "docker", ["compose", "up", "-d", "db"]);

// 3. Start the game server (serves the API and the game page on one port)
console.log("\n▶ Starting the game server");
const children = [];
const server = spawn("npm", ["run", "start", "-w", "server"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
children.push(server);

// 4. Optional public link
if (wantTunnel) {
  const tunnel = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  children.push(tunnel);
  let shown = false;
  const watch = (buf) => {
    const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !shown) {
      shown = true;
      banner([`Public link for testers:  ${m[0]}`, "(It changes every time you restart the tunnel.)"]);
    }
  };
  tunnel.stdout.on("data", watch);
  tunnel.stderr.on("data", watch);
}

setTimeout(() => {
  banner([
    `You:            http://localhost:${PORT}`,
    ...lanAddresses().map((ip) => `Same Wi-Fi:     http://${ip}:${PORT}`),
    wantTunnel ? "Public link:    appears here once the tunnel is ready" : "Remote testers: run `npm run playtest -- --tunnel`",
    "Stop:           press Ctrl+C",
  ]);
}, 4000);

function banner(lines) {
  const w = Math.max(...lines.map((l) => l.length)) + 4;
  console.log(`\n${"=".repeat(w)}\n${lines.map((l) => `  ${l}`).join("\n")}\n${"=".repeat(w)}\n`);
}

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => {
  console.error(`Game server stopped (code ${code}).`);
  for (const c of children) c.kill();
  process.exit(code ?? 1);
});
