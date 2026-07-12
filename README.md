# BrickScan

Personal sourcing tool: search Carousell.sg for LEGO listings and compare each one against BrickLink resale values (in SGD) to spot deals worth buying.

## How it works

1. Type a search (e.g. `lego star wars` or `lego 75324`) → the server fetches current Carousell listings on demand (no background scraping, no proxies needed).
2. Set numbers are auto-detected from listing titles. If detection is wrong or missing, edit the **Set #** box on any row and press Enter.
3. Each identified set is looked up on BrickLink: **used 6-month sold average** and **new 6-month sold average**, side by side.
4. Rows are sorted best-deal-first. The chip shows asking price as a % of BrickLink used average:
   - **≤60%** — green, row highlighted (buy zone)
   - **61–85%** — amber (marginal after fees/shipping)
   - **>85%** — red (skip)
5. **Part-out value** is computed on demand per set (button on each row). It prices every lot in the set's inventory, so it uses one BrickLink API call per unique part — a large set can use 300–800 calls against the ~5,000/day quota. Results are cached 7 days. It also warns when ≥40% of a set's value sits in its minifigs (verify they're present before buying used).

## Setup

```bash
cp .env.example .env.local
# fill in your BrickLink API credentials
npm install
npm run dev
```

BrickLink credentials come from https://www.bricklink.com/v2/api/register_consumer.page (requires a seller account). You need all four values: consumer key/secret and access token/secret.

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. Import into Vercel.
3. Add the four `BL_*` environment variables (plus `BL_CURRENCY=SGD`) in Project → Settings → Environment Variables.
4. Deploy.

Optional but recommended: enable Vercel's deployment protection (password/auth) so the app isn't publicly usable — it spends your BrickLink quota.

## Known limitations — read this

- **Carousell blocks plain scripted requests outright (HTTP 403), from any IP.** This isn't rate-limiting — it's bot-fingerprint detection that rejects `fetch()`-style requests before even reading headers. The fix: `lib/browser.ts` launches a real headless Chromium (via `puppeteer-core` + `@sparticuz/chromium` on Vercel) to render the search page like an actual browser would. This is the primary path now; the plain-fetch attempts in `lib/carousell.ts` are kept as a fast first try in case Carousell ever loosens up, but expect them to fail with 403 and fall through to the browser render.
  - **Cost of this:** each search takes longer (~3-8s: browser launch + page load + parse) and uses more memory than a plain fetch. `maxDuration = 60` is set on `/api/search` to give it room — if Vercel rejects that on your plan, check Project Settings → Functions for your account's max duration limit.
  - **If browser rendering also gets blocked** (e.g. a JS challenge/CAPTCHA that Chromium alone can't solve), the next step up is a proxy/unblocker service — genuinely hard to avoid at that point without a paid tool.
  - **Local dev:** `lib/browser.ts` points at your local Chrome install by default (`C:\Program Files\Google\Chrome\Application\chrome.exe` on Windows). If that path is wrong, set `CHROME_EXECUTABLE_PATH` in `.env.local` to your actual Chrome path.
- **Caching is in-memory.** On Vercel it persists per warm serverless instance only. Fine for one user; if quota use becomes a problem, swap `lib/cache.ts` for Upstash Redis (two functions to replace).
- **Set detection is heuristic.** Titles like "Lego bulk 5kg" have no set number — those rows show "no data" and need manual judgment. 4-digit numbers that look like years (1950–2035) are deliberately ignored, which can rarely skip a real vintage set number.
- **Condition is a guess.** BrickLink "used" prices assume complete sets. A listing missing minifigs or instructions is worth much less — that's what the part-out minifig warning is for.

## File map

- `app/page.tsx` — the entire UI
- `app/api/search` — Carousell search proxy
- `app/api/price` — BrickLink set price guide (new + used, SGD)
- `app/api/pov` — part-out value calculator
- `lib/carousell.ts` — Carousell fetching + set-number extraction
- `lib/bricklink.ts` — OAuth 1.0a client, price guide, part-out logic
- `lib/cache.ts` — in-memory TTL cache
