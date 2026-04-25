
import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { getClientIp } from "../_shared/security.ts";

Deno.test("getClientIp - Precedence Order", () => {
  // 1. CF-Connecting-IP wins
  const req1 = new Request("http://localhost", {
    headers: {
      "cf-connecting-ip": "1.1.1.1",
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3"
    }
  });
  assertEquals(getClientIp(req1), "1.1.1.1");

  // 2. X-Real-IP wins if CF missing
  const req2 = new Request("http://localhost", {
    headers: {
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3"
    }
  });
  assertEquals(getClientIp(req2), "2.2.2.2");

  // 3. X-Forwarded-For wins if others missing (takes first)
  const req3 = new Request("http://localhost", {
    headers: {
      "x-forwarded-for": "3.3.3.3, 4.4.4.4"
    }
  });
  assertEquals(getClientIp(req3), "3.3.3.3");
});

Deno.test("getClientIp - Normalization", () => {
  // Trims whitespace
  const req = new Request("http://localhost", {
    headers: { "cf-connecting-ip": "  2001:db8::1  " }
  });
  assertEquals(getClientIp(req), "2001:db8::1");

  // Handles empty strings
  const reqEmpty = new Request("http://localhost", {
    headers: { "cf-connecting-ip": "" }
  });
  assertEquals(getClientIp(reqEmpty), null);
});
