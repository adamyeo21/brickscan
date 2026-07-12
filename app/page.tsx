"use client";

import { useCallback, useMemo, useRef, useState } from "react";

// ---------- Types mirrored from the API ----------

interface Listing {
  id: string;
  title: string;
  priceRaw: string;
  price: number | null;
  url: string;
  imageUrl: string | null;
  seller: string | null;
  condition: string | null;
  setNos: string[];
}

interface PriceGuide {
  avg: number | null;
  min: number | null;
  max: number | null;
  qtySold: number | null;
  currency: string;
}

interface SetPrices {
  setNo: string;
  name: string | null;
  imageUrl: string | null;
  yearReleased: number | null;
  newSold: PriceGuide | null;
  usedSold: PriceGuide | null;
  currency: string;
  error?: string;
}

interface PovResult {
  setNo: string;
  condition: "N" | "U";
  totalValue: number;
  pricedLots: number;
  totalLots: number;
  minifigValue: number;
  minifigShare: number;
  currency: string;
  apiCallsUsed: number;
  topItems: { no: string; name: string; type: string; qty: number; value: number }[];
}

interface RowState {
  setNo: string; // current (possibly user-edited) set number, "" if none
  prices: SetPrices | null;
  loading: boolean;
  pov: PovResult | null;
  povLoading: boolean;
  error: string | null;
}

// ---------- Helpers ----------

function fmt(n: number | null | undefined, currency = "SGD"): string {
  if (n == null) return "—";
  return `${currency === "SGD" ? "S$" : currency + " "}${n.toFixed(2)}`;
}

// deal ratio = asking / BrickLink used sold avg. Lower is better.
function dealClass(ratio: number | null): "good" | "mid" | "bad" | "na" {
  if (ratio == null) return "na";
  if (ratio <= 0.6) return "good";
  if (ratio <= 0.85) return "mid";
  return "bad";
}

function dealLabel(ratio: number | null): string {
  if (ratio == null) return "no data";
  return `${Math.round(ratio * 100)}% of BL used`;
}

// ---------- Page ----------

