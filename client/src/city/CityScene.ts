import Phaser from "phaser";
import { DISTRICTS_BY_ID, getMap, isWalkable, tileAt, doorAt, type AvatarState, type DistrictMap, type DoorKind } from "@replicant/shared";

/** Shared mutable state between React (network) and the scene (rendering). */
export interface CityBridge {
  district: string | null;
  you: string | null;
  players: AvatarState[];
  /** Bumped whenever district/players change. */
  version: number;
  sendMove: (x: number, y: number) => void;
  /** Called when your avatar stops on a tile (door detection). */
  onStop: (x: number, y: number) => void;
}

const TW = 64;
const TH = 32;
const iso = (x: number, y: number) => ({ x: (x - y) * (TW / 2), y: (x + y) * (TH / 2) });
const fromIso = (wx: number, wy: number) => ({
  x: Math.round((wx / (TW / 2) + wy / (TH / 2)) / 2),
  y: Math.round((wy / (TH / 2) - wx / (TW / 2)) / 2),
});

interface Palette {
  ground: number;
  road: number;
  park: number;
  toxic: number;
  top: number;
  left: number;
  right: number;
  window: number;
  rubble: number;
  minH: number;
  maxH: number;
}

const PALETTES: Record<string, Palette> = {
  arcology: {
    ground: 0x2b3442,
    road: 0x1b212b,
    park: 0x1f4232,
    toxic: 0x3b5a2a,
    top: 0x5b6f8a,
    left: 0x34415a,
    right: 0x283245,
    window: 0x5ff0e0,
    rubble: 0x4a4f58,
    minH: 70,
    maxH: 150,
  },
  sprawl: {
    ground: 0x2e2724,
    road: 0x1d1917,
    park: 0x2c3a26,
    toxic: 0x3b5a2a,
    top: 0x6a4a63,
    left: 0x45303f,
    right: 0x352532,
    window: 0xff5fa2,
    rubble: 0x5a4a3a,
    minH: 30,
    maxH: 80,
  },
  wildlands: {
    ground: 0x3b3526,
    road: 0x2a2519,
    park: 0x34401f,
    toxic: 0x4f7a1f,
    top: 0x5a5246,
    left: 0x3d372e,
    right: 0x302b23,
    window: 0xc6ff4f,
    rubble: 0x4d4335,
    minH: 20,
    maxH: 45,
  },
};

const DOOR_STYLE: Record<DoorKind, { color: number; label: string }> = {
  exchange: { color: 0x36e0c8, label: "EXCHANGE" },
  blackmarket: { color: 0xff3d8b, label: "BLACK MARKET" },
  factory: { color: 0xffb340, label: "FACTORY" },
  transit: { color: 0x7d8cff, label: "TRANSIT GATE" },
};

/** Deterministic pseudo-random number per tile, so buildings look the same every time. */
function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

interface AvatarSprite {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  tx: number;
  ty: number;
  wasMoving: boolean;
}

export class CityScene extends Phaser.Scene {
  private bridge!: CityBridge;
  private seenVersion = -1;
  private map: DistrictMap | null = null;
  private mapObjects: Phaser.GameObjects.GameObject[] = [];
  private avatars = new Map<string, AvatarSprite>();
  private buildings: { g: Phaser.GameObjects.Graphics; x: number; y: number }[] = [];
  private cursor!: Phaser.GameObjects.Graphics;
  private marker!: Phaser.GameObjects.Graphics;

  constructor() {
    super("city");
  }

  init(data: { bridge: CityBridge }) {
    this.bridge = data.bridge;
  }

