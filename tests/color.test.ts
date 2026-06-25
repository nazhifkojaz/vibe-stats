import { describe, expect, it } from "vitest";
import { detectColorEnabled } from "../src/color";

const TTY = { isTTY: true };
const PIPE = { isTTY: false };

describe("detectColorEnabled", () => {
  it("enables color on an interactive TTY", () => {
    expect(detectColorEnabled([], {}, TTY)).toBe(true);
  });

  it("disables color when the stream is not a TTY (piped / redirected)", () => {
    expect(detectColorEnabled([], {}, PIPE)).toBe(false);
  });

  it("honors NO_COLOR over a TTY", () => {
    expect(detectColorEnabled([], { NO_COLOR: "1" }, TTY)).toBe(false);
  });

  it("treats an empty NO_COLOR as unset (per the NO_COLOR spec)", () => {
    expect(detectColorEnabled([], { NO_COLOR: "" }, TTY)).toBe(true);
  });

  it("honors FORCE_COLOR over NO_COLOR and a non-TTY", () => {
    expect(detectColorEnabled([], { FORCE_COLOR: "1", NO_COLOR: "1" }, PIPE)).toBe(true);
  });

  it("treats FORCE_COLOR=0 as disabled (chalk/supports-color convention)", () => {
    expect(detectColorEnabled([], { FORCE_COLOR: "0" }, TTY)).toBe(false);
  });

  it("treats FORCE_COLOR=false as disabled", () => {
    expect(detectColorEnabled([], { FORCE_COLOR: "false" }, TTY)).toBe(false);
  });

  it("enables color for a non-zero FORCE_COLOR level even on a non-TTY", () => {
    expect(detectColorEnabled([], { FORCE_COLOR: "2" }, PIPE)).toBe(true);
  });

  it("lets --no-color override FORCE_COLOR and a TTY", () => {
    expect(detectColorEnabled(["--no-color"], { FORCE_COLOR: "1" }, TTY)).toBe(false);
  });

  it("lets --color override NO_COLOR and a non-TTY", () => {
    expect(detectColorEnabled(["--color"], { NO_COLOR: "1" }, PIPE)).toBe(true);
  });

  it("prefers --no-color when both flags are present", () => {
    expect(detectColorEnabled(["--color", "--no-color"], {}, TTY)).toBe(false);
  });
});
