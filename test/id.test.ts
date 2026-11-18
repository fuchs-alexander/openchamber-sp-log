import { describe, expect, test } from "bun:test";
import { isCardLogId } from "../src/block/card.ts";
import { newLogId } from "../src/panel/id.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newLogId", () => {
  test("uses crypto.randomUUID where the page offers it", () => {
    const id = newLogId({ randomUUID: () => "11111111-2222-4333-8444-555555555555", getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(id).toBe("11111111-2222-4333-8444-555555555555");
  });

  test("works without crypto.randomUUID (plain http page, no secure context)", () => {
    const insecure = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    const a = newLogId(insecure);
    const b = newLogId(insecure);
    expect(a).toMatch(UUID_V4);
    expect(isCardLogId(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  test("defaults to the global crypto", () => {
    expect(newLogId()).toMatch(UUID_V4);
  });
});
