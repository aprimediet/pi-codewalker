/**
 * Tests for libs/dts.ts — .d.ts symbol extraction.
 *
 * These are PURE unit tests (fixture strings only, no I/O).
 * Test every export form listed in §10 of the v1.2 plan.
 */

import { describe, it, expect } from "vitest";
import { extractDtsSymbols } from "./dts.ts";
import type { LibSymbol } from "../types.ts";

/**
 * Helper: run extractDtsSymbols and return sorted results for deterministic assertions.
 */
function extract(source: string, lib = "test-lib", version = "1.0.0"): LibSymbol[] {
  return extractDtsSymbols(source, lib, version).sort((a, b) => a.name.localeCompare(b.name));
}

describe("extractDtsSymbols", () => {
  // ── function forms ────────────────────────────────────────────
  it("extracts `export declare function`", () => {
    const src = `export declare function createMiddleware<E>(handler: Hono): MiddlewareHandler;\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("createMiddleware");
    expect(result[0]!.kind).toBe("function");
    expect(result[0]!.signature).toContain("createMiddleware");
    expect(result[0]!.lib).toBe("test-lib");
    expect(result[0]!.version).toBe("1.0.0");
  });

  it("extracts `export function` (without declare)", () => {
    const src = `export function greet(name: string): string;\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("greet");
    expect(result[0]!.kind).toBe("function");
  });

  it("extracts generic function `export function f<T>(...)`", () => {
    const src = `export function identity<T>(arg: T): T;\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("identity");
    expect(result[0]!.kind).toBe("function");
  });

  // ── const forms ───────────────────────────────────────────────
  it("extracts `export declare const`", () => {
    const src = `export declare const BASE_URL: string;\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("BASE_URL");
    expect(result[0]!.kind).toBe("const");
  });

  it("extracts `export const` (without declare)", () => {
    const src = `export const TIMEOUT_MS: number = 5000;\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("TIMEOUT_MS");
    expect(result[0]!.kind).toBe("const");
  });

  // ── class forms ───────────────────────────────────────────────
  it("extracts `export declare class`", () => {
    const src = `export declare class Router { handle(): void; }\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Router");
    expect(result[0]!.kind).toBe("class");
    expect(result[0]!.signature).toContain("Router");
  });

  it("extracts `export class` (without declare)", () => {
    const src = `export class Database { constructor(path: string); }\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Database");
    expect(result[0]!.kind).toBe("class");
  });

  it("extracts `export abstract class`", () => {
    const src = `export abstract class Serializer { abstract serialize(data: unknown): string; }\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Serializer");
    expect(result[0]!.kind).toBe("class");
  });

  // ── interface ─────────────────────────────────────────────────
  it("extracts `export interface`", () => {
    const src = `export interface User { id: string; name: string; }\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("User");
    expect(result[0]!.kind).toBe("interface");
  });

  // ── type ──────────────────────────────────────────────────────
  it("extracts `export type`", () => {
    const src = `export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("JsonValue");
    expect(result[0]!.kind).toBe("type");
  });

  it("extracts `export type` with generic parameter", () => {
    const src = `export type Result<T> = { ok: true; value: T } | { ok: false; error: string };\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Result");
    expect(result[0]!.kind).toBe("type");
  });

  // ── enum ──────────────────────────────────────────────────────
  it("extracts `export declare enum`", () => {
    const src = `export declare enum Color { Red, Green, Blue }\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Color");
    expect(result[0]!.kind).toBe("enum");
  });

  it("extracts `export enum` (without declare)", () => {
    const src = `export enum Direction { Up, Down, Left, Right }\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Direction");
    expect(result[0]!.kind).toBe("enum");
  });

  // ── namespace ─────────────────────────────────────────────────
  it("extracts `export declare namespace`", () => {
    const src = `export declare namespace Util { function parse(s: string): any; }\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Util");
    expect(result[0]!.kind).toBe("namespace");
  });

  it("extracts `export namespace` (without declare)", () => {
    const src = `export namespace Config { const port: number; }\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Config");
    expect(result[0]!.kind).toBe("namespace");
  });

  // ── re-exports ────────────────────────────────────────────────
  it("extracts re-export `export { a, b as c } from \"...\"`", () => {
    const src = `export { parse, stringify as format } from "./serializer";\n`;
    const result = extract(src);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("format");
    expect(result[0]!.kind).toBe("reexport");
    expect(result[1]!.name).toBe("parse");
    expect(result[1]!.kind).toBe("reexport");
  });

  it("extracts re-export `export { a, b }` (local module)", () => {
    const src = `export { readFile, writeFile };\n`;
    const result = extract(src);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("readFile");
    expect(result[0]!.kind).toBe("reexport");
    expect(result[1]!.name).toBe("writeFile");
    expect(result[1]!.kind).toBe("reexport");
  });

  it("extracts `export * from` as a single re-export entry", () => {
    const src = `export * from "./helpers";\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("*");
    expect(result[0]!.kind).toBe("reexport");
  });

  // ── export default ────────────────────────────────────────────
  it("extracts `export default function`", () => {
    const src = `export default function createApp(opts?: Options): App;\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("default");
    expect(result[0]!.kind).toBe("function");
  });

  it("extracts `export default class`", () => {
    const src = `export default class Logger { log(...args: unknown[]): void; }\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("default");
    expect(result[0]!.kind).toBe("class");
  });

  it("extracts `export default {…}` as const kind", () => {
    const src = `export default { name: "app", version: "1.0" };\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("default");
    // Object literal default — kind "const" is a reasonable fallback
    expect(result[0]!.kind).toBe("const");
  });

  // ── JSDoc / leading comments ──────────────────────────────────
  it("captures leading JSDoc as doc and first line as summary", () => {
    const src = [
      '/** Create a typed middleware handler.',
      ' * Use this to wrap Hono handlers with middleware. */',
      'export declare function createMiddleware<E>(handler: Hono): MiddlewareHandler;',
    ].join("\n") + "\n";
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.doc).toContain("Create a typed middleware handler");
    expect(result[0]!.summary).toContain("Create a typed middleware handler");
  });

  it("sets summary to empty when no JSDoc", () => {
    const src = `export declare function noDoc(): void;\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.summary).toBe("");
  });

  // ── non-exported declarations are ignored ─────────────────────
  it("ignores non-exported declarations", () => {
    const src = `declare function internal(): void;\nfunction privateHelper(): void;\nconst secret = "hidden";\n`;
    const result = extract(src);
    expect(result).toHaveLength(0);
  });

  // ── multiple symbols in one file ──────────────────────────────
  it("extracts multiple symbols from a .d.ts file", () => {
    const src = [
      `export interface User { id: string; }`,
      `export declare function fetchUser(id: string): Promise<User>;`,
      `export const MAX_RETRIES = 3;`,
      `export enum Status { Active, Inactive }`,
    ].join("\n");
    const result = extract(src);
    expect(result).toHaveLength(4);
  });

  // ── signature trimming ────────────────────────────────────────
  it("trims trailing `{` from the signature", () => {
    const src = `export interface User { id: string; name: string; }\n`;
    const result = extract(src);
    expect(result[0]!.signature).not.toMatch(/\{/);
  });

  // ── empty / no exports ────────────────────────────────────────
  it("returns empty array for empty source", () => {
    expect(extract("")).toHaveLength(0);
  });

  it("returns empty array for source with no export declarations", () => {
    const src = `type Internal = string;\nconst secret = 42;\n`;
    expect(extract(src)).toHaveLength(0);
  });

  // ── default export with JSDoc ─────────────────────────────────
  it("captures JSDoc for default export", () => {
    const src = `/** Main application factory. */\nexport default function createApp(opts: Options): App;\n`;
    const result = extract(src);
    expect(result).toHaveLength(1);
    expect(result[0]!.doc).toContain("Main application factory");
  });
});
