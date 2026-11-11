import { describe, expect, it } from "vitest";
import { FAILED_IMAGE_KEEP_MS, IMAGE_RETRY_MS, resolveImage } from "../ui/files";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fake load_image that answers from a queue, counting calls. */
function fakeRpc(answers: unknown[]) {
  const rpc = {
    calls: 0,
    call: (async () => {
      const a = answers[Math.min(rpc.calls++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return a;
    }) as never,
  };
  return rpc;
}

describe("file images", () => {
  it("reads again after a failed read instead of showing the failure for good", async () => {
    const rpc = fakeRpc([{ ok: false, error: "file not found" }, { ok: true, dataUrl: "data:image/png;base64,AAAA" }]);
    const first = await resolveImage("$BB_THREAD_STORAGE/a.png", "thr_retry1", rpc, "");
    expect(first).toEqual({ status: "error", error: "file not found" });
    // Asked again at once (a block still streaming), the failure is reused, not read again.
    await resolveImage("$BB_THREAD_STORAGE/a.png", "thr_retry1", rpc, "");
    expect(rpc.calls).toBe(1);
    await pause(FAILED_IMAGE_KEEP_MS + 50);
    const second = await resolveImage("$BB_THREAD_STORAGE/a.png", "thr_retry1", rpc, "");
    expect(second).toEqual({ status: "ok", url: "data:image/png;base64,AAAA" });
    expect(rpc.calls).toBe(2);
  });
  it("reads again after bb didn't answer", async () => {
    const rpc = fakeRpc([new Error("fetch failed"), { ok: true, dataUrl: "data:image/png;base64,BBBB" }]);
    expect(await resolveImage("$BB_THREAD_STORAGE/b.png", "thr_retry2", rpc, "")).toEqual({ status: "error", error: "fetch failed" });
    await pause(FAILED_IMAGE_KEEP_MS + 50);
    expect(await resolveImage("$BB_THREAD_STORAGE/b.png", "thr_retry2", rpc, "")).toEqual({ status: "ok", url: "data:image/png;base64,BBBB" });
  });
  it("marks a failure that reading again can't fix", async () => {
    const rpc = fakeRpc([{ ok: false, error: "the file is 20480 KB, over the 12288 KB limit", final: true }]);
    expect(await resolveImage("$BB_THREAD_STORAGE/d.png", "thr_retry4", rpc, "")).toEqual({ status: "error", error: "the file is 20480 KB, over the 12288 KB limit", final: true });
  });
  it("retries sooner than a failure is forgotten would make pointless", () => {
    expect(IMAGE_RETRY_MS[0]).toBeGreaterThan(FAILED_IMAGE_KEEP_MS);
  });
  it("keeps a shown image without reading it again", async () => {
    const rpc = fakeRpc([{ ok: true, dataUrl: "data:image/png;base64,CCCC" }]);
    await resolveImage("$BB_THREAD_STORAGE/c.png", "thr_retry3", rpc, "");
    await resolveImage("$BB_THREAD_STORAGE/c.png", "thr_retry3", rpc, "");
    expect(rpc.calls).toBe(1);
  });
});
