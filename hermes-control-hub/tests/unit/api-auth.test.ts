/** @jest-environment node */
import { createHmac } from "crypto";
import { NextRequest } from "next/server";

import {
  getCorrelationId,
  requireAuth,
  requireSignedRequest,
} from "@/lib/api-auth";

describe("api-auth", () => {
  afterEach(() => {
    delete process.env.CH_REQUEST_SIGNING_SECRET;
  });

  it("allows writes when not read-only", () => {
    delete process.env.CH_READ_ONLY;
    const request = new NextRequest("http://localhost/api/test", { method: "POST" });
    expect(requireAuth(request)).toBeNull();
  });

  it("accepts valid signed request", () => {
    process.env.CH_REQUEST_SIGNING_SECRET = "secret";
    const ts = Date.now().toString();
    const payload = `POST:/api/update:${ts}`;
    const signature = createHmac("sha256", "secret").update(payload).digest("hex");
    const request = new NextRequest("http://localhost/api/update", {
      method: "POST",
      headers: { "x-ch-ts": ts, "x-ch-signature": signature },
    });
    expect(requireSignedRequest(request)).toBeNull();
  });

  it("rejects tampered signed request", () => {
    process.env.CH_REQUEST_SIGNING_SECRET = "secret";
    const ts = Date.now().toString();
    const request = new NextRequest("http://localhost/api/update", {
      method: "POST",
      headers: { "x-ch-ts": ts, "x-ch-signature": "bad-signature" },
    });
    expect(requireSignedRequest(request)?.status).toBe(401);
  });

  it("uses x-correlation-id before x-request-id", () => {
    const request = new NextRequest("http://localhost/api/test", {
      headers: { "x-correlation-id": "cid-1", "x-request-id": "rid-1" },
    });
    expect(getCorrelationId(request)).toBe("cid-1");
  });
});
