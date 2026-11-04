/** Keyless public raster templates. Shared by server configuration and browser
 * response validation; no environment or browser-only imports. */
export function validMapTileTemplate(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500 || /[\u0000-\u0020\u007f]/u.test(value)) return false;
  if (!["{z}", "{x}", "{y}"].every(token => value.split(token).length === 2)) return false;
  try {
    const url = new URL(value.replaceAll("{z}", "0").replaceAll("{x}", "0").replaceAll("{y}", "0"));
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash
      && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/iu.test(url.hostname)
      && !/\.(?:local|localhost|internal|test|invalid)$/iu.test(url.hostname)
      && !/[{}]/u.test(url.pathname);
  } catch { return false; }
}
