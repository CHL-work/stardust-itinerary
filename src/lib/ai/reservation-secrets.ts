export const RESERVATION_SECRET_REDACTION = "[booking secret omitted]";
export const PRIVATE_BOOKING_URL_REDACTION = "[private booking link omitted]";

/**
 * Exact secrets are retained only so a caller can remove an unlabelled copy from
 * later provider output. This context is ephemeral and must never be logged,
 * persisted, or included in provider prompts.
 */
export type ReservationSecretContext = Readonly<{
  detected: boolean;
  credentials: readonly string[];
  privateUrls: readonly string[];
}>;

type RedactionSpan = {
  start: number;
  end: number;
  replacement: string;
};

const credentialLabel = [
  String.raw`booking\s+(?:pin(?:\s*(?:code|number))?|pass(?:word|code)|access\s+code)`,
  String.raw`reservation\s+(?:pin(?:\s*(?:code|number))?|pass(?:word|code)|access\s+code)`,
  String.raw`pin(?:\s*(?:code|number))?`,
  String.raw`password`,
  String.raw`passcode`,
  String.raw`access\s+code`,
  String.raw`door\s+code`,
  String.raw`entry\s+code`,
  String.raw`security\s+code`,
  String.raw`verification\s+code`,
  String.raw`confirmation\s+code`,
  String.raw`予約(?:用)?(?:pin(?:コード|番号)?|暗証番号|パスワード|アクセスコード|入室コード|認証コード|確認コード)`,
  String.raw`pin(?:コード|番号)`,
  String.raw`暗証番号`,
  String.raw`パスワード`,
  String.raw`アクセスコード`,
  String.raw`入室コード`,
  String.raw`入館コード`,
  String.raw`認証コード`,
  String.raw`確認コード`,
  String.raw`預約(?:pin(?:碼|码)?|密碼|密码|通行碼|通行码|驗證碼|验证码|確認碼|确认码)`,
  String.raw`预订(?:pin(?:碼|码)?|密碼|密码|通行碼|通行码|驗證碼|验证码|確認碼|确认码)`,
  String.raw`訂房(?:pin(?:碼|码)?|密碼|密码|通行碼|通行码|驗證碼|验证码)`,
  String.raw`订房(?:pin(?:碼|码)?|密碼|密码|通行碼|通行码|驗證碼|验证码)`,
  String.raw`pin(?:碼|码|編號|编号)`,
  String.raw`密碼`,
  String.raw`密码`,
  String.raw`通行碼`,
  String.raw`通行码`,
  String.raw`存取碼`,
  String.raw`存取码`,
  String.raw`入場碼`,
  String.raw`入场码`,
  String.raw`入室碼`,
  String.raw`入室码`,
  String.raw`門禁碼`,
  String.raw`门禁码`,
  String.raw`驗證碼`,
  String.raw`验证码`,
  String.raw`確認碼`,
  String.raw`确认码`,
].join("|");

