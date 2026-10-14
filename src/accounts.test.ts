import { describe, expect, it } from 'bun:test';
import type { JsonValue } from '@openchamber/sdk';
import {
  activeLogin,
  ClaudeFileError,
  CONFIG_PATH,
  CREDENTIALS_PATH,
  loadProfiles,
  parseJsonFile,
  profileKey,
  readProfile,
  reconcile,
  removeProfile,
  serializeLike,
  summarize,
  switchAccount,
  type FileAccess,
  type JsonObject,
  type ProfileStorage,
} from './accounts.ts';

const NOW = 1_800_000_000_000;

const account = (letter: string, organization = `org-${letter}`): JsonObject => ({
  accountUuid: `uuid-${letter}`,
  emailAddress: `${letter}@example.com`,
  organizationUuid: organization,
  organizationName: `Org ${letter.toUpperCase()}`,
  displayName: letter.toUpperCase(),
});

const tokens = (letter: string, version = 1): JsonObject => ({
  accessToken: `access-${letter}${version}`,
  refreshToken: `refresh-${letter}${version}`,
  expiresAt: NOW + 3_600_000,
  refreshTokenExpiresAt: NOW + 86_400_000,
  subscriptionType: 'max',
  rateLimitTier: 'default_claude_max_20x',
});

const idOf = (letter: string) => `uuid-${letter}.org-${letter}`;

const credentialsFile = (oauth: JsonObject) => JSON.stringify({ mcpOAuth: { server: { token: 'mcp' } }, claudeAiOauth: oauth });
const configFile = (oauthAccount: JsonObject) => JSON.stringify({ numStartups: 7, projects: { 'C:/dev': { allowedTools: [] } }, oauthAccount }, null, 2);

const fakeFiles = (initial: Record<string, string>) => {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const failing = new Set<string>();
  const access: FileAccess = {
    stat: async (path) => ({ kind: files.has(path) ? 'file' : 'missing' }),
    readFile: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`missing ${path}`);
      return { content };
    },
    writeFile: async (path, content) => {
      if (failing.has(path)) throw new Error('disk full');
      writes.push(path);
      files.set(path, content);
      return { written: true };
    },
  };
  return { files, writes, failing, access };
};

const fakeStorage = (initial: Record<string, JsonValue> = {}) => {
  const map = new Map<string, JsonValue>(Object.entries(initial));
  const storage: ProfileStorage = {
    get: async (key) => map.get(key),
    set: async (key, value) => { map.set(key, structuredClone(value)); },
    delete: async (key) => { map.delete(key); },
    keys: async () => [...map.keys()].sort(),
  };
  return { map, storage };
};

const savedProfile = (letter: string, version = 1): JsonValue => ({
  v: 1,
  id: idOf(letter),
  savedAt: NOW - 1000,
  oauthAccount: account(letter),
  claudeAiOauth: tokens(letter, version),
});

const parse = (text: string | undefined): JsonValue => JSON.parse(text ?? 'null');

