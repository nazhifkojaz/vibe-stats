import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isNewerVersion } from "../src/update-check";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_STDERR_ISTTY = process.stderr.isTTY;
const tempDirs: string[] = [];
const PACKAGE_VERSION = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version as string;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  restoreHome();
  Object.defineProperty(process.stderr, "isTTY", { value: ORIGINAL_STDERR_ISTTY, configurable: true, writable: true });

  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function restoreHome(): void {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = ORIGINAL_HOME;
  }
}

function makeHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-update-check-"));
  tempDirs.push(home);
  process.env.HOME = home;
  return home;
}

function writeUpdateCache(home: string, latestVersion: string): void {
  const cacheDir = path.join(home, ".cache", "vibe-o-meter");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path.join(cacheDir, "update-check.json"), JSON.stringify({
    lastChecked: Date.now(),
    latestVersion,
  }));
}

function nextPatchVersion(): string {
  const [major, minor, patch] = versionParts(PACKAGE_VERSION);
  return `${major}.${minor}.${patch + 1}`;
}

function previousVersion(): string {
  const [major, minor, patch] = versionParts(PACKAGE_VERSION);
  if (patch > 0) return `${major}.${minor}.${patch - 1}`;
  if (minor > 0) return `${major}.${minor - 1}.999`;
  if (major > 0) return `${major - 1}.999.999`;
  return PACKAGE_VERSION;
}

function versionParts(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

describe("isNewerVersion", () => {
  it("only treats greater semver versions as newer", () => {
    expect(isNewerVersion("0.1.2", "0.1.3")).toBe(false);
    expect(isNewerVersion("0.1.3", "0.1.3")).toBe(false);
    expect(isNewerVersion("0.1.4", "0.1.3")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });

  it("handles prerelease ordering for matching version cores", () => {
    expect(isNewerVersion("1.0.0", "1.0.0-beta.1")).toBe(true);
    expect(isNewerVersion("1.0.0-beta.1", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0-beta.2", "1.0.0-beta.1")).toBe(true);
  });
});

describe("checkForUpdate", () => {
  it("does not warn when a fresh cache contains an older registry version", async () => {
    const home = makeHome();
    writeUpdateCache(home, previousVersion());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { checkForUpdate } = await import("../src/update-check");
    await checkForUpdate();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("warns when a fresh cache contains a newer registry version", async () => {
    const home = makeHome();
    const newerVersion = nextPatchVersion();
    writeUpdateCache(home, newerVersion);
    // printWarning now only fires on an interactive stderr.
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true, writable: true });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn());

    const { checkForUpdate } = await import("../src/update-check");
    await checkForUpdate();

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toContain(newerVersion);
  });

  it("does not warn when a fresh registry response is older than the local version", async () => {
    makeHome();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: previousVersion() }),
    })));

    const { checkForUpdate } = await import("../src/update-check");
    await checkForUpdate();

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
