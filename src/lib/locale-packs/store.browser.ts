/**
 * The browser's pack store is empty: packs never ship in client code. The page sends the selected language's
 * pack, and `LocalePackScope` installs it before anything below it renders (JOB-085, D-097).
 */
export const bundledPacks: Readonly<Partial<Record<string, Record<string, unknown>>>> = {};
