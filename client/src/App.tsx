import { useState } from "react";
import { DISTRICTS, ITEMS, RECIPES, getItem } from "@replicant/shared";

/**
 * Phase 1 placeholder: browse the starter catalog and recipes.
 * Next: wallet, inventory, order book and crafting panels wired to the server.
 */
export function App() {
  const [districtId, setDistrictId] = useState(DISTRICTS[0]!.id);
  const district = DISTRICTS.find((d) => d.id === districtId)!;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1>Sprawlborn — economy prototype</h1>

      <section>
        <h2>District</h2>
        <select value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
          {DISTRICTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.zone})
            </option>
          ))}
        </select>
        <p>
          Salvage here: {district.salvage.map((s) => getItem(s.itemId).name).join(", ")}
        </p>
      </section>

      <section>
        <h2>Items ({ITEMS.length})</h2>
        <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th>Item</th>
              <th>Category</th>
              <th>Tier</th>
              <th>Volume</th>
              <th>Base value (cr)</th>
            </tr>
          </thead>
          <tbody>
            {ITEMS.map((i) => (
              <tr key={i.id} style={{ borderTop: "1px solid #ddd" }}>
                <td>
                  {i.name}
                  {i.contraband ? " (contraband)" : ""}
                </td>
                <td>{i.category}</td>
                <td>{i.tier}</td>
                <td>{i.volume}</td>
                <td>{i.baseValue.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Recipes ({RECIPES.length})</h2>
        <ul>
          {RECIPES.map((r) => (
            <li key={r.id}>
              <strong>{r.facility}</strong>:{" "}
              {r.inputs.map((x) => `${x.qty}× ${getItem(x.itemId).name}`).join(" + ")} →{" "}
              {r.outputs.map((x) => `${x.qty}× ${getItem(x.itemId).name}`).join(" + ")}
              {r.baseYield ? ` (${Math.round(r.baseYield * 100)}% yield)` : ""}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
