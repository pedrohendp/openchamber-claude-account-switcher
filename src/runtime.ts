import { HostRequestError, type HostClient } from '@openchamber/sdk';
import { CONFIG_PATH, CREDENTIALS_PATH } from './accounts.ts';
import type { Translate } from './i18n.ts';
import { USAGE_SERVICE_PATH, type UsageReader } from './usage.ts';

// Pieces both pages (the rail panel and the Work Status section) share. Each
// page is its own iframe and bundle, so this is code reuse, not shared state:
// the Claude Code files and the extension storage are the only shared state.

export const LOGIN_COMMAND = 'claude auth login --claudeai';

/**
 * While a page is visible it checks the size and modification time of the two
 * Claude Code files this often. A change (a switch from the other page, a
 * sign-in from a terminal, Claude Code rotating its tokens) triggers a full
 * re-read right away.
 */
const WATCH_MS = 3_000;

/**
 * Full re-read regardless of the files, for changes that only touch the
 * extension storage, such as an account removed from the other page.
 */
const RESYNC_MS = 30_000;

/** The rail panel, as `host.openSurface` names it. */
export const PANEL_SURFACE = 'plugin:claude-accounts';

export const describeError = (error: unknown, t: Translate): string => {
  if (error instanceof HostRequestError) {
    if (error.code === 'NOT_GRANTED') return t('notGranted');
    if (error.code === 'NO_SERVICE') return t('noService');
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
};

/** Asks the extension's local service for one account's usage. */
export const usageReader = (host: HostClient): UsageReader => (token) => (
  host.serviceRequest({ method: 'POST', path: USAGE_SERVICE_PATH, body: JSON.stringify({ token }) })
);

/** Errors stay until dismissed and can be copied; other toasts time out. */
export const notify = (host: HostClient, kind: 'info' | 'success' | 'error', message: string): void => {
  void host.toast({ kind, message, ...(kind === 'error' ? { dismiss: true, copy: true } : {}) }).catch(() => {});
};

/** Runs one operation at a time, so a background re-read never interleaves with a switch. */
export const createQueue = (): ((task: () => Promise<void>) => Promise<void>) => {
  let queue: Promise<void> = Promise.resolve();
  return (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };
};

/**
 * Calls `sync` when the page becomes visible, as soon as either Claude Code
 * file changes while it is visible, and every `RESYNC_MS` regardless.
 */
export const keepInSync = (host: HostClient, sync: () => void): void => {
  const visible = (): boolean => document.visibilityState === 'visible';
  let fingerprint: string | null = null;
  let checking = false;
  const check = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      const stats = await Promise.all([CREDENTIALS_PATH, CONFIG_PATH].map((path) => host.stat(path)));
      const next = JSON.stringify(stats.map(({ kind, size, mtime }) => [kind, size, mtime]));
      if (fingerprint !== null && next !== fingerprint) sync();
      fingerprint = next;
    } catch {
      // A failed check changes nothing; the next full re-read reports the error.
    } finally {
      checking = false;
    }
  };
  // Take the baseline now, so a change in the first interval is not mistaken for it.
  void check();
  document.addEventListener('visibilitychange', () => {
    if (visible()) sync();
  });
  setInterval(() => {
    if (visible()) void check();
  }, WATCH_MS);
  setInterval(() => {
    if (visible()) sync();
  }, RESYNC_MS);
};