  create() {
    this.cameras.main.setBackgroundColor("#07090d");
    this.cameras.main.setZoom(1.1);

    this.cursor = this.add.graphics().setDepth(5);
    this.marker = this.add.graphics().setDepth(6);

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.drawCursor(p));
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.map || p.rightButtonDown()) return;
      const t = fromIso(p.worldX, p.worldY);
      if (!isWalkable(this.map, t.x, t.y)) return;
      this.bridge.sendMove(t.x, t.y);
      this.flashMarker(t.x, t.y);
    });
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.5, 2.2));
    });
  }

  update(_time: number, delta: number) {
    if (this.bridge.version !== this.seenVersion) {
      this.seenVersion = this.bridge.version;
      if (this.bridge.district && this.bridge.district !== this.map?.districtId) this.buildMap(this.bridge.district);
      this.syncAvatars();
    }
    // Smoothly move sprites toward the latest server positions.
    const k = Math.min(1, (delta / 1000) * 12);
    for (const [id, a] of this.avatars) {
      const target = iso(a.tx, a.ty);
      const c = a.container;
      c.x += (target.x - c.x) * k;
      c.y += (target.y - c.y) * k;
      c.setDepth((a.tx + a.ty) * 10 + 7);
      if (id === this.bridge.you) a.label.setColor("#5ff0e0");
    }
    this.fadeOccluders();
  }

  // ------------------------------------------------------------------ map

  private buildMap(districtId: string) {
    for (const o of this.mapObjects) o.destroy();
    this.mapObjects = [];
    this.buildings = [];
    for (const a of this.avatars.values()) a.container.destroy();
    this.avatars.clear();

    const map = getMap(districtId);
    this.map = map;
    const zone = DISTRICTS_BY_ID.get(districtId)?.zone ?? "arcology";
    const pal = PALETTES[zone]!;

    const ground = this.add.graphics().setDepth(-10);
    this.mapObjects.push(ground);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const ch = tileAt(map, x, y);
        const c = iso(x, y);
        const color =
          ch === "=" ? pal.road : ch === "P" ? pal.park : ch === "~" ? pal.toxic : ch === "#" || ch === "X" ? pal.ground : pal.ground;
        const shade = 1 - hash(x, y, 1) * 0.08;
        ground.fillStyle(Phaser.Display.Color.ValueToColor(color).darken((1 - shade) * 100).color, 1);
        this.diamond(ground, c.x, c.y);
        ground.lineStyle(1, 0x000000, 0.25);
        this.diamondOutline(ground, c.x, c.y);
        if (ch === "=" && (x + y) % 3 === 0) {
          ground.fillStyle(0xe8d36a, 0.35);
          ground.fillRect(c.x - 6, c.y - 1, 12, 2);
        }
        if (ch === "~") {
          ground.fillStyle(0xc6ff4f, 0.12 + hash(x, y, 2) * 0.15);
          ground.fillEllipse(c.x, c.y, 18 + hash(x, y, 3) * 20, 6 + hash(x, y, 4) * 6);
        }

        if (ch === "#") {
          const edge = x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
          const g = edge ? this.wall(x, y, pal) : this.building(x, y, pal);
          this.mapObjects.push(g);
          if (!edge) this.buildings.push({ g, x, y });
        }
        else if (ch === "X") this.mapObjects.push(this.rubble(x, y, pal));
        else if (ch === "P" && hash(x, y, 5) > 0.45) this.mapObjects.push(this.tree(x, y));

        const door = doorAt(map, x, y);
        if (door) this.mapObjects.push(...this.door(x, y, door));
      }
    }

    // Keep the camera roughly inside the district.
    const pad = 300;
    const left = iso(0, map.height).x - pad;
    const right = iso(map.width, 0).x + pad;
    const bottom = iso(map.width, map.height).y + pad;
    this.cameras.main.setBounds(left, -pad - 200, right - left, bottom + pad + 200);
    const s = iso(map.spawn.x, map.spawn.y);
    this.cameras.main.centerOn(s.x, s.y);
  }

  private diamond(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w = TW, h = TH) {
    g.fillPoints(
      [
        new Phaser.Geom.Point(cx, cy - h / 2),
        new Phaser.Geom.Point(cx + w / 2, cy),
        new Phaser.Geom.Point(cx, cy + h / 2),
        new Phaser.Geom.Point(cx - w / 2, cy),
      ],
      true,
    );
  }

  private diamondOutline(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w = TW, h = TH) {
    g.strokePoints(
      [
        new Phaser.Geom.Point(cx, cy - h / 2),
        new Phaser.Geom.Point(cx + w / 2, cy),
        new Phaser.Geom.Point(cx, cy + h / 2),
        new Phaser.Geom.Point(cx - w / 2, cy),
      ],
      true,
    );
  }

  /** A box standing on a tile: top face plus the two visible side faces. */
  private prism(g: Phaser.GameObjects.Graphics, cx: number, cy: number, h: number, top: number, left: number, right: number) {
    const P = (x: number, y: number) => new Phaser.Geom.Point(x, y);
    const L = P(cx - TW / 2, cy);
    const B = P(cx, cy + TH / 2);
    const R = P(cx + TW / 2, cy);
    g.fillStyle(left, 1);
    g.fillPoints([L, B, P(B.x, B.y - h), P(L.x, L.y - h)], true);
    g.fillStyle(right, 1);
    g.fillPoints([B, R, P(R.x, R.y - h), P(B.x, B.y - h)], true);
    g.fillStyle(top, 1);
    g.fillPoints([P(cx, cy - TH / 2 - h), P(R.x, R.y - h), P(B.x, B.y - h), P(L.x, L.y - h)], true);
    g.lineStyle(1, 0x000000, 0.35);
    g.strokePoints([L, B, R, P(R.x, R.y - h), P(cx, cy - TH / 2 - h), P(L.x, L.y - h)], true);
    g.lineBetween(B.x, B.y, B.x, B.y - h);
  }

  private building(x: number, y: number, pal: Palette) {
    const c = iso(x, y);
    // Neighbouring tiles share a base height so blocks read as buildings, not random pillars.
    const base = hash(Math.floor(x / 3), Math.floor(y / 3), 9);
    const h = Math.round(pal.minH + (base * 0.8 + hash(x, y) * 0.2) * (pal.maxH - pal.minH));
    const g = this.add.graphics().setDepth((x + y) * 10 + 5);
    this.prism(g, c.x, c.y, h, pal.top, pal.left, pal.right);
    // Lit windows on both faces.
    for (let wy = 10; wy < h - 6; wy += 12) {
      for (let i = 0; i < 3; i++) {
        if (hash(x * 7 + i, y * 13 + wy) > 0.55) {
          g.fillStyle(pal.window, 0.55 + hash(x, y, wy + i) * 0.4);
          const t = (i + 0.7) / 3.4;
          g.fillRect(c.x - TW / 2 + t * (TW / 2) - 2, c.y + t * (TH / 2) - wy - 3, 4, 5);
        }
        if (hash(x * 11 + i, y * 3 + wy) > 0.6) {
          g.fillStyle(pal.window, 0.45 + hash(y, x, wy + i) * 0.4);
          const t = (i + 0.7) / 3.4;
          g.fillRect(c.x + t * (TW / 2) - 2, c.y + TH / 2 - t * (TH / 2) - wy - 3, 4, 5);
        }
      }
    }
    return g;
  }

  /** District edge: a low barrier instead of a skyscraper, so the border doesn't hide the map. */
  private wall(x: number, y: number, pal: Palette) {
    const c = iso(x, y);
    const g = this.add.graphics().setDepth((x + y) * 10 + 5);
    this.prism(g, c.x, c.y, 10, pal.left, pal.right, pal.right);
    g.fillStyle(pal.window, 0.5).fillRect(c.x - 2, c.y - 13, 4, 2);
    return g;
  }

  private rubble(x: number, y: number, pal: Palette) {
    const c = iso(x, y);
    const g = this.add.graphics().setDepth((x + y) * 10 + 5);
    const shade = Phaser.Display.Color.ValueToColor(pal.rubble);
    this.prism(g, c.x - 6, c.y + 2, 8 + hash(x, y) * 8, shade.clone().lighten(10).color, shade.color, shade.clone().darken(15).color);
    g.fillStyle(shade.clone().lighten(5).color, 1);
    g.fillTriangle(c.x + 4, c.y - 2, c.x + 18, c.y + 4, c.x + 6, c.y + 8);
    return g;
  }

  private tree(x: number, y: number) {
    const c = iso(x, y);
    const g = this.add.graphics().setDepth((x + y) * 10 + 5);
    g.fillStyle(0x000000, 0.25).fillEllipse(c.x, c.y + 2, 26, 10);
    g.fillStyle(0x4a3424, 1).fillRect(c.x - 2, c.y - 16, 4, 16);
    g.fillStyle(0x2f7a4a, 1).fillCircle(c.x, c.y - 24, 13);
    g.fillStyle(0x3d9a5e, 1).fillCircle(c.x - 4, c.y - 28, 7);
    return g;
  }

  private door(x: number, y: number, kind: DoorKind): Phaser.GameObjects.GameObject[] {
    const c = iso(x, y);
    const style = DOOR_STYLE[kind];
    const g = this.add.graphics().setDepth(-5);
    g.fillStyle(style.color, 0.35);
    this.diamond(g, c.x, c.y, TW - 8, TH - 4);
    g.lineStyle(2, style.color, 0.9);
    this.diamondOutline(g, c.x, c.y, TW - 8, TH - 4);
    const label = this.add
      .text(c.x, c.y - 34, style.label, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#ffffff",
        backgroundColor: "#000000aa",
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(100000);
    this.tweens.add({ targets: g, alpha: { from: 1, to: 0.55 }, duration: 900, yoyo: true, repeat: -1 });
    return [g, label];
  }

  /** Buildings standing between the camera and your avatar turn see-through. */
  private fadeOccluders() {
    const me = this.bridge.you ? this.avatars.get(this.bridge.you) : undefined;
    for (const b of this.buildings) {
      let alpha = 1;
      if (me) {
        const inFront = b.x + b.y > me.tx + me.ty && b.x >= me.tx - 0.5 && b.y >= me.ty - 0.5;
        const near = Math.abs(b.x - b.y - (me.tx - me.ty)) <= 3 && b.x + b.y - (me.tx + me.ty) <= 7;
        if (inFront && near) alpha = 0.28;
      }
      b.g.alpha += (alpha - b.g.alpha) * 0.2;
    }
  }

  // ------------------------------------------------------------------ avatars

  private syncAvatars() {
    const seen = new Set<string>();
    for (const p of this.bridge.players) {
      seen.add(p.id);
      let a = this.avatars.get(p.id);
      if (!a) {
        a = this.makeAvatar(p, p.id === this.bridge.you);
        this.avatars.set(p.id, a);
        if (p.id === this.bridge.you) {
          this.cameras.main.startFollow(a.container, true, 0.1, 0.1);
          this.bridge.onStop(Math.round(p.x), Math.round(p.y));
        }
      }
      a.tx = p.x;
      a.ty = p.y;
      if (p.id === this.bridge.you && a.wasMoving !== p.moving) {
        // Leaving a tile closes any open prompt; arriving checks for a door.
        this.bridge.onStop(p.moving ? -1 : Math.round(p.x), p.moving ? -1 : Math.round(p.y));
      }
      a.wasMoving = p.moving;
    }
    for (const [id, a] of this.avatars) {
      if (!seen.has(id)) {
        a.container.destroy();
        this.avatars.delete(id);
      }
    }
  }

  private makeAvatar(p: AvatarState, isYou: boolean): AvatarSprite {
    const pos = iso(p.x, p.y);
    const g = this.add.graphics();
    const body = isYou ? 0x36e0c8 : 0xff9f43;
    g.fillStyle(0x000000, 0.35).fillEllipse(0, 0, 22, 9);
    g.fillStyle(0x1b2230, 1).fillRoundedRect(-6, -14, 5, 14, 2).fillRoundedRect(1, -14, 5, 14, 2);
    g.fillStyle(body, 1).fillRoundedRect(-8, -32, 16, 20, 4);
    g.fillStyle(0xf0d2b6, 1).fillCircle(0, -38, 6);
    g.fillStyle(isYou ? 0x5ff0e0 : 0xffd38a, 1).fillRect(-5, -40, 10, 3);
    const label = this.add
      .text(0, -50, p.handle, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: isYou ? "#5ff0e0" : "#ffd38a",
        backgroundColor: "#000000aa",
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1);
    const container = this.add.container(pos.x, pos.y, [g, label]);
    return { container, label, tx: p.x, ty: p.y, wasMoving: p.moving };
  }

  // ------------------------------------------------------------------ cursor

  private drawCursor(p: Phaser.Input.Pointer) {
    this.cursor.clear();
    if (!this.map) return;
    const t = fromIso(p.worldX, p.worldY);
    if (t.x < 0 || t.y < 0 || t.x >= this.map.width || t.y >= this.map.height) return;
    const c = iso(t.x, t.y);
    const ok = isWalkable(this.map, t.x, t.y);
    this.cursor.lineStyle(2, ok ? 0x36e0c8 : 0xff6b7a, 0.8);
    this.diamondOutline(this.cursor, c.x, c.y);
    this.input.manager.canvas.style.cursor = ok ? "pointer" : "not-allowed";
  }

  private flashMarker(x: number, y: number) {
    const c = iso(x, y);
    this.marker.clear();
    this.marker.alpha = 1;
    this.marker.lineStyle(2, 0xffffff, 1);
    this.diamondOutline(this.marker, c.x, c.y, TW * 0.6, TH * 0.6);
    this.tweens.add({ targets: this.marker, alpha: 0, duration: 600 });
  }
}
