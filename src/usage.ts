import type { JsonValue } from '@openchamber/sdk';
import { isJsonObject, usageKey, type Profile, type ProfileStorage } from './accounts.ts';
import type { Translate } from './i18n.ts';

// How much of each plan limit an account has used, as Claude Code's /usage
// shows it: the 5-hour session, the week, and weekly limits of one model
// (Fable). Anthropic answers with the account's own access token; the call
// goes through the extension's local service (service/main.ts). Readings are
// kept per account, so an account whose access token has expired still shows
// its last one.

/** The service route that fetches one account's usage. */
export const USAGE_SERVICE_PATH = '/usage';

/** A reading younger than this is reused, so both pages and quick reopenings share one call. */
const USAGE_TTL_MS = 2 * 60_000;

/** An access token this close to expiring is left alone; Claude Code renews it on its own. */
const TOKEN_MARGIN_MS = 60_000;

/** An older reading says when it was taken. */
const STALE_MS = 5 * 60_000;

export type UsageLimit = {
  /** `session` is the 5-hour window, `weekly` the 7-day one. */
  kind: 'session' | 'weekly';
  /** The model (or surface) a scoped limit covers, such as `Fable`. */
  scope: string | null;
  percent: number;
  resetsAt: number | null;
};

export type Usage = { fetchedAt: number; limits: UsageLimit[] };

export type UsageEntry = {
  usage: Usage | null;
  /** Why the last attempt failed. A cached reading may still be shown. */
  error: unknown;
};

/** Sends one access token to the service; `host.serviceRequest` answers it. */
export type UsageReader = (accessToken: string) => Promise<{ status: number; body: string }>;

/**
 * The last call per account and how it ended, kept by each page. A failed
 * call is not retried before the TTL either, so a rejected token or a rate
 * limit does not turn every re-read into another request.
 */
export type UsageAttempts = Map<string, { at: number; error: unknown }>;

const scopeName = (scope: JsonValue | undefined): string | null => {
  if (!isJsonObject(scope)) return null;
  for (const part of [scope.model, scope.surface]) {
    if (isJsonObject(part) && typeof part.display_name === 'string' && part.display_name.trim()) return part.display_name;
  }
  return null;
};

/** The `limits` list of Anthropic's answer. Kinds this version cannot name are skipped. */
export const parseLimits = (value: JsonValue | undefined): UsageLimit[] | null => {
  if (!Array.isArray(value)) return null;
  const limits: UsageLimit[] = [];
  for (const item of value) {
    if (!isJsonObject(item) || typeof item.percent !== 'number') continue;
    const kind = item.group === 'session' || item.group === 'weekly' ? item.group : null;
    if (!kind) continue;
    const resetsAt = typeof item.resets_at === 'string' ? Date.parse(item.resets_at) : Number.NaN;
    limits.push({ kind, scope: scopeName(item.scope), percent: item.percent, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null });
  }
  return limits;
};

const readCached = (value: JsonValue | undefined): Usage | null => {
  if (!isJsonObject(value) || value.v !== 1 || typeof value.fetchedAt !== 'number') return null;
  const limits = parseLimits(value.limits);
  return limits ? { fetchedAt: value.fetchedAt, limits } : null;
};

const accessToken = (profile: Profile, now: number): string | null => {
  const { accessToken: token, expiresAt } = profile.claudeAiOauth;
  if (typeof token !== 'string' || !token) return null;
  return typeof expiresAt === 'number' && expiresAt <= now + TOKEN_MARGIN_MS ? null : token;
};

/**
 * The usage of every saved account. A cached reading older than the TTL (or
 * any, with `force`) is replaced when the account's access token still works.
 * Expired tokens are not renewed here: renewing rotates the refresh token, and
 * a switch from the other page could then put a revoked one on disk.
 */
export const loadUsage = async (
  storage: ProfileStorage,
  read: UsageReader,
  profiles: readonly Profile[],
  options: { now?: number; force?: boolean; attempts?: UsageAttempts } = {},
): Promise<Map<string, UsageEntry>> => {
  const now = options.now ?? Date.now();
  const attempts = options.attempts ?? new Map();
  const entries = await Promise.all(profiles.map(async (profile): Promise<[string, UsageEntry]> => {
    let usage = readCached(await storage.get(usageKey(profile.id)));
    const token = accessToken(profile, now);
    if (!token) return [profile.id, { usage, error: null }];
    const fresh = usage !== null && now - usage.fetchedAt < USAGE_TTL_MS;
    const attempt = attempts.get(profile.id);
    if (!options.force && fresh) return [profile.id, { usage, error: null }];
    if (!options.force && attempt && now - attempt.at < USAGE_TTL_MS) return [profile.id, { usage, error: attempt.error }];
    attempts.set(profile.id, { at: now, error: null });
    try {
      const answer = await read(token);
      if (answer.status !== 200) throw new Error(`HTTP ${answer.status}`);
      const body: JsonValue = JSON.parse(answer.body);
      const raw = isJsonObject(body) ? body.limits : undefined;
      const limits = parseLimits(raw);
      if (!limits || raw === undefined) throw new Error('unexpected answer');
      usage = { fetchedAt: now, limits };
      await storage.set(usageKey(profile.id), { v: 1, fetchedAt: now, limits: raw });
      return [profile.id, { usage, error: null }];
    } catch (error) {
      attempts.set(profile.id, { at: now, error });
      return [profile.id, { usage, error }];
    }
  }));
  return new Map(entries);
};

