declare module "*.css" {
  const text: string;
  export default text;
}

/** The plugin version from package.json, set by scripts/build-site.mjs. */
declare const __IRIS_VERSION__: string;
