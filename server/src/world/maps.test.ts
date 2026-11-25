import { describe, expect, it } from "vitest";
import { DISTRICTS, MAPS, doors, findPath, getMap, isWalkable } from "@replicant/shared";

describe("district maps", () => {
  it("has a map for every district", () => {
    for (const d of DISTRICTS) expect(MAPS.has(d.id)).toBe(true);
  });

  for (const [id, map] of MAPS) {
    describe(id, () => {
      it("is rectangular with a walled border", () => {
        for (const row of map.rows) expect(row.length).toBe(map.width);
        expect(map.rows[0]).toMatch(/^#+$/);
        expect(map.rows[map.height - 1]).toMatch(/^#+$/);
        for (const row of map.rows) {
          expect(row[0]).toBe("#");
          expect(row[row.length - 1]).toBe("#");
        }
      });

      it("has an exchange and a transit gate, all reachable from spawn", () => {
        const ds = doors(map);
        expect(ds.some((d) => d.kind === "exchange" || d.kind === "blackmarket")).toBe(true);
        expect(ds.some((d) => d.kind === "transit")).toBe(true);
        for (const d of ds) expect(findPath(map, map.spawn, d), `${d.kind} at ${d.x},${d.y}`).not.toBeNull();
      });
    });
  }

  it("matches district features: factory only where NPC facilities exist", () => {
    for (const d of DISTRICTS) {
      const hasFactory = doors(getMap(d.id)).some((x) => x.kind === "factory");
      expect(hasFactory).toBe(d.npcFacilities);
      const hasBlack = doors(getMap(d.id)).some((x) => x.kind === "blackmarket");
      expect(hasBlack).toBe(d.blackMarket);
    }
  });
});

describe("findPath", () => {
  const map = getMap("arc-helix");

  it("returns an empty path when already there", () => {
    expect(findPath(map, map.spawn, map.spawn)).toEqual([]);
  });

  it("never steps on a blocked tile or cuts a corner", () => {
    const path = findPath(map, map.spawn, { x: 4, y: 5 })!;
    expect(path.at(-1)).toEqual({ x: 4, y: 5 });
    let prev = map.spawn;
    for (const p of path) {
      expect(isWalkable(map, p.x, p.y)).toBe(true);
      expect(Math.abs(p.x - prev.x) <= 1 && Math.abs(p.y - prev.y) <= 1).toBe(true);
      if (p.x !== prev.x && p.y !== prev.y) {
        expect(isWalkable(map, p.x, prev.y) && isWalkable(map, prev.x, p.y)).toBe(true);
      }
      prev = p;
    }
  });

  it("refuses walls and out-of-map targets", () => {
    expect(findPath(map, map.spawn, { x: 0, y: 0 })).toBeNull();
    expect(findPath(map, map.spawn, { x: 3, y: 3 })).toBeNull();
    expect(findPath(map, map.spawn, { x: 99, y: 99 })).toBeNull();
  });
});
