type IdCrypto = Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string };

/**
 * A fresh UUID v4 for a log. `crypto.randomUUID` exists only in secure
 * contexts (HTTPS, localhost); on a plain-http page such as OpenChamber over
 * Tailscale it is missing, so the id is built from `getRandomValues`, which
 * every page has.
 */
export function newLogId(c: IdCrypto = crypto): string {
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
