// Set only by the public playground site: there is no thread there, but code and
// image examples read bundled samples, so they ask the site's stand-in SDK.
export const DEMO_THREAD: string | null = (globalThis as { __IRIS_DEMO_THREAD__?: string }).__IRIS_DEMO_THREAD__ ?? null;