const quotedCredentialPattern = new RegExp(
  String.raw`(?:${credentialLabel})\s*(?:(?:[:：=＝#＃])|(?:\bis\b)|係|是|為|为|は)?\s*["'「『]([^"'」』\r\n]{3,128})["'」』]`,
  "giu",
);
const numericCredentialPattern = new RegExp(
  String.raw`(?:${credentialLabel})\s*(?:(?:[:：=＝#＃])|(?:\bis\b)|係|是|為|为|は)?\s*([0-9０-９]{3,12})(?![0-9０-９])`,
  "giu",
);
const explicitBareCredentialPattern = new RegExp(
  String.raw`(?:${credentialLabel})\s*(?:(?:[:：=＝#＃])|(?:\bis\b)|係|是|為|为|は)\s*([\p{L}\p{N}._@#$%*!+\-]{3,128})`,
  "giu",
);
const spacedAlphaNumericCredentialPattern = new RegExp(
  String.raw`(?:${credentialLabel})\s+([\p{L}\p{N}._@#$%*!+\-]{3,128})`,
  "giu",
);
const urlPattern = /https?:\/\/[^\s<>"'`]+/giu;

const placeholderValues = new Set([
  "none",
  "null",
  "unknown",
  "missing",
  "required",
  "needed",
  "omitted",
  "redacted",
  "なし",
  "不明",
  "未設定",
  "必要",
  "冇",
  "沒有",
  "无",
]);

function isUsableCredential(value: string, requireNonLetter = false): boolean {
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < 3 || normalized.length > 128) return false;
  if (placeholderValues.has(normalized.toLocaleLowerCase())) return false;
  if (normalized === RESERVATION_SECRET_REDACTION) return false;
  return !requireNonLetter || /[\p{N}._@#$%*!+\-]/u.test(normalized);
}

function collectPatternCredentials(
  value: string,
  pattern: RegExp,
  requireNonLetter: boolean,
  trimSentencePunctuation = false,
): Array<{ value: string; start: number; end: number }> {
  const credentials: Array<{ value: string; start: number; end: number }> = [];
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const captured = match[1]?.trim();
    const credential = trimSentencePunctuation
      ? captured?.replace(/[.,;!?、。；！？]+$/u, "")
      : captured;
    if (!credential || !isUsableCredential(credential, requireNonLetter)) continue;
    const matchStart = match.index ?? 0;
    const relativeStart = match[0].lastIndexOf(credential);
    if (relativeStart < 0) continue;
    credentials.push({
      value: credential,
      start: matchStart + relativeStart,
      end: matchStart + relativeStart + credential.length,
    });
  }
  return credentials;
}

function credentialMatches(value: string): Array<{ value: string; start: number; end: number }> {
  const candidates = [
    ...collectPatternCredentials(value, quotedCredentialPattern, false),
    ...collectPatternCredentials(value, numericCredentialPattern, false),
    ...collectPatternCredentials(value, explicitBareCredentialPattern, false, true),
    ...collectPatternCredentials(value, spacedAlphaNumericCredentialPattern, true, true),
  ].sort((left, right) => left.start - right.start || right.end - left.end);
  const matches: typeof candidates = [];
  for (const candidate of candidates) {
    if (matches.some((match) => candidate.start >= match.start && candidate.end <= match.end)) continue;
    matches.push(candidate);
  }
  return matches;
}

function safelyDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isCredentialBearingReservationUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return true;

    const path = safelyDecode(url.pathname);
    const reservationWorkflow = /\/(?:reserv(?:e|es|ation|ations)|book(?:ing|ings)?|orders?|receipts?)(?:\/|$)/iu;
    const privateAction = /\/(?:complete|confirmation|confirm|manage|modify|cancel|access|check-?in|view)(?:\/|$)/iu;
    const opaqueManagePath = /\/(?:complete|confirmation|confirm|manage|modify|cancel|access|view)\/[\p{L}\p{N}_-]{4,}(?:\/|$)/iu;
    if ((reservationWorkflow.test(path) && privateAction.test(path)) || opaqueManagePath.test(path)) {
      return true;
    }

    const stronglySensitiveKey = /(?:^|_)(?:access_?token|auth|credential|key|pass(?:word|code)|pin|secret|signature)(?:$|_)/iu;
    const reservationKey = /(?:^|_)(?:booking|code|confirmation|order|receipt|reservation|session|state)(?:$|_)/iu;
    const reservationContext = reservationWorkflow.test(path) || privateAction.test(path);
    for (const [key, queryValue] of url.searchParams) {
      if (!queryValue) continue;
      if (stronglySensitiveKey.test(key) || (reservationContext && reservationKey.test(key))) return true;
    }

    const fragment = safelyDecode(url.hash);
    return Boolean(fragment) && /(?:access_?token|auth|credential|pass(?:word|code)|pin|secret|signature)\s*[:=]/iu.test(fragment);
  } catch {
    return false;
  }
}

function trimUrlPunctuation(rawUrl: string): string {
  return rawUrl.replace(/[),.;:!?\]}、。）」』]+$/u, "");
}

