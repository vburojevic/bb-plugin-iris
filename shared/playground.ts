// The web playground's address and its share-link code, shared by the site and the plugin:
// a card's source travels in the URL fragment, which the browser never sends to the server.

export const PLAYGROUND_URL = "https://vburojevic.github.io/bb-plugin-iris/";

/** URL-safe base64 of UTF-8 text. */
export function encode(text: string): string {
  return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decode(code: string): string | null {
  try {
    return decodeURIComponent(escape(atob(code.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return null;
  }
}

/** The fragment that opens the playground's editor on this source. */
export const playLink = (source: string) => `#/play?c=${encode(source)}`;

/** Longest source a link carries; browsers and chat apps cut longer URLs. */
export const MAX_LINK_SOURCE = 24_000;
