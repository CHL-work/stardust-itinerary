import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const { checksumMatchesApplied } = await import(pathToFileURL(path.resolve("scripts/db/migration-lib.mjs")).href);

describe("applied migration checksum comparison", () => {
  const lf = "CREATE TABLE example (\n  id integer\n);\n";
  const crlf = lf.replaceAll("\n", "\r\n");

  it("accepts the exact bytes and line-ending-only variants in either direction", () => {
    expect(checksumMatchesApplied(lf, sha256(lf))).toBe(true);
    expect(checksumMatchesApplied(lf, sha256(crlf))).toBe(true);
    expect(checksumMatchesApplied(crlf, sha256(lf))).toBe(true);
    expect(checksumMatchesApplied(crlf, sha256(crlf))).toBe(true);
  });

  it("rejects any change beyond line endings", () => {
    expect(checksumMatchesApplied(lf, sha256(lf.replace("integer", "bigint")))).toBe(false);
    expect(checksumMatchesApplied(lf, sha256(`${lf}\n`))).toBe(false);
    expect(checksumMatchesApplied(lf, sha256(lf.replaceAll("\n", "\r")))).toBe(false);
  });
});
