import crypto from "crypto";
import { cacheGet, cacheSet } from "./cache";

const API_BASE = "https://api.bricklink.com/api/store/v1";
const CURRENCY = process.env.BL_CURRENCY || "SGD";

// ---------- OAuth 1.0a (HMAC-SHA1) ----------

function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function oauthHeader(method: string, url: string, queryParams: Record<string, string>) {
  const consumerKey = process.env.BL_CONSUMER_KEY || "";
  const consumerSecret = process.env.BL_CONSUMER_SECRET || "";
  const tokenValue = process.env.BL_TOKEN_VALUE || "";
  const tokenSecret = process.env.BL_TOKEN_SECRET || "";

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_token: tokenValue,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_version: "1.0",
  };

  const allParams: Record<string, string> = { ...queryParams, ...oauthParams };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(allParams[k])}`)
    .join("&");

  const baseString = [method.toUpperCase(), pctEncode(url), pctEncode(paramString)].join("&");
  const signingKey = `${pctEncode(consumerSecret)}&${pctEncode(tokenSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams = { ...oauthParams, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${pctEncode(k)}="${pctEncode(headerParams[k as keyof typeof headerParams])}"`)
      .join(", ")
  );
}

async function blFetch(path: string, params: Record<string, string> = {}) {
  const url = `${API_BASE}${path}`;
  const qs = new URLSearchParams(params).toString();
  const fullUrl = qs ? `${url}?${qs}` : url;

  const res = await fetch(fullUrl, {
    headers: { Authorization: oauthHeader("GET", url, params) },
    // BrickLink data moves slowly; let fetch cache too
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`BrickLink HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json?.meta?.code && json.meta.code >= 300) {
    throw new Error(`BrickLink API: ${json.meta.message || json.meta.code} ${json.meta.description || ""}`);
  }
  return json.data;
}

// ---------- Price guide ----------

export interface PriceGuide {
  avg: number | null; // 6-month sold average
  min: number | null;
  max: number | null;
  qtySold: number | null; // times sold in 6 months (unit qty)
  currency: string;
}

async function priceGuide(
  itemType: "SET" | "MINIFIG" | "PART",
  itemNo: string,
  cond: "N" | "U",
  guideType: "sold" | "stock" = "sold"
): Promise<PriceGuide> {
  const key = `pg:${itemType}:${itemNo}:${cond}:${guideType}:${CURRENCY}`;
  const cached = cacheGet<PriceGuide>(key);
  if (cached) return cached;

  const data = await blFetch(`/items/${itemType}/${encodeURIComponent(itemNo)}/price`, {
    guide_type: guideType,
    new_or_used: cond,
    currency_code: CURRENCY,
  });

  const out: PriceGuide = {
    avg: data?.avg_price != null ? parseFloat(data.avg_price) : null,
    min: data?.min_price != null ? parseFloat(data.min_price) : null,
    max: data?.max_price != null ? parseFloat(data.max_price) : null,
    qtySold: data?.total_quantity ?? null,
    currency: data?.currency_code || CURRENCY,
  };
  cacheSet(key, out, 7 * 24 * 3600 * 1000); // 7 days
  return out;
}

export interface SetPrices {
  setNo: string;
  name: string | null;
  imageUrl: string | null;
  yearReleased: number | null;
  newSold: PriceGuide | null;
  usedSold: PriceGuide | null;
  currency: string;
  error?: string;
}

export async function getSetPrices(setNoRaw: string): Promise<SetPrices> {
  // BrickLink set numbers require a variant suffix, default "-1"
  const setNo = setNoRaw.includes("-") ? setNoRaw : `${setNoRaw}-1`;

  const key = `set:${setNo}:${CURRENCY}`;
  const cached = cacheGet<SetPrices>(key);
  if (cached) return cached;

  let name: string | null = null;
  let imageUrl: string | null = null;
  let yearReleased: number | null = null;

  try {
    const item = await blFetch(`/items/SET/${encodeURIComponent(setNo)}`);
    name = item?.name ? decodeHtml(item.name) : null;
    imageUrl = item?.image_url
      ? item.image_url.startsWith("//")
        ? "https:" + item.image_url
        : item.image_url
      : null;
    yearReleased = item?.year_released ?? null;
  } catch (e: any) {
    const out: SetPrices = {
      setNo,
      name: null,
      imageUrl: null,
      yearReleased: null,
      newSold: null,
      usedSold: null,
      currency: CURRENCY,
      error: `Set ${setNo} not found on BrickLink`,
    };
    return out; // don't cache failures long-term
  }

  const [newSold, usedSold] = await Promise.all([
    priceGuide("SET", setNo, "N").catch(() => null),
    priceGuide("SET", setNo, "U").catch(() => null),
  ]);

  const out: SetPrices = { setNo, name, imageUrl, yearReleased, newSold, usedSold, currency: CURRENCY };
  cacheSet(key, out, 7 * 24 * 3600 * 1000);
  return out;
}

// ---------- Part-out value (on demand — expensive!) ----------

export interface PovResult {
  setNo: string;
  condition: "N" | "U";
  totalValue: number;
  pricedLots: number;
  totalLots: number;
  minifigValue: number;
  minifigShare: number; // 0..1
  currency: string;
  apiCallsUsed: number;
  topItems: { no: string; name: string; type: string; qty: number; value: number }[];
}

export async function getPartOutValue(setNoRaw: string, cond: "N" | "U"): Promise<PovResult> {
  const setNo = setNoRaw.includes("-") ? setNoRaw : `${setNoRaw}-1`;
  const key = `pov:${setNo}:${cond}:${CURRENCY}`;
  const cached = cacheGet<PovResult>(key);
  if (cached) return cached;

  // 1 call: get the subset (all parts/minifigs in the set)
  const subsets = await blFetch(`/items/SET/${encodeURIComponent(setNo)}/subsets`, {
    break_minifigs: "false",
  });

  type Lot = { no: string; name: string; type: string; qty: number };
  const lots: Lot[] = [];
  for (const group of subsets || []) {
    for (const entry of group?.entries || []) {
      const item = entry?.item;
      if (!item) continue;
      if (entry.is_counterpart || entry.is_alternate) continue;
      const qty = (entry.quantity || 0) + (entry.extra_quantity || 0);
      if (qty <= 0) continue;
      lots.push({ no: item.no, name: decodeHtml(item.name || ""), type: item.type, qty });
    }
  }

  // Price each lot with limited concurrency. One API call per unique item.
  let apiCalls = 1;
  let totalValue = 0;
  let minifigValue = 0;
  let pricedLots = 0;
  const valued: { no: string; name: string; type: string; qty: number; value: number }[] = [];

  const CONCURRENCY = 8;
  let idx = 0;
  async function worker() {
    while (idx < lots.length) {
      const lot = lots[idx++];
      try {
        const pg = await priceGuide(lot.type as any, lot.no, cond);
        apiCalls++;
        if (pg.avg != null) {
          const v = pg.avg * lot.qty;
          totalValue += v;
          if (lot.type === "MINIFIG") minifigValue += v;
          pricedLots++;
          valued.push({ ...lot, value: v });
        }
      } catch {
        // unpriced lot — skip
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  valued.sort((a, b) => b.value - a.value);

  const out: PovResult = {
    setNo,
    condition: cond,
    totalValue: round2(totalValue),
    pricedLots,
    totalLots: lots.length,
    minifigValue: round2(minifigValue),
    minifigShare: totalValue > 0 ? minifigValue / totalValue : 0,
    currency: CURRENCY,
    apiCallsUsed: apiCalls,
    topItems: valued.slice(0, 8).map((v) => ({ ...v, value: round2(v.value) })),
  };
  cacheSet(key, out, 7 * 24 * 3600 * 1000);
  return out;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function decodeHtml(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#40;/g, "(")
    .replace(/&#41;/g, ")");
}
