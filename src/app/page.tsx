import { redirect } from "next/navigation";

import { isLocale } from "@/lib/i18n";

export default function Home() {
  const configuredLocale = process.env.DEFAULT_LOCALE ?? "zh-HK-lihkg";
  const locale = isLocale(configuredLocale) ? configuredLocale : "zh-HK-lihkg";
  redirect(`/${locale}`);
}