export default function Home() {
  const [query, setQuery] = useState("lego");
  const [listings, setListings] = useState<Listing[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const priceQueue = useRef<Promise<void>>(Promise.resolve());

  const updateRow = useCallback((id: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const fetchPrices = useCallback(
    (listingId: string, setNo: string) => {
      if (!/^\d{4,7}(-\d)?$/.test(setNo)) return;
      updateRow(listingId, { loading: true, error: null, prices: null, pov: null });
      // serialize BrickLink lookups to be gentle on the API
      priceQueue.current = priceQueue.current.then(async () => {
        try {
          const res = await fetch(`/api/price?set=${encodeURIComponent(setNo)}`);
          const data: SetPrices & { error?: string } = await res.json();
          if (!res.ok) throw new Error(data.error || "lookup failed");
          updateRow(listingId, { prices: data, loading: false, error: data.error || null });
        } catch (e: any) {
          updateRow(listingId, { loading: false, error: e.message });
        }
      });
    },
    [updateRow]
  );

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchError(null);
    setStatus("Searching Carousell…");
    setListings([]);
    setRows({});
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);
      const found: Listing[] = data.listings || [];
      setListings(found);
      setStatus(
        found.length === 0
          ? "No listings found — try a different search term."
          : `${found.length} listings · comparing sets against BrickLink…`
      );

      const initial: Record<string, RowState> = {};
      for (const l of found) {
        initial[l.id] = {
          setNo: l.setNos[0] || "",
          prices: null,
          loading: false,
          pov: null,
          povLoading: false,
          error: null,
        };
      }
      setRows(initial);

      // auto-fetch prices for listings with a detected set number
      for (const l of found) {
        if (l.setNos[0]) fetchPrices(l.id, l.setNos[0]);
      }
    } catch (e: any) {
      setSearchError(e.message);
      setStatus(null);
    } finally {
      setSearching(false);
    }
  }, [query, searching, fetchPrices]);

  const fetchPov = useCallback(
    (listingId: string, setNo: string) => {
      updateRow(listingId, { povLoading: true });
      fetch(`/api/pov?set=${encodeURIComponent(setNo)}&cond=U`)
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "part-out calc failed");
          updateRow(listingId, { pov: data, povLoading: false });
        })
        .catch((e) => {
          updateRow(listingId, { povLoading: false, error: e.message });
        });
    },
    [updateRow]
  );

  // sort: best deals first, no-data rows last, preserve found order otherwise
  const sorted = useMemo(() => {
    return [...listings].sort((a, b) => {
      const ra = ratioFor(a, rows[a.id]);
      const rb = ratioFor(b, rows[b.id]);
      if (ra == null && rb == null) return 0;
      if (ra == null) return 1;
      if (rb == null) return -1;
      return ra - rb;
    });
  }, [listings, rows]);

  return (
    <main className="wrap">
      <header className="masthead">
        <h1>
          <span className="stud" aria-hidden />
          BrickScan
        </h1>
        <span className="sub">Carousell.sg → BrickLink resale comparison</span>
      </header>

      <div className="searchbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          placeholder='Search Carousell — e.g. "lego star wars" or "lego 75324"'
          aria-label="Carousell search query"
        />
        <button onClick={runSearch} disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
      </div>
      <p className="hint">
        Set numbers are auto-detected from listing titles — edit the box on any row if detection
        got it wrong. Deal % compares asking price to the BrickLink 6-month used sold average.
      </p>

      {searchError && <div className="error">{searchError}</div>}
      {status && !searchError && <div className="statusline">{status}</div>}

      <div className="rows">
        {sorted.map((l) => {
          const r = rows[l.id];
          if (!r) return null;
          const ratio = ratioFor(l, r);
          const cls = dealClass(ratio);
          return (
            <article key={l.id} className={`row ${cls === "good" ? "deal" : ""}`}>
              {l.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="thumb" src={l.imageUrl} alt="" loading="lazy" />
              ) : (
                <div className="thumb placeholder">no photo</div>
              )}

              <div className="body">
                <p className="title">
                  <a href={l.url} target="_blank" rel="noopener noreferrer">
                    {l.title}
                  </a>
                </p>
                <p className="meta">
                  {l.seller ? `@${l.seller} · ` : ""}
                  {l.condition || ""}
                </p>

                <div className="setline">
                  <label htmlFor={`set-${l.id}`}>Set #</label>
                  <input
                    id={`set-${l.id}`}
                    value={r.setNo}
                    placeholder="e.g. 75324"
                    onChange={(e) => updateRow(l.id, { setNo: e.target.value.trim() })}
                    onKeyDown={(e) => e.key === "Enter" && fetchPrices(l.id, r.setNo)}
                    onBlur={() => {
                      if (r.setNo && r.prices?.setNo.replace(/-\d$/, "") !== r.setNo) {
                        fetchPrices(l.id, r.setNo);
                      }
                    }}
                  />
                  {r.prices?.name && (
                    <span className="setname">
                      {r.prices.name}
                      {r.prices.yearReleased ? ` (${r.prices.yearReleased})` : ""}
                    </span>
                  )}
                  {l.setNos.length > 1 && (
                    <span className="setname">candidates: {l.setNos.join(", ")}</span>
                  )}
                </div>

                {r.loading && <p className="skel">Checking BrickLink…</p>}
                {r.error && <p className="skel">{r.error}</p>}

                {r.prices && !r.prices.error && (
                  <div className="pricegrid">
                    <div className="cell">
                      <b>BL used avg</b>
                      {fmt(r.prices.usedSold?.avg)}
                    </div>
                    <div className="cell">
                      <b>BL new avg</b>
                      {fmt(r.prices.newSold?.avg)}
                    </div>
                    <div className="cell">
                      <b>Used sold /6mo</b>
                      {r.prices.usedSold?.qtySold ?? "—"}
                    </div>
                    <div className="cell">
                      <b>Part-out</b>
                      {r.pov ? (
                        fmt(r.pov.totalValue)
                      ) : (
                        <button
                          className="povbtn"
                          disabled={r.povLoading}
                          onClick={() => fetchPov(l.id, r.setNo)}
                          title="Computes value of every part — uses many BrickLink API calls, cached 7 days"
                        >
                          {r.povLoading ? "computing…" : "compute"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="ask">
                <div className="price">{l.price != null ? fmt(l.price) : l.priceRaw || "—"}</div>
                <span className={`chip ${cls}`}>{dealLabel(ratio)}</span>
              </div>

              {r.pov && (
                <div className="povbox">
                  Part-out (used): <b>{fmt(r.pov.totalValue)}</b> across {r.pov.pricedLots}/
                  {r.pov.totalLots} priced lots.{" "}
                  {r.pov.minifigShare >= 0.4 && (
                    <span className="warn">
                      ⚠ {Math.round(r.pov.minifigShare * 100)}% of value is in minifigs — verify
                      they're present before buying.
                    </span>
                  )}
                  <ul>
                    {r.pov.topItems.slice(0, 5).map((t) => (
                      <li key={t.no}>
                        {t.type === "MINIFIG" ? "🧍 " : ""}
                        {t.name} ×{t.qty} — {fmt(t.value)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}

function ratioFor(l: Listing, r?: RowState): number | null {
  if (!r?.prices || l.price == null) return null;
  const usedAvg = r.prices.usedSold?.avg;
  if (usedAvg == null || usedAvg <= 0) return null;
  return l.price / usedAvg;
}
