import { useEffect, useRef, useState, type ReactNode } from "react";
import Phaser from "phaser";
import { DISTRICTS_BY_ID, doorAt, getMap, type DoorKind, type ServerMsg } from "@replicant/shared";
import type { PlayerView } from "../api";
import { secs } from "../format";
import { CityScene, type CityBridge } from "./CityScene";

function wsUrl(): string {
  const api = import.meta.env.VITE_API_URL;
  if (api) return api.replace(/^http/, "ws") + "/ws";
  if (import.meta.env.DEV) return "ws://localhost:2567/ws";
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

const DOOR_TITLES: Record<DoorKind, string> = {
  exchange: "Exchange terminal",
  blackmarket: "Black market den",
  factory: "Factory",
  transit: "Transit gate",
};

export type Terminal = DoorKind | "storage" | "orders";

/**
 * The isometric city: a Phaser canvas plus the WebSocket connection to the district server.
 * Standing on a door tile opens the matching terminal (market, factory, transit).
 */
export function CityView({ view, renderTerminal }: { view: PlayerView; renderTerminal: (t: Terminal) => ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const bridge = useRef<CityBridge>({
    district: null,
    you: null,
    players: [],
    version: 0,
    sendMove: (x, y) => send({ t: "move", x, y }),
    onStop: () => {},
  });
  const [district, setDistrict] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "online" | "transit" | "offline">("connecting");
  const [door, setDoor] = useState<DoorKind | null>(null);
  const [open, setOpen] = useState<Terminal | null>(null);
  const [count, setCount] = useState(0);

  const playerId = view.player.id;
  const inTransit = view.player.transit_seconds > 0;

  function send(msg: unknown) {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // Debug/test hook: walk to a tile from the browser console, e.g. __walk(4, 5).
  (window as unknown as { __walk?: (x: number, y: number) => void }).__walk = (x, y) => send({ t: "move", x, y });

  // Door detection: the scene reports where your avatar stopped.
  bridge.current.onStop = (x, y) => {
    const d = bridge.current.district;
    const kind = d && x >= 0 ? doorAt(getMap(d), x, y) : null;
    setDoor(kind);
    if (!kind) setOpen((o) => (o === "storage" || o === "orders" ? o : null));
  };

  // Phaser game, created once.
  useEffect(() => {
    if (!host.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current,
      backgroundColor: "#07090d",
      scale: { mode: Phaser.Scale.RESIZE, width: host.current.clientWidth, height: host.current.clientHeight },
      render: { antialias: true },
      disableContextMenu: true,
      banner: false,
    });
    game.scene.add("city", CityScene, true, { bridge: bridge.current });
    return () => game.destroy(true);
  }, []);

  // WebSocket connection with automatic reconnect.
  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      setStatus("connecting");
      const ws = new WebSocket(wsUrl());
      socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ t: "join", playerId }));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMsg;
        const b = bridge.current;
        if (msg.t === "welcome") {
          b.you = msg.you;
          b.district = msg.district;
          b.players = [];
          b.version++;
          setDistrict(msg.district);
          setStatus("online");
          setDoor(null);
        } else if (msg.t === "state" && msg.district === b.district) {
          b.players = msg.players;
          b.version++;
          setCount(msg.players.length);
        } else if (msg.t === "transit" || (msg.t === "left" && msg.reason === "travel")) {
          b.players = [];
          b.version++;
          setStatus("transit");
          setDoor(null);
          setOpen(null);
        } else if (msg.t === "left" && msg.reason === "replaced") {
          closed = true;
          setStatus("offline");
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus("offline");
        retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, [playerId]);

  // Rejoin after arriving somewhere new.
  useEffect(() => {
    if (!inTransit && (status === "transit" || (status === "online" && district !== view.player.location))) {
      send({ t: "join", playerId });
    }
  }, [inTransit, status, district, view.player.location, playerId]);

  // Keyboard: E opens the terminal you're standing on, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Escape") setOpen(null);
      if (e.key.toLowerCase() === "e" && door) setOpen(door);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [door]);

  const districtName = district ? DISTRICTS_BY_ID.get(district)?.name : "";

  return (
    <div className="city">
      <div ref={host} className="cityCanvas" />

      <div className="cityHud top">
        <span className="pill">{districtName || "…"}</span>
        <span className={`pill ${status === "online" ? "ok" : status === "offline" ? "bad" : ""}`}>
          {status === "online" ? `${count} here` : status}
        </span>
        <button onClick={() => setOpen("storage")}>Storage</button>
        <button onClick={() => setOpen("orders")}>My orders</button>
        <span className="muted hint">Click to walk · scroll to zoom · E to use</span>
      </div>

      {status === "transit" && (
        <div className="cityOverlay">
          <div className="panel">
            <h2>In transit</h2>
            <p>
              Heading to {DISTRICTS_BY_ID.get(view.player.location)?.name}. Arriving in {secs(view.player.transit_seconds)}.
            </p>
          </div>
        </div>
      )}

      {door && !open && status === "online" && (
        <div className="cityHud bottom">
          <span>{DOOR_TITLES[door]}</span>
          <button className="primary" onClick={() => setOpen(door)}>
            Use (E)
          </button>
        </div>
      )}

      {open && (
        <div className="cityModal" onClick={() => setOpen(null)}>
          <div className="cityModalBody" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setOpen(null)} aria-label="Close">
              ✕
            </button>
            {renderTerminal(open)}
          </div>
        </div>
      )}
    </div>
  );
}