export type UsageRow = {
  label: string;
  /** Null once the window has reset since the reading. */
  percent: number | null;
  tone: 'normal' | 'warning' | 'error';
  resets: string | null;
  resetsTitle: string | null;
};

export type UsageView = { rows: UsageRow[]; note: string | null; noteTone: 'error' | null };

const sameDay = (left: number, right: number): boolean => new Date(left).toDateString() === new Date(right).toDateString();

const shortTime = (time: number, now: number, locale: string): string => new Intl.DateTimeFormat(locale || undefined, sameDay(time, now)
  ? { hour: '2-digit', minute: '2-digit' }
  : { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(time);

/**
 * What to show for one account, as plain data both pages render and compare.
 * Times are absolute ("resets 13:19"), so the text only changes with the data.
 */
export const describeUsage = (
  entry: UsageEntry | undefined,
  profile: Profile,
  now: number,
  locale: string,
  t: Translate,
  errorText: (error: unknown) => string,
): UsageView => {
  if (!entry) return { rows: [], note: t('usageLoading'), noteTone: null };
  const { usage, error } = entry;
  const failed = error ? t('usageFailed', { error: errorText(error) }) : null;
  if (!usage) {
    if (failed) return { rows: [], note: failed, noteTone: 'error' };
    return { rows: [], note: t(accessToken(profile, now) ? 'usageLoading' : 'usageNoReading'), noteTone: null };
  }
  const rows = usage.limits.map((limit): UsageRow => {
    const reset = limit.resetsAt !== null && limit.resetsAt <= now;
    const percent = reset ? null : Math.round(limit.percent);
    return {
      label: limit.scope ?? t(limit.kind === 'session' ? 'usageSession' : 'usageWeekly'),
      percent,
      tone: percent === null || percent < 70 ? 'normal' : percent < 90 ? 'warning' : 'error',
      resets: limit.resetsAt === null ? null : reset ? t('usageWasReset') : t('usageResets', { time: shortTime(limit.resetsAt, now, locale) }),
      resetsTitle: limit.resetsAt === null ? null : new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'full', timeStyle: 'short' }).format(limit.resetsAt),
    };
  });
  if (failed) return { rows, note: failed, noteTone: 'error' };
  if (rows.length === 0) return { rows, note: t('usageNone'), noteTone: null };
  const stale = now - usage.fetchedAt >= STALE_MS;
  return { rows, note: stale ? t('usageReadAt', { time: shortTime(usage.fetchedAt, now, locale) }) : null, noteTone: null };
};

export const USAGE_CSS = `
.usage{display:grid;grid-template-columns:auto minmax(24px,1fr) auto auto;align-items:center;gap:2px 8px;font-size:11.5px;line-height:1.35}
.usage-label{color:var(--oc-muted);white-space:nowrap}
.usage-bar{height:4px;border-radius:2px;background:var(--oc-border);overflow:hidden}
.usage-bar>span{display:block;height:100%;background:var(--oc-success)}
.usage-bar[data-tone="warning"]>span{background:var(--oc-warning)}
.usage-bar[data-tone="error"]>span{background:var(--oc-error)}
.usage-percent{text-align:right;font-variant-numeric:tabular-nums}
.usage-resets{color:var(--oc-muted);white-space:nowrap}
.usage-note{grid-column:1/-1;font-size:11px;color:var(--oc-muted);overflow-wrap:anywhere}
.usage-note[data-tone="error"]{color:var(--oc-error-text)}
`;

const span = (className: string, text = ''): HTMLSpanElement => {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
};

/** One grid: label, bar, percent and reset time per limit, then the note. */
export const usageBlock = (view: UsageView): HTMLElement => {
  const block = document.createElement('div');
  block.className = 'usage';
  for (const row of view.rows) {
    const bar = span('usage-bar');
    bar.dataset.tone = row.tone;
    bar.setAttribute('role', 'meter');
    bar.setAttribute('aria-label', row.label);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(row.percent ?? 0));
    const fill = span('');
    fill.style.width = `${Math.min(100, Math.max(0, row.percent ?? 0))}%`;
    bar.append(fill);
    const resets = span('usage-resets', row.resets ?? '');
    if (row.resetsTitle) resets.title = row.resetsTitle;
    block.append(span('usage-label', row.label), bar, span('usage-percent', row.percent === null ? '–' : `${row.percent}%`), resets);
  }
  if (view.note) {
    const note = span('usage-note', view.note);
    if (view.noteTone) note.dataset.tone = view.noteTone;
    block.append(note);
  }
  return block;
};
