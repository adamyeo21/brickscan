// Launches a real headless Chromium instance. This is what actually gets
// past Carousell's bot protection — plain fetch() with spoofed headers
// (what we tried first) gets a flat 403 regardless of headers, because the
// block happens on TLS/browser-fingerprint before any header is read.
// A real (headless) browser presents a genuine fingerprint and passes.
//
// On Vercel: uses @sparticuz/chromium, a Chromium build packaged to fit
// serverless function size limits.
// Locally: points at your existing Chrome/Edge install via executablePath.
//   If it can't find one, set CHROME_EXECUTABLE_PATH in .env.local to the
//   full path of chrome.exe / Google Chrome, e.g. on Windows:
//   CHROME_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

import type { Browser } from "puppeteer-core";

const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

function guessLocalChromePath(): string {
  if (process.env.CHROME_EXECUTABLE_PATH) return process.env.CHROME_EXECUTABLE_PATH;
  switch (process.platform) {
    case "win32":
      return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    case "darwin":
      return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    default:
      return "/usr/bin/google-chrome";
  }
}

export async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");

  if (isServerless) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: [...chromium.args, "--lang=en-SG,en"],
      defaultViewport: { width: 1280, height: 1800 },
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const executablePath = guessLocalChromePath();
  try {
    return await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--lang=en-SG,en"],
    });
  } catch (e: any) {
    throw new Error(
      `Couldn't launch local Chrome at "${executablePath}". Set CHROME_EXECUTABLE_PATH in .env.local to your Chrome install path. (${e.message})`
    );
  }
}
