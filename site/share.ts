// Shared constants, the URL-safe base64 the playground's share links use, and
// small browser helpers that never throw (storage can be blocked, the clipboard refused).
import { toast } from "./sdk-shim";

export { decode, encode, playLink } from "../shared/playground";

export const REPO = "https://github.com/vburojevic/bb-plugin-iris";
export const INSTALL = 'bb plugin install "git:https://github.com/vburojevic/bb-plugin-iris.git@^1.0.0"';

export const store = {
  get(area: "local" | "session", key: string): string | null {
    try {
      return (area === "local" ? localStorage : sessionStorage).getItem(key);
    } catch {
      return null;
    }
  },
  set(area: "local" | "session", key: string, value: string) {
    try {
      (area === "local" ? localStorage : sessionStorage).setItem(key, value);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  },
};

/** Copies text and says so only when it worked. */
export async function copyText(text: string, done: string) {
  try {
    if (!navigator.clipboard) throw new Error("no clipboard");
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast("Couldn't copy. Select the text and copy it yourself.");
  }
}

export const copyInstall = () => copyText(INSTALL, "Install command copied. Paste it in a terminal on a Mac running bb.");
