// Iris's views toast through bb's "sonner"; on the public site they show in the site's own toasts.
import { toast as show } from "./sdk-shim";

type Opts = { action?: unknown; description?: string };
const say = (text: unknown, _opts?: Opts) => show(String(text));
export const toast = Object.assign(say, { success: say, error: say, info: say, warning: say, message: say });
