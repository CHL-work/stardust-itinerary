import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareAiImages, readAiRequestJson } from "@/lib/ai/image-input";
import { AI_IMAGE_MAX_BYTES, AI_IMAGE_REQUEST_MAX_BYTES, type AiImageInput } from "@/lib/ai/image-types";
import { aiRequestPayloadHash } from "@/lib/ai/request-recovery";

async function sample(format: "png" | "jpeg" | "webp" = "png"): Promise<AiImageInput> {
  const data = await sharp({ create: { width: 2600, height: 1000, channels: 3, background: "white" } })[format]().toBuffer();
  return { mediaType: `image/${format}`, data: data.toString("base64") };
}
describe("bounded AI picture inputs", () => {
  it.each(["png", "jpeg", "webp"] as const)("decodes %s and normalizes private metadata-free JPEG", async (format) => {
    const input = await sample(format);
    const [first] = await prepareAiImages([input]);
    const [retry] = await prepareAiImages([input]);
    expect(first).toMatchObject({ mediaType: "image/jpeg", width: 2048, height: 788 });
    expect(first.sha256).toBe(retry.sha256);
    expect(first.id).not.toBe(retry.id);
    const metadata = await sharp(first.data).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.format).toBe("jpeg");
  });
  it("rejects invalid base64, SVG disguise, MIME mismatch, excessive bytes/count", async () => {
    const valid = await sample();
    for (const invalid of [
      { ...valid, data: "data:image/png;base64," + valid.data },
      { ...valid, data: "!invalid" },
      { ...valid, data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64") },
      { ...valid, mediaType: "image/jpeg" as const },
      { ...valid, data: Buffer.alloc(AI_IMAGE_MAX_BYTES + 1).toString("base64") },
    ]) await expect(prepareAiImages([invalid])).rejects.toMatchObject({ name: "AI_IMAGE_INVALID" });
    await expect(prepareAiImages([valid, valid, valid, valid])).rejects.toThrow();
  });
  it("rejects decoded pixel bombs and strips EXIF orientation after rotation", async () => {
    const data = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: "white" } }).png().toBuffer();
    await expect(prepareAiImages([{ mediaType: "image/png", data: data.toString("base64") }])).rejects.toThrow();
    const rotated = await sharp({ create: { width: 100, height: 200, channels: 3, background: "white" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const [image] = await prepareAiImages([{ mediaType: "image/jpeg", data: rotated.toString("base64") }]);
    expect(image).toMatchObject({ width: 200, height: 100 });
    expect((await sharp(image.data).metadata()).exif).toBeUndefined();
  });
  it("bounds streamed JSON even without Content-Length", async () => {
    expect(await readAiRequestJson(new Request("http://localhost", { method: "POST", body: '{"prompt":"receipt"}' }))).toEqual({ prompt: "receipt" });
    await expect(readAiRequestJson(new Request("http://localhost", { method: "POST", body: "x".repeat(AI_IMAGE_REQUEST_MAX_BYTES + 1) }))).rejects.toThrow();
    await expect(readAiRequestJson(new Request("http://localhost", { method: "POST", body: "{}", headers: { "content-length": String(AI_IMAGE_REQUEST_MAX_BYTES + 1) } }))).rejects.toThrow();
    await expect(readAiRequestJson(new Request("http://localhost", { method: "POST", body: "broken" }))).rejects.toThrow();
  });
  it("binds ordered image hashes without changing existing text-only retry identities", () => {
    const base = aiRequestPayloadHash("create", undefined, "en", null);
    expect(base).toBe(aiRequestPayloadHash("create", undefined, "en", null, []));
    expect(base).not.toBe(aiRequestPayloadHash("create", undefined, "en", null, ["a"]));
    expect(aiRequestPayloadHash("create", undefined, "en", null, ["a", "b"]))
      .not.toBe(aiRequestPayloadHash("create", undefined, "en", null, ["b", "a"]));
  });
});