function privateUrlMatches(value: string): Array<{ value: string; start: number; end: number }> {
  const urls: Array<{ value: string; start: number; end: number }> = [];
  urlPattern.lastIndex = 0;
  for (const match of value.matchAll(urlPattern)) {
    const rawUrl = trimUrlPunctuation(match[0]);
    if (!rawUrl || !isCredentialBearingReservationUrl(rawUrl)) continue;
    const start = match.index ?? 0;
    urls.push({ value: rawUrl, start, end: start + rawUrl.length });
  }
  return urls;
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function inspectReservationSecrets(value: string): ReservationSecretContext {
  const credentials = uniqueValues(credentialMatches(value).map((match) => match.value));
  const privateUrls = uniqueValues(privateUrlMatches(value).map((match) => match.value));
  return Object.freeze({
    detected: credentials.length > 0 || privateUrls.length > 0,
    credentials: Object.freeze(credentials),
    privateUrls: Object.freeze(privateUrls),
  });
}

export function containsReservationSecret(value: string): boolean {
  return inspectReservationSecrets(value).detected;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function exactValuePattern(exactValue: string): RegExp {
  const numeric = /^[0-9０-９]+$/u.test(exactValue);
  const beginsWithWord = /^[\p{L}\p{N}]/u.test(exactValue);
  const endsWithWord = /[\p{L}\p{N}]$/u.test(exactValue);
  // Numeric credentials need a slightly stronger boundary so a known PIN such
  // as 2026 does not corrupt a date, amount, phone number, or UUID fragment.
  const prefix = numeric
    ? String.raw`(?<![\p{L}\p{N}:./+\-¥$€£₩₹])`
    : beginsWithWord ? String.raw`(?<![\p{L}\p{N}])` : "";
  const suffix = numeric
    ? String.raw`(?![\p{L}\p{N}:./+\-])`
    : endsWithWord ? String.raw`(?![\p{L}\p{N}])` : "";
  return new RegExp(`${prefix}${escapeRegExp(exactValue)}${suffix}`, "giu");
}

function credentialVariants(credentials: readonly string[]): string[] {
  const variants: string[] = [];
  for (const credential of credentials) {
    const raw = credential.trim();
    const normalized = raw.normalize("NFKC");
    for (const variant of [raw, normalized, encodeURIComponent(raw), encodeURIComponent(normalized)]) {
      if (variant.length >= 3) variants.push(variant);
    }
  }
  return uniqueValues(variants).sort((left, right) => right.length - left.length);
}

function exactMatchSpans(value: string, exactValues: readonly string[], replacement: string): RedactionSpan[] {
  const spans: RedactionSpan[] = [];
  for (const exactValue of exactValues) {
    const pattern = exactValuePattern(exactValue);
    for (const match of value.matchAll(pattern)) {
      const start = match.index ?? 0;
      spans.push({ start, end: start + match[0].length, replacement });
    }
  }
  return spans;
}

function applyRedactionSpans(value: string, spans: RedactionSpan[]): string {
  const selected: RedactionSpan[] = [];
  for (const span of spans.sort((left, right) => left.start - right.start || right.end - left.end)) {
    const prior = selected[selected.length - 1];
    if (prior && span.start < prior.end) continue;
    selected.push(span);
  }
  if (selected.length === 0) return value;

  let result = "";
  let cursor = 0;
  for (const span of selected) {
    result += value.slice(cursor, span.start) + span.replacement;
    cursor = span.end;
  }
  return result + value.slice(cursor);
}

export function containsKnownReservationSecret(
  value: string,
  known: ReservationSecretContext,
): boolean {
  if (containsReservationSecret(value)) return true;
  return credentialVariants(known.credentials).some((credential) =>
    exactValuePattern(credential).test(value))
    || known.privateUrls.some((url) => value.includes(url));
}

export function redactReservationSecrets(
  value: string,
  known: ReservationSecretContext = inspectReservationSecrets(value),
): string {
  const spans: RedactionSpan[] = [
    ...credentialMatches(value).map((match) => ({
      start: match.start,
      end: match.end,
      replacement: RESERVATION_SECRET_REDACTION,
    })),
    ...privateUrlMatches(value).map((match) => ({
      start: match.start,
      end: match.end,
      replacement: PRIVATE_BOOKING_URL_REDACTION,
    })),
    ...exactMatchSpans(value, credentialVariants(known.credentials), RESERVATION_SECRET_REDACTION),
    ...exactMatchSpans(value, known.privateUrls, PRIVATE_BOOKING_URL_REDACTION),
  ];
  return applyRedactionSpans(value, spans);
}
