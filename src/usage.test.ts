import { describe, expect, it } from 'bun:test';
import type { JsonValue } from '@openchamber/sdk';
import { usageKey, type Profile, type ProfileStorage } from './accounts.ts';
import { translator } from './i18n.ts';
import { describeUsage, loadUsage, parseLimits, type UsageReader } from './usage.ts';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const HOUR = 3_600_000;

// The shape api.anthropic.com/api/oauth/usage answers, trimmed to `limits`.
const LIMITS: JsonValue = [
  { kind: 'session', group: 'session', percent: 6, resets_at: new Date(NOW + 4 * HOUR).toISOString(), scope: null },
  { kind: 'weekly_all', group: 'weekly', percent: 91, resets_at: new Date(NOW + 70 * HOUR).toISOString(), scope: null },
  { kind: 'weekly_scoped', group: 'weekly', percent: 0, resets_at: new Date(NOW + 70 * HOUR).toISOString(), scope: { model: { id: null, display_name: 'Fable' }, surface: null } },
  { kind: 'monthly', group: 'monthly', percent: 1, resets_at: null, scope: null },
];

const profile = (id: string, expiresAt = NOW + 8 * HOUR): Profile => ({
  id,
  savedAt: NOW,
  oauthAccount: { accountUuid: id },
  claudeAiOauth: { accessToken: `token-${id}`, expiresAt },
});

const fakeStorage = (initial: Record<string, JsonValue> = {}) => {
  const map = new Map<string, JsonValue>(Object.entries(initial));
  const storage: ProfileStorage = {
    get: async (key) => map.get(key),
    set: async (key, value) => { map.set(key, structuredClone(value)); },
    delete: async (key) => { map.delete(key); },
    keys: async () => [...map.keys()],
  };
  return { map, storage };
};

const reader = (status = 200) => {
  const calls: string[] = [];
  const read: UsageReader = async (token) => {
    calls.push(token);
    return { status, body: JSON.stringify({ five_hour: {}, limits: LIMITS }) };
  };
  return { calls, read };
};

describe('parseLimits', () => {
  it('names the 5-hour, weekly and model limits and skips unknown groups', () => {
    expect(parseLimits(LIMITS)).toEqual([
      { kind: 'session', scope: null, percent: 6, resetsAt: NOW + 4 * HOUR },
      { kind: 'weekly', scope: null, percent: 91, resetsAt: NOW + 70 * HOUR },
      { kind: 'weekly', scope: 'Fable', percent: 0, resetsAt: NOW + 70 * HOUR },
    ]);
    expect(parseLimits(undefined)).toBeNull();
  });
});

describe('loadUsage', () => {
  it('fetches with each live token, saves the reading, and reuses it within the TTL', async () => {
    const { map, storage } = fakeStorage();
    const { calls, read } = reader();
    const first = await loadUsage(storage, read, [profile('a'), profile('b')], { now: NOW });
    expect(calls).toEqual(['token-a', 'token-b']);
    expect(first.get('a')?.usage?.limits).toHaveLength(3);
    expect(map.get(usageKey('a'))).toMatchObject({ v: 1, fetchedAt: NOW });

    await loadUsage(storage, read, [profile('a')], { now: NOW + 60_000 });
    expect(calls).toHaveLength(2);
    await loadUsage(storage, read, [profile('a')], { now: NOW + 60_000, force: true });
    expect(calls).toHaveLength(3);
  });

  it('keeps the last reading of an account whose access token expired, without calling', async () => {
    const { storage } = fakeStorage({ [usageKey('a')]: { v: 1, fetchedAt: NOW - 5 * HOUR, limits: LIMITS } });
    const { calls, read } = reader();
    const entries = await loadUsage(storage, read, [profile('a', NOW - HOUR)], { now: NOW });
    expect(calls).toEqual([]);
    expect(entries.get('a')).toMatchObject({ usage: { fetchedAt: NOW - 5 * HOUR }, error: null });
  });

  it('reports a failed call next to the cached reading', async () => {
    const { storage } = fakeStorage({ [usageKey('a')]: { v: 1, fetchedAt: NOW - HOUR, limits: LIMITS } });
    const entries = await loadUsage(storage, reader(401).read, [profile('a')], { now: NOW });
    expect(entries.get('a')?.usage?.fetchedAt).toBe(NOW - HOUR);
    expect(String(entries.get('a')?.error)).toContain('HTTP 401');
  });
});

describe('describeUsage', () => {
  const t = translator('en');
  const usage = { fetchedAt: NOW, limits: parseLimits(LIMITS) ?? [] };

  it('labels each limit with its tone and reset time', () => {
    const view = describeUsage({ usage, error: null }, profile('a'), NOW, 'en-US', t, String);
    expect(view.rows.map((row) => [row.label, row.percent, row.tone])).toEqual([
      ['5-hour', 6, 'normal'],
      ['Weekly', 91, 'error'],
      ['Fable', 0, 'normal'],
    ]);
    expect(view.rows[0]?.resets).toStartWith('resets ');
    expect(view.note).toBeNull();
  });

  it('drops the percent of a window that reset since an old reading', () => {
    const view = describeUsage({ usage, error: null }, profile('a'), NOW + 5 * HOUR, 'en-US', t, String);
    expect(view.rows[0]).toMatchObject({ percent: null, resets: 'reset since' });
    expect(view.note).toStartWith('Reading from ');
  });

  it('says why there is nothing to show', () => {
    expect(describeUsage(undefined, profile('a'), NOW, 'en', t, String).note).toBe('Reading usage…');
    expect(describeUsage({ usage: null, error: null }, profile('a', NOW - HOUR), NOW, 'en', t, String).note).toBe(t('usageNoReading'));
  });
});
