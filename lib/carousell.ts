// Carousell has no public API. This client makes a small number of
// polite, on-demand requests (one per user search) and parses results.
// Two strategies, tried in order:
//   1. The JSON search endpoint used by their own web frontend
//   2. Fetching the search results page and parsing embedded JSON state
// Both can break if Carousell changes things — errors surface in the UI
// instead of failing silently.

export interface CarousellListing {
  id: string;
  title: string;
  priceRaw: string;
  price: number | null; // SGD
  url: string;
  imageUrl: string | null;
  seller: string | null;
  condition: string | null;
  setNos: string[]; // extracted LEGO set number candidates
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Broader, more browser-like header set. Sites behind Cloudflare/Akamai often
// gate on the presence of sec-ch-ua / sec-fetch-* headers, not just UA string.
const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-SG,en;q=0.9",
  Referer: "https://www.carousell.sg/",
  Origin: "https://www.carousell.sg",
  "sec-ch-ua": '"Chromium";v="126", "Not.A/Brand";v="24", "Google Chrome";v="126"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const HTML_HEADERS: Record<string, string> = {
  ...COMMON_HEADERS,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export async function searchCarousell(query: string, limit = 40): Promise<CarousellListing[]> {
  let lastErr: Error | null = null;

  // Cheap attempts first — in case Carousell ever loosens up, this avoids
  // spinning up a browser unnecessarily. Expected to fail with 403 for now.
  try {
    const viaApi = await searchViaApi(query, limit);
    if (viaApi.length > 0) return viaApi;
  } catch (e: any) {
    lastErr = e;
  }

  try {
    const viaHtml = await searchViaHtml(query, limit);
    if (viaHtml.length > 0) return viaHtml;
  } catch (e: any) {
    lastErr = e;
  }

  // Real fix: render with a headless browser, which passes the
  // fingerprint check plain fetch() cannot.
  try {
    const viaBrowser = await searchViaBrowser(query, limit);
    if (viaBrowser.length > 0) return viaBrowser;
  } catch (e: any) {
    lastErr = e;
  }

  if (lastErr) {
    throw new Error(`Carousell fetch failed (${lastErr.message}).`);
  }
  return [];
}

// ---------- Strategy 3: headless browser render ----------

async function searchViaBrowser(query: string, limit: number): Promise<CarousellListing[]> {
  const url = `https://www.carousell.sg/search/${encodeURIComponent(query)}/?sort_by=time_created`;
  const { launchBrowser } = await import("./browser");
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-SG,en;q=0.9" });
    await page.setViewport({ width: 1280, height: 1800 });

    const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
    if (!response) throw new Error("no response from page.goto");
    if (response.status() >= 400) throw new Error(`render HTTP ${response.status()}`);

    // let any client-side rendering settle
    await new Promise((resolve) => setTimeout(resolve, 800));

    const html = await page.content();
    const listings = parseListingsFromHtml(html, limit);

    if (listings.length === 0) {
      // fall back to DOM scraping if embedded JSON pattern isn't found —
      // grabs listing links + nearby text directly from the rendered page
      const domListings = await page.evaluate(() => {
        const out: { id: string; title: string; priceRaw: string; imageUrl: string | null }[] = [];
        const anchors = Array.from(document.querySelectorAll('a[href*="/p/"]'));
        for (const a of anchors) {
          const href = a.getAttribute("href") || "";
          const m = href.match(/\/p\/[^/]*?(\d{6,})/) || href.match(/-(\d{6,})(?:$|\?)/);
          const id = m ? m[1] : null;
          const text = (a.textContent || "").trim();
          const img = a.querySelector("img");
          if (id && text && text.length > 3) {
            out.push({
              id,
              title: text,
              priceRaw: text,
              imageUrl: img?.getAttribute("src") || null,
            });
          }
        }
        return out;
      });
      for (const d of domListings.slice(0, limit)) {
        listings.push(
          buildListing({
            id: d.id,
            title: d.title,
            priceRaw: extractPriceToken(d.title),
            imageUrl: d.imageUrl,
            seller: null,
            condition: null,
          })
        );
      }
    }

    return listings;
  } finally {
    await browser.close();
  }
}

function extractPriceToken(text: string): string {
  const m = text.match(/S?\$\s?[\d,]+(?:\.\d{1,2})?/);
  return m ? m[0] : "";
}

