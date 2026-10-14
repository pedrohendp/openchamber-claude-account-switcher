import type { JsonValue } from '@openchamber/sdk';

// Claude Code keeps its login in two files. `~/.claude/.credentials.json`
// holds the OAuth tokens under `claudeAiOauth` (next to unrelated MCP tokens),
// and `~/.claude.json` names the account those tokens belong to under
// `oauthAccount` (next to every other CLI setting). Switching accounts means
// replacing exactly those two keys and leaving everything else as written.

export const CREDENTIALS_PATH = '~/.claude/.credentials.json';
export const CONFIG_PATH = '~/.claude.json';

const PROFILE_KEY_PREFIX = 'account:';

export type JsonObject = { [key: string]: JsonValue };

export const isJsonObject = (value: JsonValue | undefined): value is JsonObject => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const stringField = (object: JsonObject, key: string): string | null => {
  const value = object[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

const numberField = (object: JsonObject, key: string): number | null => {
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** Host file calls this module needs; `connectHost()` satisfies it. */
export type FileAccess = {
  stat: (path: string) => Promise<{ kind: string }>;
  readFile: (path: string) => Promise<{ content: string }>;
  writeFile: (path: string, content: string) => Promise<unknown>;
};

/** Extension storage calls this module needs; `host.storage` satisfies it. */
export type ProfileStorage = {
  get: (key: string) => Promise<JsonValue | undefined>;
  set: (key: string, value: JsonValue) => Promise<void>;
  delete: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
};

export class ClaudeFileError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ClaudeFileError';
    this.path = path;
  }
}

export type JsonFile =
  | { exists: false }
  | { exists: true; raw: string; value: JsonObject };

const parseJson = (raw: string): JsonValue => JSON.parse(raw);

export const parseJsonFile = (path: string, raw: string): JsonFile => {
  let value: JsonValue;
  try {
    value = parseJson(raw);
  } catch (error) {
    throw new ClaudeFileError(path, `not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isJsonObject(value)) {
    throw new ClaudeFileError(path, 'expected a JSON object');
  }
  return { exists: true, raw, value };
};

export const readJsonFile = async (files: FileAccess, path: string): Promise<JsonFile> => {
  const stat = await files.stat(path);
  if (stat.kind === 'missing') return { exists: false };
  if (stat.kind !== 'file') throw new ClaudeFileError(path, `is a ${stat.kind}, not a file`);
  return parseJsonFile(path, (await files.readFile(path)).content);
};

/**
 * Serializes `value` the way `file` was written: same indentation, same line
 * endings, same trailing newline. Claude Code writes the credentials compact
 * and the config with two spaces; a new file gets two spaces.
 */
export const serializeLike = (file: JsonFile, value: JsonObject): string => {
  if (!file.exists) return JSON.stringify(value, null, 2);
  const indent = /\n([ \t]+)"/.exec(file.raw)?.[1];
  const multiline = file.raw.includes('\n');
  let text = JSON.stringify(value, null, multiline ? indent ?? 2 : undefined);
  if (file.raw.includes('\r\n')) text = text.replace(/\n/g, '\r\n');
  if (/\r?\n$/.test(file.raw)) text += file.raw.endsWith('\r\n') ? '\r\n' : '\n';
  return text;
};

export type ClaudeState = {
  credentials: JsonFile;
  config: JsonFile;
};

export const readClaudeState = async (files: FileAccess): Promise<ClaudeState> => {
  const [credentials, config] = await Promise.all([
    readJsonFile(files, CREDENTIALS_PATH),
    readJsonFile(files, CONFIG_PATH),
  ]);
  return { credentials, config };
};

/**
 * Stable id for one login. The same person can sign in to several
 * organizations, and each gets its own tokens, so the organization is part of
 * the id. Only UUID characters are kept so the id is safe in a storage key.
 */
export const accountId = (oauthAccount: JsonObject): string | null => {
  const account = stringField(oauthAccount, 'accountUuid');
  if (!account || !/^[A-Za-z0-9-]{1,64}$/.test(account)) return null;
  const organization = stringField(oauthAccount, 'organizationUuid');
  if (organization && !/^[A-Za-z0-9-]{1,64}$/.test(organization)) return null;
  return organization ? `${account}.${organization}` : account;
};

export type ActiveLogin =
  | { kind: 'signed-out' }
  | { kind: 'unidentified' }
  | { kind: 'signed-in'; id: string; oauthAccount: JsonObject; claudeAiOauth: JsonObject };

export const activeLogin = (state: ClaudeState): ActiveLogin => {
  const oauth = state.credentials.exists ? state.credentials.value.claudeAiOauth : undefined;
  if (!isJsonObject(oauth) || !stringField(oauth, 'accessToken')) return { kind: 'signed-out' };
  const account = state.config.exists ? state.config.value.oauthAccount : undefined;
  const id = isJsonObject(account) ? accountId(account) : null;
  if (!isJsonObject(account) || !id) return { kind: 'unidentified' };
  return { kind: 'signed-in', id, oauthAccount: account, claudeAiOauth: oauth };
};

export type Profile = {
  id: string;
  savedAt: number;
  oauthAccount: JsonObject;
  claudeAiOauth: JsonObject;
};

export const profileKey = (id: string): string => `${PROFILE_KEY_PREFIX}${id}`;

/** The last usage reading of an account (src/usage.ts). */
export const usageKey = (id: string): string => `usage:${id}`;

const profileJson = (profile: Profile): JsonObject => ({
  v: 1,
  id: profile.id,
  savedAt: profile.savedAt,
  oauthAccount: profile.oauthAccount,
  claudeAiOauth: profile.claudeAiOauth,
});

export const readProfile = (key: string, value: JsonValue | undefined): Profile | null => {
  if (!isJsonObject(value) || value.v !== 1) return null;
  const { oauthAccount, claudeAiOauth } = value;
  const savedAt = numberField(value, 'savedAt');
  if (!isJsonObject(oauthAccount) || !isJsonObject(claudeAiOauth) || savedAt === null) return null;
  const id = accountId(oauthAccount);
  if (!id || value.id !== id || key !== profileKey(id) || !stringField(claudeAiOauth, 'accessToken')) return null;
  return { id, savedAt, oauthAccount, claudeAiOauth };
};

export type ProfileList = {
  profiles: Profile[];
  /** Keys that hold something this version cannot read. They are left untouched. */
  unreadable: string[];
};

export const loadProfiles = async (storage: ProfileStorage): Promise<ProfileList> => {
  const keys = (await storage.keys()).filter((key) => key.startsWith(PROFILE_KEY_PREFIX));
  const profiles: Profile[] = [];
  const unreadable: string[] = [];
  for (const key of keys) {
    const profile = readProfile(key, await storage.get(key));
    if (profile) profiles.push(profile); else unreadable.push(key);
  }
  return { profiles: sortProfiles(profiles), unreadable };
};

const sameToken = (left: JsonObject, right: JsonObject, key: string): boolean => {
  const value = stringField(left, key);
  return value !== null && value === stringField(right, key);
};

export type TrackPlan =
  | { kind: 'unchanged'; profile: Profile }
  | { kind: 'save'; profile: Profile }
  /**
   * The tokens on disk are a saved login of a different account than the one
   * `~/.claude.json` names. Saving them under the named account would put one
   * account's tokens under another's name, so nothing is saved.
   */
  | { kind: 'conflict'; ownerId: string };

/**
 * What to store for the signed-in account. Claude Code rotates its tokens
 * while it runs, so the saved copy is refreshed whenever it differs; an old
 * refresh token may no longer work when the user switches back.
 */
export const planTrack = (
  active: Extract<ActiveLogin, { kind: 'signed-in' }>,
  profiles: readonly Profile[],
  now: number,
): TrackPlan => {
  const owner = profiles.find((profile) => profile.id !== active.id && (
    sameToken(profile.claudeAiOauth, active.claudeAiOauth, 'refreshToken')
    || sameToken(profile.claudeAiOauth, active.claudeAiOauth, 'accessToken')
  ));
  if (owner) return { kind: 'conflict', ownerId: owner.id };
  const saved = profiles.find((profile) => profile.id === active.id);
  if (
    saved
    && JSON.stringify(saved.claudeAiOauth) === JSON.stringify(active.claudeAiOauth)
    && JSON.stringify(saved.oauthAccount) === JSON.stringify(active.oauthAccount)
  ) {
    return { kind: 'unchanged', profile: saved };
  }
  return {
    kind: 'save',
    profile: { id: active.id, savedAt: now, oauthAccount: active.oauthAccount, claudeAiOauth: active.claudeAiOauth },
  };
};

export type Snapshot = {
  active: ActiveLogin;
  profiles: Profile[];
  unreadable: string[];
  /** Set when the active tokens belong to another saved account. */
  conflictOwnerId: string | null;
};

/** Reads both Claude files and the saved logins, and stores the signed-in one. */
export const reconcile = async (files: FileAccess, storage: ProfileStorage, now = Date.now()): Promise<Snapshot> => {
  const [state, list] = await Promise.all([readClaudeState(files), loadProfiles(storage)]);
  const active = activeLogin(state);
  let profiles = list.profiles;
  let conflictOwnerId: string | null = null;
  if (active.kind === 'signed-in') {
    const plan = planTrack(active, profiles, now);
    if (plan.kind === 'conflict') {
      conflictOwnerId = plan.ownerId;
    } else if (plan.kind === 'save') {
      await storage.set(profileKey(plan.profile.id), profileJson(plan.profile));
      profiles = sortProfiles([...profiles.filter((profile) => profile.id !== plan.profile.id), plan.profile]);
    }
  }
  return { active, profiles, unreadable: list.unreadable, conflictOwnerId };
};

export class SwitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwitchError';
  }
}

export type SwitchResult =
  | { kind: 'already-active'; profile: Profile }
  | { kind: 'switched'; profile: Profile };

/**
 * Makes `targetId` the Claude Code login. The current login is saved first,
 * from a fresh read, so its newest tokens are kept. The credentials are
 * written before the config; if the config write fails the credentials are
 * put back, so the two files never name different accounts.
 */
export const switchAccount = async (
  files: FileAccess,
  storage: ProfileStorage,
  targetId: string,
  now = Date.now(),
): Promise<SwitchResult> => {
  const snapshot = await reconcile(files, storage, now);
  if (snapshot.active.kind === 'signed-in' && snapshot.active.id === targetId && snapshot.conflictOwnerId === null) {
    const current = snapshot.profiles.find((profile) => profile.id === targetId);
    if (current) return { kind: 'already-active', profile: current };
  }
  const target = readProfile(profileKey(targetId), await storage.get(profileKey(targetId)));
  if (!target) throw new SwitchError('That saved account is no longer available. Refresh the list.');

  const credentials = await readJsonFile(files, CREDENTIALS_PATH);
  const nextCredentials = serializeLike(credentials, {
    ...(credentials.exists ? credentials.value : {}),
    claudeAiOauth: target.claudeAiOauth,
  });
  const config = await readJsonFile(files, CONFIG_PATH);
  const nextConfig = serializeLike(config, {
    ...(config.exists ? config.value : {}),
    oauthAccount: target.oauthAccount,
  });

  await files.writeFile(CREDENTIALS_PATH, nextCredentials);
  try {
    await files.writeFile(CONFIG_PATH, nextConfig);
  } catch (error) {
    try {
      await files.writeFile(CREDENTIALS_PATH, credentials.exists ? credentials.raw : '{}');
    } catch {
      throw new SwitchError(
        `Could not update ${CONFIG_PATH}, and restoring ${CREDENTIALS_PATH} failed too. Sign in to Claude Code again.`,
      );
    }
    throw error;
  }

  const after = activeLogin(await readClaudeState(files));
  if (after.kind !== 'signed-in' || after.id !== target.id) {
    throw new SwitchError('Claude Code files changed during the switch. Refresh and try again.');
  }
  return { kind: 'switched', profile: target };
};

export const removeProfile = async (storage: ProfileStorage, id: string): Promise<void> => {
  await storage.delete(profileKey(id));
  await storage.delete(usageKey(id));
};

export type AccountSummary = {
  email: string;
  name: string | null;
  organization: string | null;
  plan: string | null;
  /** The refresh token has expired: Claude Code cannot renew this login. */
  loginExpired: boolean;
  initial: string;
};

const sortKey = (profile: Profile): string => [
  stringField(profile.oauthAccount, 'emailAddress') ?? '',
  stringField(profile.oauthAccount, 'organizationName') ?? '',
  profile.id,
].join('\u0000').toLowerCase();

/** By email, then organization, so the list keeps its order across reloads. */
export const sortProfiles = (profiles: Profile[]): Profile[] => (
  profiles.sort((left, right) => sortKey(left).localeCompare(sortKey(right)))
);

const PLAN_NAMES: Record<string, string> = {
  pro: 'Pro',
  max: 'Max',
  team: 'Team',
  enterprise: 'Enterprise',
};

const planLabel = (claudeAiOauth: JsonObject): string | null => {
  const subscription = stringField(claudeAiOauth, 'subscriptionType');
  if (!subscription) return null;
  const key = subscription.toLowerCase();
  const name = PLAN_NAMES[key] ?? `${subscription.charAt(0).toUpperCase()}${subscription.slice(1)}`;
  if (key !== 'max') return name;
  const multiplier = /_(\d+x)$/.exec(stringField(claudeAiOauth, 'rateLimitTier') ?? '')?.[1];
  return multiplier ? `${name} ${multiplier}` : name;
};

export const summarize = (oauthAccount: JsonObject, claudeAiOauth: JsonObject, now: number): AccountSummary => {
  const email = stringField(oauthAccount, 'emailAddress') ?? stringField(oauthAccount, 'accountUuid') ?? '?';
  const organization = stringField(oauthAccount, 'organizationName');
  const refreshExpiresAt = numberField(claudeAiOauth, 'refreshTokenExpiresAt');
  return {
    email,
    name: stringField(oauthAccount, 'displayName'),
    organization,
    plan: planLabel(claudeAiOauth),
    loginExpired: refreshExpiresAt !== null && refreshExpiresAt <= now,
    initial: email.charAt(0).toUpperCase(),
  };
};
