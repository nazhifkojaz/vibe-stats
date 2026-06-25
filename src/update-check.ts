import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { detectColorEnabled } from "./color";

const CURRENT_VERSION = getLocalVersion();
const CACHE_FILE = path.join(os.homedir(), ".cache", "vibe-o-meter", "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheData {
  lastChecked: number;
  latestVersion: string;
}

function getLocalVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json");
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

export async function checkForUpdate(): Promise<void> {
  try {
    const cached = readCache();
    if (cached && Date.now() - cached.lastChecked < CACHE_TTL_MS) {
      if (isNewerVersion(cached.latestVersion, CURRENT_VERSION)) {
        printWarning(cached.latestVersion);
      }
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://registry.npmjs.org/vibe-o-meter/latest", {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return;

    const data = await res.json();
    const latestVersion: string = data.version;
    if (!latestVersion) return;

    writeCache({ lastChecked: Date.now(), latestVersion });

    if (isNewerVersion(latestVersion, CURRENT_VERSION)) {
      printWarning(latestVersion);
    }
  } catch {}
}

export function isNewerVersion(latest: string, current: string): boolean {
  const latestVersion = parseVersion(latest);
  const currentVersion = parseVersion(current);
  if (!latestVersion || !currentVersion) return false;

  for (const key of ["major", "minor", "patch"] as const) {
    if (latestVersion[key] > currentVersion[key]) return true;
    if (latestVersion[key] < currentVersion[key]) return false;
  }

  if (currentVersion.prerelease && !latestVersion.prerelease) return true;
  if (!currentVersion.prerelease && latestVersion.prerelease) return false;
  if (!currentVersion.prerelease || !latestVersion.prerelease) return false;

  return comparePrerelease(latestVersion.prerelease, currentVersion.prerelease) > 0;
}

function parseVersion(value: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
} | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;

  return {
    major,
    minor,
    patch,
    prerelease: match[4] || null,
  };
}

function comparePrerelease(a: string, b: string): number {
  const aParts = a.split(".");
  const bParts = b.split(".");
  const length = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < length; i++) {
    const aPart = aParts[i];
    const bPart = bParts[i];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;

    const aNumber = numericIdentifier(aPart);
    const bNumber = numericIdentifier(bPart);
    if (aNumber !== null && bNumber !== null) return aNumber - bNumber;
    if (aNumber !== null) return -1;
    if (bNumber !== null) return 1;
    return aPart.localeCompare(bPart);
  }

  return 0;
}

function numericIdentifier(value: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function printWarning(latest: string): void {
  // Don't nag non-interactive consumers (pipes, redirects, `--json` users) with
  // escape-code soup on stderr; only warn on an interactive terminal.
  if (!process.stderr.isTTY) return;
  const color = detectColorEnabled(process.argv, process.env, process.stderr);
  const yellow = color ? "[33m" : "";
  const bold = color ? "[1m" : "";
  const reset = color ? "[0m" : "";
  console.error(
    `\n${yellow}Warning:${reset} You're running vibe-o-meter@${CURRENT_VERSION}, but ${bold}${latest}${reset} is available.\n` +
    `Run ${bold}npx vibe-o-meter@latest${reset} to update.`
  );
}

function readCache(): CacheData | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(data: CacheData): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch {}
}
