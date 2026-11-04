import { posix, win32 } from "node:path";

/** Keep the default cache beside the repository, not inside a replaceable
 * production build. Next's standalone launcher changes cwd to .next/standalone.
 * The optional cwd makes both platform layouts testable without changing cwd. */
export function osmCacheDirectory(
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
): string | null {
  const windows = /^(?:[a-z]:[\\/]|\\\\)/iu.test(cwd);
  const path = windows ? win32 : posix;
  const absolute = (value: string): boolean => windows
    ? /^(?:[a-z]:[\\/]|(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/iu.test(value)
    : posix.isAbsolute(value);
  const explicit = env.STARDUST_MAP_CACHE_DIR?.trim();
  if (explicit) return absolute(explicit) ? path.normalize(explicit) : null;
  if (!absolute(cwd)) return null;
  const directory = path.normalize(cwd);
  const parent = path.dirname(directory);
  const sameName = (value: string, expected: string) => (windows ? value.toLowerCase() : value) === expected;
  const repository = sameName(path.basename(directory), "standalone") && sameName(path.basename(parent), ".next")
    ? path.dirname(parent) : directory;
  return path.resolve(repository, "..", ".local", "day-map-cache");
}
