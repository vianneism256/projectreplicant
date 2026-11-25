import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { TICK_MS, type ClientMsg, type ServerMsg } from "@replicant/shared";
import type { Db } from "../db/pool";
import { World } from "./world";

const UUID = /^[0-9a-fA-F-]{36}$/;

/**
 * Real-time layer: WebSocket connections at /ws on the same port as the HTTP API.
 * The database decides which district a player may be in (their location, not in transit).
 */
export class WorldServer {
  readonly world = new World();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  private readonly sockets = new Map<string, WebSocket>();
  private readonly playerOf = new WeakMap<WebSocket, string>();
  private timer?: NodeJS.Timeout;
  private lastBroadcast = 0;

  constructor(private readonly db: Db) {
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  attach(http: HttpServer): void {
    http.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!req.url?.startsWith("/ws")) return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
    });
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const changed = this.world.step((now - last) / 1000);
      last = now;
      // Broadcast districts that changed every tick, and everyone at least once a second.
      const full = now - this.lastBroadcast > 1000;
      if (full) this.lastBroadcast = now;
      for (const d of full ? this.world.districts() : changed) this.broadcast(d);
    }, TICK_MS);
  }

  close(): void {
    clearInterval(this.timer);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  /** Called by the HTTP API when a player starts travelling. */
  kick(playerId: string, reason: "travel" | "replaced"): void {
    const district = this.world.remove(playerId);
    const ws = this.sockets.get(playerId);
    if (ws) send(ws, { t: "left", reason });
    if (district) this.broadcast(district);
  }

  private onConnection(ws: WebSocket): void {
    let alive = true;
    ws.on("pong", () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 15_000);

    ws.on("message", (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, { t: "error", message: "Bad message." });
      }
      this.onMessage(ws, msg).catch(() => send(ws, { t: "error", message: "Server error." }));
    });

    ws.on("close", () => {
      clearInterval(ping);
      const id = this.playerOf.get(ws);
      if (id && this.sockets.get(id) === ws) {
        this.sockets.delete(id);
        const district = this.world.remove(id);
        if (district) this.broadcast(district);
      }
    });
  }

  private async onMessage(ws: WebSocket, msg: ClientMsg): Promise<void> {
    if (msg.t === "join") {
      if (typeof msg.playerId !== "string" || !UUID.test(msg.playerId)) return send(ws, { t: "error", message: "Bad player id." });
      const r = await this.db.query<{ handle: string; location: string; transit: number }>(
        `SELECT handle, location,
                CASE WHEN transit_until > now() THEN ceil(extract(epoch FROM transit_until - now()))::int ELSE 0 END AS transit
         FROM players WHERE id = $1`,
        [msg.playerId],
      );
      const p = r.rows[0];
      if (!p) return send(ws, { t: "error", message: "Player not found." });

      // One connection per player: a new tab replaces the old one.
      const old = this.sockets.get(msg.playerId);
      if (old && old !== ws) {
        send(old, { t: "left", reason: "replaced" });
        old.close();
      }
      this.sockets.set(msg.playerId, ws);
      this.playerOf.set(ws, msg.playerId);

      if (p.transit > 0) {
        const district = this.world.remove(msg.playerId);
        if (district) this.broadcast(district);
        return send(ws, { t: "transit", seconds: p.transit });
      }
      const before = this.world.districtOf(msg.playerId);
      this.world.place(msg.playerId, p.handle, p.location);
      if (before && before !== p.location) this.broadcast(before);
      send(ws, { t: "welcome", you: msg.playerId, district: p.location });
      this.broadcast(p.location);
      return;
    }

    if (msg.t === "move") {
      const id = this.playerOf.get(ws);
      if (!id || this.sockets.get(id) !== ws) return send(ws, { t: "error", message: "Join first." });
      if (!Number.isInteger(msg.x) || !Number.isInteger(msg.y)) return;
      this.world.walkTo(id, { x: msg.x, y: msg.y });
      return;
    }
  }

  private broadcast(district: string): void {
    const players = this.world.snapshot(district);
    const msg = JSON.stringify({ t: "state", district, players } satisfies ServerMsg);
    for (const p of players) {
      const ws = this.sockets.get(p.id);
      if (ws?.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
