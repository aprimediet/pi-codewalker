/**
 * Tests for libs/cards.ts — lib symbol card rendering.
 *
 * PURE unit tests — no I/O.
 */

import { describe, it, expect } from "vitest";
import { renderLibCard } from "./cards.ts";
import { parseCard } from "../cards.ts";
import type { LibSymbol } from "../types.ts";

function makeLibSymbol(overrides: Partial<LibSymbol> = {}): LibSymbol {
  return {
    lib: "hono",
    version: "4.6.3",
    name: "createMiddleware",
    kind: "function",
    signature: "export declare function createMiddleware<E>(handler: Hono): MiddlewareHandler",
    doc: "Define a typed middleware handler.\nUse this to wrap Hono handlers with middleware support.",
    summary: "Define a typed middleware handler.",
    card_path: "",
    ...overrides,
  };
}

describe("renderLibCard", () => {
  it("includes lib and version in the frontmatter head", () => {
    const sym = makeLibSymbol();
    const card = renderLibCard(sym);
    expect(card).toContain("lib: hono");
    expect(card).toContain("version: 4.6.3");
  });

  it("includes name, kind, signature, summary in head", () => {
    const sym = makeLibSymbol();
    const card = renderLibCard(sym);
    expect(card).toContain("name: createMiddleware");
    expect(card).toContain("kind: function");
    expect(card).toContain("signature:");
    expect(card).toContain("summary:");
  });

  it("has a markdown body with the symbol name as heading", () => {
    const sym = makeLibSymbol();
    const card = renderLibCard(sym);
    expect(card).toContain("# createMiddleware");
  });

  it("includes doc/body text after the frontmatter", () => {
    const sym = makeLibSymbol();
    const card = renderLibCard(sym);
    expect(card).toContain("Use this to wrap Hono handlers");
  });

  it("round-trips via parseCard (head fields are preserved)", () => {
    const sym = makeLibSymbol();
    const card = renderLibCard(sym);
    const parsed = parseCard(card);
    expect(parsed).not.toBeNull();
    expect(parsed!.head.name).toBe("createMiddleware");
    expect(parsed!.head.kind).toBe("function");
    expect(parsed!.head.summary).toContain("Define a typed middleware handler");
  });

  it("produces a module-kind card for README-only packages (no signature)", () => {
    const sym = makeLibSymbol({
      name: "express",
      kind: "module",
      signature: "",
      doc: "Express web framework.",
      summary: "Express web framework.",
    });
    const card = renderLibCard(sym);
    expect(card).toContain("name: express");
    expect(card).toContain("kind: module");
    expect(card).toContain("# express");
    expect(card).toContain("Express web framework");
  });

  it("handles empty doc gracefully", () => {
    const sym = makeLibSymbol({ doc: "", summary: "" });
    const card = renderLibCard(sym);
    expect(card).toContain("name: createMiddleware");
    expect(card).not.toContain("undefined");
  });
});
