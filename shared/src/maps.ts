/**
 * District tile maps (Phase 2 placeholder layouts).
 *
 * Legend:
 *   .  ground / sidewalk      =  road            P  park
 *   ~  toxic ground           #  building        X  rubble (blocked)
 *   S  spawn point
 *   M  exchange terminal (market)      B  black market den
 *   F  factory (industry)              T  transit gate (travel and hauling)
 */
export type DoorKind = "exchange" | "blackmarket" | "factory" | "transit";

export interface DistrictMap {
  districtId: string;
  width: number;
  height: number;
  rows: readonly string[];
  spawn: { x: number; y: number };
}

export interface Point {
  x: number;
  y: number;
}

const RAW: Record<string, readonly string[]> = {
  "arc-helix": [
    "####################",
    "#..................#",
    "#.####.######.####.#",
    "#.####.######.####.#",
    "#.####.######.####.#",
    "#.##M#.###F##.####.#",
    "#..................#",
    "#==================#",
    "#==================#",
    "#........S.........#",
    "#.PPP.########.PPP.#",
    "#.PPP.########.PPP.#",
    "#.PPP.########.PPP.#",
    "#.....########.....#",
    "#..................#",
    "#==================#",
    "#==================#",
    "#..................#",
    "#........T.........#",
    "####################",
  ],
  "spr-rustline": [
    "####################",
    "#...T..............#",
    "#.###..####.X..###.#",
    "#.###..####....###.#",
    "#.#B#..####..X.###.#",
    "#......####........#",
    "#==================#",
    "#..X...........X...#",
    "#.####.##.S..####..#",
    "#.####.##....####..#",
    "#.####.##.X..####..#",
    "#......##.......X..#",
    "#==================#",
    "#...X..........X...#",
    "#.###M#.####.#####.#",
    "#.#####.####.#####.#",
    "#.#####.####.#####.#",
    "#..................#",
    "#..............T...#",
    "####################",
  ],
  "wld-ashfields": [
    "####################",
    "#~~~....X.....~~~~~#",
    "#~~..XX.....X...~~~#",
    "#~...XX..##.....~~.#",
    "#....X...##..X.....#",
    "#..X.....S.....X...#",
    "#.....X.......~~...#",
    "#..~~~....XX..~~~..#",
    "#.~~~~....XX...~~..#",
    "#..~~...........X..#",
    "#......X..#M#......#",
    "#..X......###..X...#",
    "#.....~~~.......X..#",
    "#..X..~~~~...X.....#",
    "#.....~~~..........#",
    "#.X.........XX..~~.#",
    "#....XX.........~~~#",
    "#~...........X..~~~#",
    "#~~...T..........~~#",
    "####################",
  ],
};

function build(districtId: string, rows: readonly string[]): DistrictMap {
  let spawn: Point | undefined;
  rows.forEach((row, y) => {
    const x = row.indexOf("S");
    if (x >= 0) spawn = { x, y };
  });
  if (!spawn) throw new Error(`Map ${districtId} has no spawn`);
  return { districtId, width: rows[0]!.length, height: rows.length, rows, spawn };
}

export const MAPS: ReadonlyMap<string, DistrictMap> = new Map(Object.entries(RAW).map(([id, rows]) => [id, build(id, rows)]));

export function getMap(districtId: string): DistrictMap {
  const m = MAPS.get(districtId);
  if (!m) throw new Error(`No map for district ${districtId}`);
  return m;
}

export function tileAt(map: DistrictMap, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return "#";
  return map.rows[y]![x]!;
}

const BLOCKED = new Set(["#", "X"]);

export function isWalkable(map: DistrictMap, x: number, y: number): boolean {
  return !BLOCKED.has(tileAt(map, x, y));
}

const DOORS: Record<string, DoorKind> = { M: "exchange", B: "blackmarket", F: "factory", T: "transit" };

export function doorAt(map: DistrictMap, x: number, y: number): DoorKind | null {
  return DOORS[tileAt(map, x, y)] ?? null;
}

export function doors(map: DistrictMap): (Point & { kind: DoorKind })[] {
  const out: (Point & { kind: DoorKind })[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const kind = doorAt(map, x, y);
      if (kind) out.push({ x, y, kind });
    }
  }
  return out;
}

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * A* over walkable tiles, 8 directions, no cutting corners past walls.
 * Returns the tiles to walk through (excluding `from`), or null if unreachable.
 */
export function findPath(map: DistrictMap, from: Point, to: Point, maxNodes = 5000): Point[] | null {
  if (!isWalkable(map, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const key = (x: number, y: number) => y * map.width + x;
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - to.x);
    const dy = Math.abs(y - to.y);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  const g = new Map<number, number>([[key(from.x, from.y), 0]]);
  const came = new Map<number, number>();
  const open: { k: number; x: number; y: number; f: number }[] = [{ k: key(from.x, from.y), x: from.x, y: from.y, f: h(from.x, from.y) }];
  const closed = new Set<number>();

  while (open.length && closed.size < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
    const cur = open.splice(bi, 1)[0]!;
    if (closed.has(cur.k)) continue;
    if (cur.x === to.x && cur.y === to.y) {
      const path: Point[] = [];
      let k: number | undefined = cur.k;
      while (k !== undefined && k !== key(from.x, from.y)) {
        path.push({ x: k % map.width, y: Math.floor(k / map.width) });
        k = came.get(k);
      }
      return path.reverse();
    }
    closed.add(cur.k);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!isWalkable(map, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isWalkable(map, cur.x + dx, cur.y) || !isWalkable(map, cur.x, cur.y + dy))) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const ng = g.get(cur.k)! + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, cur.k);
        open.push({ k: nk, x: nx, y: ny, f: ng + h(nx, ny) });
      }
    }
  }
  return null;
}