describe('serializeLike', () => {
  it('keeps compact files compact and indented files indented', () => {
    const compact = parseJsonFile('a', '{"a":1}');
    expect(serializeLike(compact, { a: 2 })).toBe('{"a":2}');
    const indented = parseJsonFile('b', '{\n    "a": 1\n}\n');
    expect(serializeLike(indented, { a: 2 })).toBe('{\n    "a": 2\n}\n');
  });

  it('keeps CRLF line endings', () => {
    const file = parseJsonFile('c', '{\r\n  "a": 1\r\n}\r\n');
    expect(serializeLike(file, { a: 2 })).toBe('{\r\n  "a": 2\r\n}\r\n');
  });

  it('writes a new file with two spaces', () => {
    expect(serializeLike({ exists: false }, { a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('activeLogin', () => {
  it('is signed out without an access token', () => {
    expect(activeLogin({ credentials: { exists: false }, config: { exists: false } }).kind).toBe('signed-out');
  });

  it('is unidentified when the config names no account', () => {
    const state = {
      credentials: parseJsonFile(CREDENTIALS_PATH, credentialsFile(tokens('a'))),
      config: parseJsonFile(CONFIG_PATH, '{}'),
    };
    expect(activeLogin(state).kind).toBe('unidentified');
  });

  it('identifies the account per organization', () => {
    const state = {
      credentials: parseJsonFile(CREDENTIALS_PATH, credentialsFile(tokens('a'))),
      config: parseJsonFile(CONFIG_PATH, configFile(account('a', 'team-org'))),
    };
    const login = activeLogin(state);
    expect(login.kind === 'signed-in' && login.id).toBe('uuid-a.team-org');
  });

  it('refuses a malformed file instead of treating it as signed out', () => {
    expect(() => parseJsonFile(CONFIG_PATH, '{oops')).toThrow(ClaudeFileError);
    expect(() => parseJsonFile(CONFIG_PATH, '[]')).toThrow(ClaudeFileError);
  });
});

describe('readProfile and loadProfiles', () => {
  it('rejects a record stored under another account key', () => {
    expect(readProfile(profileKey(idOf('b')), savedProfile('a'))).toBeNull();
    expect(readProfile(profileKey(idOf('a')), savedProfile('a'))?.id).toBe(idOf('a'));
  });

  it('reports unreadable records without dropping the readable ones', async () => {
    const { storage } = fakeStorage({
      [profileKey(idOf('a'))]: savedProfile('a'),
      [profileKey('broken')]: { v: 1 },
      'other-key': 'ignored',
    });
    const list = await loadProfiles(storage);
    expect(list.profiles.map((profile) => profile.id)).toEqual([idOf('a')]);
    expect(list.unreadable).toEqual([profileKey('broken')]);
  });
});

describe('reconcile', () => {
  it('saves a newly signed-in account', async () => {
    const files = fakeFiles({ [CREDENTIALS_PATH]: credentialsFile(tokens('a')), [CONFIG_PATH]: configFile(account('a')) });
    const { map, storage } = fakeStorage();
    const snapshot = await reconcile(files.access, storage, NOW);
    expect(snapshot.active.kind).toBe('signed-in');
    expect(snapshot.profiles.map((profile) => profile.id)).toEqual([idOf('a')]);
    expect(map.get(profileKey(idOf('a')))).toMatchObject({ v: 1, savedAt: NOW, claudeAiOauth: tokens('a') });
    expect(files.writes).toEqual([]);
  });

  it('refreshes the saved copy after Claude Code rotates the tokens', async () => {
    const files = fakeFiles({ [CREDENTIALS_PATH]: credentialsFile(tokens('a', 2)), [CONFIG_PATH]: configFile(account('a')) });
    const { map, storage } = fakeStorage({ [profileKey(idOf('a'))]: savedProfile('a', 1) });
    await reconcile(files.access, storage, NOW);
    expect(map.get(profileKey(idOf('a')))).toMatchObject({ claudeAiOauth: { refreshToken: 'refresh-a2' } });
  });

  it('leaves an unchanged login alone', async () => {
    const files = fakeFiles({ [CREDENTIALS_PATH]: credentialsFile(tokens('a')), [CONFIG_PATH]: configFile(account('a')) });
    const stored = savedProfile('a');
    const { map, storage } = fakeStorage({ [profileKey(idOf('a'))]: stored });
    await reconcile(files.access, storage, NOW);
    expect(map.get(profileKey(idOf('a')))).toEqual(stored);
  });

  it('does not file one account’s tokens under another account', async () => {
    // The config names A, but the tokens on disk are B's saved ones.
    const files = fakeFiles({ [CREDENTIALS_PATH]: credentialsFile(tokens('b')), [CONFIG_PATH]: configFile(account('a')) });
    const { map, storage } = fakeStorage({
      [profileKey(idOf('a'))]: savedProfile('a'),
      [profileKey(idOf('b'))]: savedProfile('b'),
    });
    const snapshot = await reconcile(files.access, storage, NOW);
    expect(snapshot.conflictOwnerId).toBe(idOf('b'));
    expect(map.get(profileKey(idOf('a')))).toEqual(savedProfile('a'));
  });
});

describe('switchAccount', () => {
  it('swaps only the login keys and keeps the newest tokens of the account it leaves', async () => {
    const files = fakeFiles({ [CREDENTIALS_PATH]: credentialsFile(tokens('a', 3)), [CONFIG_PATH]: configFile(account('a')) });
    const { map, storage } = fakeStorage({
      [profileKey(idOf('a'))]: savedProfile('a', 1),
      [profileKey(idOf('b'))]: savedProfile('b'),
    });

    const result = await switchAccount(files.access, storage, idOf('b'), NOW);

    expect(result.kind).toBe('switched');
    expect(map.get(profileKey(idOf('a')))).toMatchObject({ claudeAiOauth: { refreshToken: 'refresh-a3' } });
    expect(parse(files.files.get(CREDENTIALS_PATH))).toEqual({ mcpOAuth: { server: { token: 'mcp' } }, claudeAiOauth: tokens('b') });
    expect(parse(files.files.get(CONFIG_PATH))).toEqual({ numStartups: 7, projects: { 'C:/dev': { allowedTools: [] } }, oauthAccount: account('b') });
    expect(files.files.get(CREDENTIALS_PATH)).not.toContain('\n');
    expect(files.files.get(CONFIG_PATH)).toContain('\n  "numStartups": 7');
  });

  it('puts the credentials back when the config cannot be written', async () => {
    const originalCredentials = credentialsFile(tokens('a'));
    const originalConfig = configFile(account('a'));
    const files = fakeFiles({ [CREDENTIALS_PATH]: originalCredentials, [CONFIG_PATH]: originalConfig });
    files.failing.add(CONFIG_PATH);
    const { storage } = fakeStorage({ [profileKey(idOf('b'))]: savedProfile('b') });

    await expect(switchAccount(files.access, storage, idOf('b'), NOW)).rejects.toThrow('disk full');

    expect(files.files.get(CREDENTIALS_PATH)).toBe(originalCredentials);
    expect(files.files.get(CONFIG_PATH)).toBe(originalConfig);
  });

  it('does nothing when the account is already in use', async () => {
    const files = fakeFiles({ [CREDENTIALS_PATH]: credentialsFile(tokens('a')), [CONFIG_PATH]: configFile(account('a')) });
    const { storage } = fakeStorage({ [profileKey(idOf('a'))]: savedProfile('a') });
    const result = await switchAccount(files.access, storage, idOf('a'), NOW);
    expect(result.kind).toBe('already-active');
    expect(files.writes).toEqual([]);
  });

  it('switches from a signed-out Claude Code', async () => {
    const files = fakeFiles({ [CONFIG_PATH]: configFile(account('a')) });
    const { storage } = fakeStorage({ [profileKey(idOf('b'))]: savedProfile('b') });
    await switchAccount(files.access, storage, idOf('b'), NOW);
    expect(parse(files.files.get(CREDENTIALS_PATH))).toEqual({ claudeAiOauth: tokens('b') });
  });

  it('refuses an account that is no longer saved', async () => {
    const files = fakeFiles({ [CREDENTIALS_PATH]: credentialsFile(tokens('a')), [CONFIG_PATH]: configFile(account('a')) });
    const { storage } = fakeStorage();
    await expect(switchAccount(files.access, storage, idOf('b'), NOW)).rejects.toThrow('no longer available');
    expect(files.writes).toEqual([]);
  });
});

describe('removeProfile', () => {
  it('deletes only that account', async () => {
    const { map, storage } = fakeStorage({
      [profileKey(idOf('a'))]: savedProfile('a'),
      [profileKey(idOf('b'))]: savedProfile('b'),
    });
    await removeProfile(storage, idOf('a'));
    expect([...map.keys()]).toEqual([profileKey(idOf('b'))]);
  });
});

describe('summarize', () => {
  it('names the plan and flags an expired login', () => {
    expect(summarize(account('a'), tokens('a'), NOW)).toMatchObject({ email: 'a@example.com', plan: 'Max 20x', loginExpired: false, initial: 'A' });
    expect(summarize(account('a'), { ...tokens('a'), subscriptionType: 'team', rateLimitTier: 'default_claude_max_5x' }, NOW).plan).toBe('Team');
    expect(summarize(account('a'), { ...tokens('a'), refreshTokenExpiresAt: NOW - 1 }, NOW).loginExpired).toBe(true);
  });
});