function parseListingsFromHtml(html: string, limit: number): CarousellListing[] {
  const listings: CarousellListing[] = [];
  const scriptJsonMatches = html.match(/<script[^>]*>\s*window\.initialState\s*=\s*({[\s\S]*?})\s*<\/script>/);
  let stateObj: any = null;
  if (scriptJsonMatches) {
    try {
      stateObj = JSON.parse(scriptJsonMatches[1]);
    } catch {
      /* fallthrough */
    }
  }
  if (!stateObj) {
    const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextData) {
      try {
        stateObj = JSON.parse(nextData[1]);
      } catch {
        /* fallthrough */
      }
    }
  }
  if (stateObj) {
    const found: any[] = [];
    walkForListings(stateObj, found, 0);
    for (const l of found.slice(0, limit)) {
      const id = String(l.id ?? l.listingID ?? "");
      const title = l.title ?? "";
      if (!id || !title) continue;
      const priceRaw = l.price ?? l.formattedPrice ?? "";
      const photo = l?.photos?.[0]?.thumbnailUrl || l?.photoUrls?.[0] || null;
      listings.push(
        buildListing({
          id,
          title,
          priceRaw: String(priceRaw),
          imageUrl: photo,
          seller: l?.seller?.username ?? null,
          condition: null,
        })
      );
    }
  }
  return listings;
}

// ---------- Strategy 1: JSON search endpoint ----------

async function searchViaApi(query: string, limit: number): Promise<CarousellListing[]> {
  const res = await fetch("https://www.carousell.sg/api-service/filter/cf/4.0/search/", {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      bestMatchEnabled: true,
      canChangeKeyword: false,
      count: limit,
      countryCode: "SG",
      countryId: "1880251",
      filters: [],
      locale: "en",
      prefill: {},
      query,
      sortParam: { fieldName: "time_created" },
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const json = await res.json();

  const results = json?.data?.results || [];
  const listings: CarousellListing[] = [];
  for (const r of results) {
    const lc = r?.listingCard;
    if (!lc) continue;
    const title = extractFlexText(lc, ["header", "title"]) || lc.title || "";
    const priceRaw = extractFlexText(lc, ["price"]) || lc.price || "";
    const condition = extractFlexText(lc, ["condition"]) || null;
    const id = String(lc.id ?? "");
    if (!id) continue;
    const photo =
      lc?.media?.[0]?.photoItem?.url || lc?.photoUrls?.[0] || lc?.thumbnailUrl || null;

    listings.push(buildListing({ id, title, priceRaw, imageUrl: photo, seller: lc?.seller?.username ?? null, condition }));
  }
  return listings;
}

// listingCard fields vary; text often lives in "belowFold" flex components
function extractFlexText(lc: any, keyHints: string[]): string | null {
  const pools = [lc?.belowFold, lc?.aboveFold].filter(Boolean);
  for (const pool of pools) {
    for (const comp of pool) {
      const name = (comp?.component || "").toLowerCase();
      if (keyHints.some((h) => name.includes(h))) {
        const t = comp?.stringContent ?? comp?.content?.stringContent ?? null;
        if (t) return String(t);
      }
    }
  }
  return null;
}

// ---------- Strategy 2: HTML page + embedded state ----------

async function searchViaHtml(query: string, limit: number): Promise<CarousellListing[]> {
  const url = `https://www.carousell.sg/search/${encodeURIComponent(query)}?addRecent=false&canChangeKeyword=false&includeSuggestions=false&sort_by=time_created`;
  const res = await fetch(url, { headers: HTML_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`HTML HTTP ${res.status}`);
  const html = await res.text();
  return parseListingsFromHtml(html, limit);
}

function walkForListings(node: any, out: any[], depth: number) {
  if (!node || depth > 8 || out.length > 200) return;
  if (Array.isArray(node)) {
    for (const item of node) walkForListings(item, out, depth + 1);
    return;
  }
  if (typeof node === "object") {
    if (node.title && (node.price || node.formattedPrice) && (node.id || node.listingID)) {
      out.push(node);
      return;
    }
    for (const k of Object.keys(node)) walkForListings(node[k], out, depth + 1);
  }
}

// ---------- Shared ----------

function buildListing(p: {
  id: string;
  title: string;
  priceRaw: string;
  imageUrl: string | null;
  seller: string | null;
  condition: string | null;
}): CarousellListing {
  return {
    id: p.id,
    title: p.title,
    priceRaw: p.priceRaw,
    price: parsePrice(p.priceRaw),
    url: `https://www.carousell.sg/p/${p.id}`,
    imageUrl: p.imageUrl,
    seller: p.seller,
    condition: p.condition,
    setNos: extractSetNumbers(p.title),
  };
}

function parsePrice(raw: string): number | null {
  if (!raw) return null;
  const m = String(raw).replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? parseFloat(m[1]) : null;
}

// Extract candidate LEGO set numbers from a listing title.
// Heuristics: 4–7 digit numbers, excluding obvious years and piece counts.
export function extractSetNumbers(title: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\b(\d{4,7})(?:-\d)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    const n = m[1];
    const asNum = parseInt(n, 10);
    // Skip years 1950–2035 unless clearly a set context is impossible to tell —
    // most modern sets are 5 digits, so 4-digit year-like numbers are excluded.
    if (n.length === 4 && asNum >= 1950 && asNum <= 2035) continue;
    // Skip numbers immediately followed by "pcs"/"pieces" in the title
    const tail = title.slice(m.index + n.length, m.index + n.length + 8).toLowerCase();
    if (/^\s*(pcs|pieces|pc\b)/.test(tail)) continue;
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}
