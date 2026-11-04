import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_IMAGE_ORIGINAL_MAX_BYTES, AiImagePreparationError, createAiImageDraft, inspectAiImageDimensions,
  normalizedAiImageSize, prepareAiImage, type AiPreparedImage,
} from "@/lib/ai/image-client";

function png(width = 300, height = 200) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
const file = () => new File([png()], "synthetic.png", { type: "image/png" });
const prepared = (id = "one"): AiPreparedImage => ({ id, width: 300, height: 200, previewUrl: `blob:${id}`, input: { mediaType: "image/jpeg", data: "synthetic-base64" } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("bounded phone photo preparation", () => {
  it("reads PNG dimensions before decoding", () => {
    expect(inspectAiImageDimensions(png(), "image/png")).toEqual({ width: 300, height: 200 });
  });
  it("reads JPEG dimensions after metadata without retaining metadata", () => {
    const jpeg = Uint8Array.from([255, 216, 255, 225, 0, 4, 0, 0, 255, 192, 0, 8, 8, 0, 200, 1, 44, 1]);
    expect(inspectAiImageDimensions(jpeg, "image/jpeg")).toEqual({ width: 300, height: 200 });
  });
  it.each(["VP8X", "VP8 ", "VP8L"])("reads %s WebP dimensions", (chunk) => {
    const bytes = new Uint8Array(30);
    for (const [offset, value] of [[0, "RIFF"], [8, "WEBP"], [12, chunk]] as const) bytes.set([...value].map((char) => char.charCodeAt(0)), offset);
    if (chunk === "VP8X") { bytes[24] = 99; bytes[27] = 49; }
    else if (chunk === "VP8 ") { bytes.set([0x9d, 1, 0x2a], 23); bytes[26] = 100; bytes[28] = 50; }
    else { bytes[20] = 0x2f; bytes[21] = 99; bytes[22] = 1 << 6; bytes[23] = 12; }
    expect(inspectAiImageDimensions(bytes, "image/webp")).toEqual({ width: 100, height: 50 });
  });
  it.each([new Uint8Array(), Uint8Array.from([255, 216, 255, 192, 255, 255]), new TextEncoder().encode('<svg width="1" height="1" />')])("rejects empty, truncated and disguised non-image inputs", (bytes) => {
    expect(() => inspectAiImageDimensions(bytes, "image/jpeg")).toThrow(AiImagePreparationError);
  });
  it("does not trust a declared image MIME type", () => {
    expect(() => inspectAiImageDimensions(png(), "image/jpeg")).toThrow("format");
  });
  it.each([[10000, 5000], [20000, 1], [1, 20000], [0, 200]])("rejects unsafe %s × %s dimensions before decode", (width, height) => {
    expect(() => inspectAiImageDimensions(png(width, height), "image/png")).toThrow(AiImagePreparationError);
  });
  it("bounds the long edge, preserves aspect ratio and never enlarges photos", () => {
    expect(normalizedAiImageSize(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(normalizedAiImageSize(3024, 4032)).toEqual({ width: 1536, height: 2048 });
    expect(normalizedAiImageSize(100, 50)).toEqual({ width: 100, height: 50 });
  });
  it("rejects unsupported or oversized originals before decoding", async () => {
    const decode = vi.fn(); vi.stubGlobal("createImageBitmap", decode);
    await expect(prepareAiImage(new File([png()], "photo.heic", { type: "image/heic" }))).rejects.toMatchObject({ code: "format" });
    await expect(prepareAiImage({ type: "image/png", size: AI_IMAGE_ORIGINAL_MAX_BYTES + 1 } as File)).rejects.toMatchObject({ code: "size" });
    expect(decode).not.toHaveBeenCalled();
  });
  it("re-encodes bounded JPEG bytes and releases decoded pixels", async () => {
    const close = vi.fn(); const drawImage = vi.fn(); const fillRect = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4032, height: 3024, close }));
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage, fillRect }), toBlob: (callback: BlobCallback) => callback(new Blob(["normalized"], { type: "image/jpeg" })) };
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:normalized");
    const output = await prepareAiImage(new File([png(4032, 3024)], "photo.png", { type: "image/png" }));
    expect(output).toMatchObject({ width: 2048, height: 1536, input: { mediaType: "image/jpeg", data: btoa("normalized") }, previewUrl: "blob:normalized" });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 1536);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2048, 1536);
    expect(close).toHaveBeenCalledOnce();
    expect(canvas).toMatchObject({ width: 0, height: 0 });
  });
  it("validates decoded dimensions again and releases pixels even after failure", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 30000, height: 30000, close }));
    const canvas = { width: 0, height: 0 }; vi.stubGlobal("document", { createElement: () => canvas });
    await expect(prepareAiImage(file())).rejects.toMatchObject({ code: "dimensions" });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("private memory-only attachment draft", () => {
  it("prepares locally without any submission or browser storage", async () => {
    const prepare = vi.fn().mockResolvedValue(prepared());
    const fetch = vi.fn(); const setItem = vi.fn(); vi.stubGlobal("fetch", fetch); vi.stubGlobal("localStorage", { setItem });
    const draft = createAiImageDraft({ prepare });
    await draft.add([file()]);
    expect(draft.getSnapshot()).toMatchObject({ images: [prepared()], preparing: false, error: null });
    expect(fetch).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
  });
  it("refuses a fourth picture and keeps existing prepared bytes", async () => {
    const prepare = vi.fn().mockResolvedValue(prepared());
    const draft = createAiImageDraft({ prepare });
    await draft.add([file(), file(), file()]);
    await draft.add([file()]);
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(draft.getSnapshot()).toMatchObject({ error: "count", images: [prepared(), prepared(), prepared()] });
  });
  it("does not allow a second picker operation during preparation", async () => {
    const waiting = deferred<AiPreparedImage>(); const prepare = vi.fn().mockReturnValue(waiting.promise);
    const draft = createAiImageDraft({ prepare }); const operation = draft.add([file()]);
    expect(draft.getSnapshot().preparing).toBe(true);
    await draft.add([file()]); expect(prepare).toHaveBeenCalledOnce();
    waiting.resolve(prepared()); await operation;
    expect(draft.getSnapshot().preparing).toBe(false);
  });
  it("rejects a failed selection atomically while keeping previous images for retry", async () => {
    const revoke = vi.fn(); const prepare = vi.fn().mockResolvedValueOnce(prepared("original")).mockResolvedValueOnce(prepared("temporary")).mockRejectedValueOnce(new AiImagePreparationError("format"));
    const draft = createAiImageDraft({ prepare, revoke });
    await draft.add([file()]); await draft.add([file(), file()]);
    expect(draft.getSnapshot()).toMatchObject({ images: [prepared("original")], error: "format", preparing: false });
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:temporary");
  });
  it.each(["clear", "dispose"] as const)("%s revokes previews and discards a late preparation result", async (action) => {
    const waiting = deferred<AiPreparedImage>(); const revoke = vi.fn();
    const prepare = vi.fn().mockResolvedValueOnce(prepared("old")).mockReturnValueOnce(waiting.promise);
    const draft = createAiImageDraft({ prepare, revoke }); await draft.add([file()]);
    const operation = draft.add([file()]); draft[action](); waiting.resolve(prepared("late")); await operation;
    expect(draft.getSnapshot()).toEqual({ images: [], preparing: false, error: null });
    expect(revoke.mock.calls).toEqual([["blob:old"], ["blob:late"]]);
  });
  it("removes one image and revokes its preview without disturbing another", async () => {
    const revoke = vi.fn(); const prepare = vi.fn().mockResolvedValueOnce(prepared("one")).mockResolvedValueOnce(prepared("two"));
    const draft = createAiImageDraft({ prepare, revoke }); await draft.add([file(), file()]);
    draft.remove("one");
    expect(draft.getSnapshot().images).toEqual([prepared("two")]); expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:one");
  });
  it("supports React strict-effect reactivation without restoring the cleared draft", async () => {
    const draft = createAiImageDraft({ prepare: async () => prepared(), revoke: vi.fn() });
    draft.dispose(); draft.activate(); await draft.add([file()]);
    expect(draft.getSnapshot().images).toEqual([prepared()]);
  });
});
