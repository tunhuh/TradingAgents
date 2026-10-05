import { describe, expect, it } from "vitest";
import { localRequestError } from "@/lib/guard";

const req = (headers: Record<string, string>) =>
  new Request("http://localhost:3000/api/batches", { method: "POST", headers });

describe("localRequestError", () => {
  it("allows same-origin requests from the dashboard on localhost / 127.0.0.1", () => {
    expect(localRequestError(req({ host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(localRequestError(req({ host: "127.0.0.1:3000" }))).toBeNull();
    expect(localRequestError(req({ host: "[::1]:3000" }))).toBeNull();
  });

  it("rejects cross-site browser requests", () => {
    expect(localRequestError(req({ host: "localhost:3000", "sec-fetch-site": "cross-site" }))).toMatch(/cross-site/i);
    expect(localRequestError(req({ host: "localhost:3000", origin: "https://evil.example" }))).toMatch(/origin/i);
  });

  it("rejects non-local Host headers (LAN access, DNS rebinding)", () => {
    expect(localRequestError(req({ host: "192.168.1.20:3000" }))).toMatch(/host/i);
    expect(localRequestError(req({ host: "evil.example:3000" }))).toMatch(/host/i);
  });

  it("optionally requires a JSON body (blocks no-cors text/plain POSTs)", () => {
    const local = { host: "localhost:3000" };
    expect(localRequestError(req({ ...local, "content-type": "text/plain" }), { requireJson: true })).toMatch(/json/i);
    expect(localRequestError(req({ ...local, "content-type": "application/json" }), { requireJson: true })).toBeNull();
  });
});
