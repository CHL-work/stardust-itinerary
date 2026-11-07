import de from "./de.json";
import es from "./es.json";
import fr from "./fr.json";
import id from "./id.json";
import ptBr from "./pt-BR.json";
import ru from "./ru.json";
import zhCn from "./zh-CN.json";
import zhTw from "./zh-TW.json";

/**
 * Every pack, for the server, tests and scripts. Browser builds get `store.browser.ts` instead (the
 * `turbopack.resolveAlias` entry in `next.config.ts`), so no pack is bundled into client code; a page sends
 * its own language's pack to the browser instead (JOB-085, D-097).
 */
export const bundledPacks: Readonly<Partial<Record<string, Record<string, unknown>>>> = {
  "zh-CN": zhCn, "zh-TW": zhTw, es, "pt-BR": ptBr, fr, de, ru, id,
};
