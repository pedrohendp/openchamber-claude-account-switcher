import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { reconcile, summarize, switchAccount, type Profile, type Snapshot } from '../src/accounts.ts';
import { translator, type Translate } from '../src/i18n.ts';
import { createQueue, describeError, keepInSync, notify, PANEL_SURFACE } from '../src/runtime.ts';

// The Work Status section: every saved account as one radio row, the one in
// use checked. Clicking another row switches to it. Removing accounts and
// signing in to new ones stay in the rail panel ("Manage accounts").

const css = `
*{box-sizing:border-box}
html,body{margin:0;background:transparent;color:var(--oc-fg);font:13px/1.35 var(--oc-font)}
[data-oc-theme="dark"]{color-scheme:dark}[data-oc-theme="light"]{color-scheme:light}
#root{display:flex;flex-direction:column;gap:2px;padding:2px 0 4px}
.accounts{display:flex;flex-direction:column;gap:1px}
.account{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-height:26px;padding:3px 6px;border-radius:6px;cursor:pointer}
.account:hover:not([aria-disabled="true"]):not([aria-checked="true"]){background:var(--oc-hover)}
.account:focus-visible{box-shadow:inset 0 0 0 2px var(--oc-focus)}
.account[aria-disabled="true"],.account[aria-checked="true"]{cursor:default}
.account[aria-disabled="true"]:not([aria-checked="true"]) .email{color:var(--oc-muted)}
.radio{flex:none;display:grid;place-items:center;width:12px;height:12px;border-radius:50%;border:1.5px solid var(--oc-muted)}
.account[aria-checked="true"] .radio{border-color:var(--oc-primary)}
.account[aria-checked="true"] .radio::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--oc-primary)}
.account[data-switching="true"] .radio{border-color:var(--oc-primary);border-right-color:transparent;animation:spin .7s linear infinite}
.account[data-switching="true"] .radio::after{display:none}
@keyframes spin{to{transform:rotate(360deg)}}
.email{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.account[aria-checked="true"] .email{font-weight:500}
.meta{flex:none;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--oc-muted)}
.meta[data-tone="error"]{color:var(--oc-error-text)}
.note{padding:2px 6px;font-size:12px;color:var(--oc-muted)}
.note[data-tone="warning"]{color:var(--oc-warning-text)}
.note[data-tone="error"]{color:var(--oc-error-text)}
.links{display:flex;flex-wrap:wrap;gap:4px 12px;padding:2px 6px}
.link{all:unset;cursor:pointer;font-size:12px;color:var(--oc-muted)}
.link:hover{color:var(--oc-fg);text-decoration:underline}
.link:focus-visible{border-radius:3px;box-shadow:0 0 0 2px var(--oc-focus)}
@media (prefers-reduced-motion:reduce){.account[data-switching="true"] .radio{animation:none}}
`;

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; snapshot: Snapshot };

const host = connectHost();
const rootElement = document.querySelector<HTMLElement>('#root');
if (!rootElement) throw new Error('no root');
const root: HTMLElement = rootElement;

let t: Translate = translator(undefined);
let locale = '';
let view: View = { kind: 'loading' };
let sessionBusy = false;
let directory: string | null = null;
let switchingId: string | null = null;
let generation = 0;
let lastRenderKey = '';
const exclusive = createQueue();

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const load = async (): Promise<void> => {
  const current = ++generation;
  try {
    const snapshot = await reconcile(host, host.storage);
    if (current !== generation) return;
    view = { kind: 'ready', snapshot };
  } catch (error) {
    if (current !== generation) return;
    view = { kind: 'error', message: describeError(error, t) };
  }
  render();
};

const sync = (): void => {
  if (switchingId) return;
  void exclusive(load);
};

const choose = (profile: Profile): void => {
  if (switchingId) return;
  switchingId = profile.id;
  render();
  void exclusive(async () => {
    const { email } = summarize(profile.oauthAccount, profile.claudeAiOauth, Date.now());
    try {
      const result = await switchAccount(host, host.storage, profile.id);
      notify(host, result.kind === 'switched' ? 'success' : 'info', t(result.kind === 'switched' ? 'switched' : 'alreadyActive', { email }));
    } catch (error) {
      notify(host, 'error', t('switchFailed', { error: describeError(error, t) }));
    } finally {
      switchingId = null;
    }
    await load();
  });
};

const note = (text: string, tone?: 'warning' | 'error'): HTMLElement => {
  const node = element('div', 'note', text);
  if (tone) node.dataset.tone = tone;
  if (tone) node.setAttribute('role', 'status');
  root.append(node);
  return node;
};

const link = (parent: HTMLElement, text: string, onClick: () => void): void => {
  const button = element('button', 'link', text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  parent.append(button);
};

/** Up and down move between rows, as in any radio group; Enter and Space pick. */
const onRowKey = (event: KeyboardEvent): void => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const rows = Array.from(root.querySelectorAll<HTMLButtonElement>('.account'));
  const index = rows.findIndex((row) => row === document.activeElement);
  if (index === -1) return;
  event.preventDefault();
  rows[(index + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
};

const renderAccounts = (snapshot: Snapshot): void => {
  const now = Date.now();
  const { active, profiles, conflictOwnerId } = snapshot;
  const activeId = active.kind === 'signed-in' && !conflictOwnerId ? active.id : null;

  if (conflictOwnerId) note(t('statusConflict'), 'warning');
  else if (active.kind === 'unidentified') note(t('statusUnidentified'), 'warning');
  else if (active.kind === 'signed-out' && profiles.length > 0) note(t('statusSignedOut'));

  if (profiles.length === 0) {
    note(t('statusEmpty'));
    return;
  }

  const emails = profiles.map((profile) => summarize(profile.oauthAccount, profile.claudeAiOauth, now).email);
  const group = element('div', 'accounts');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', t('title'));
  group.addEventListener('keydown', onRowKey);
  for (const profile of profiles) {
    const summary = summarize(profile.oauthAccount, profile.claudeAiOauth, now);
    const checked = profile.id === activeId;
    const switching = profile.id === switchingId;
    // The same person in two organizations: the organization tells the rows apart.
    const sharedEmail = emails.filter((email) => email === summary.email).length > 1;
    const details = [sharedEmail ? summary.organization : null, summary.plan].filter((part): part is string => Boolean(part)).join(' · ');

    const row = element('button', 'account');
    row.type = 'button';
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', checked ? 'true' : 'false');
    const disabled = summary.loginExpired || switchingId !== null;
    row.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if (switching) row.dataset.switching = 'true';
    row.title = [summary.email, summary.organization, summary.plan, summary.loginExpired ? t('expiredHint') : null]
      .filter((part): part is string => Boolean(part)).join('\n');
    row.append(element('span', 'radio'), element('span', 'email', summary.email));
    const meta = element('span', 'meta', summary.loginExpired ? t('expiredShort') : details);
    if (summary.loginExpired) meta.dataset.tone = 'error';
    if (meta.textContent) row.append(meta);
    row.addEventListener('click', () => {
      if (!disabled && !checked) choose(profile);
    });
    group.append(row);
  }
  root.append(group);

  if (sessionBusy && profiles.length > 1) note(t('statusBusy'));
};

const renderKey = (): string => {
  const now = Date.now();
  const visible = view.kind === 'ready'
    ? {
      active: view.snapshot.active.kind === 'signed-in' ? view.snapshot.active.id : view.snapshot.active.kind,
      profiles: view.snapshot.profiles.map((profile) => [profile.id, summarize(profile.oauthAccount, profile.claudeAiOauth, now)]),
      conflict: view.snapshot.conflictOwnerId,
    }
    : view;
  return JSON.stringify([locale, visible, sessionBusy, switchingId, Boolean(directory)]);
};

function render(): void {
  const key = renderKey();
  if (key === lastRenderKey) return;
  lastRenderKey = key;
  const focusedIndex = Array.from(root.querySelectorAll('.account')).findIndex((row) => row === document.activeElement);
  root.replaceChildren();

  if (view.kind === 'loading') {
    note(t('loading'));
    return;
  }
  if (view.kind === 'error') {
    note(`${t('readFailed')}: ${view.message}`, 'error');
  } else {
    renderAccounts(view.snapshot);
  }

  const links = element('div', 'links');
  // Opening the rail panel needs an open project; without one the host has no rail to show.
  if (directory) link(links, t('manage'), () => void host.openSurface(PANEL_SURFACE).catch(() => {}));
  link(links, view.kind === 'error' ? t('retry') : t('refresh'), sync);
  root.append(links);

  if (focusedIndex !== -1) root.querySelectorAll<HTMLElement>('.account')[focusedIndex]?.focus();
}

// The host sizes the section's frame to this, up to its maximum; past that the page scrolls.
let reportedHeight = -1;
new ResizeObserver(() => {
  const height = Math.ceil(root.getBoundingClientRect().height);
  if (height === reportedHeight) return;
  reportedHeight = height;
  void host.setHeight(height).catch(() => {});
}).observe(root);

host.onSession((session) => {
  sessionBusy = Boolean(session?.busy);
  render();
});

host.onDirectory((next) => {
  directory = next;
  render();
});

// Claude Code may refresh its tokens during a turn; save them once it ends.
host.onSessionLifecycle((event) => {
  if (event.phase === 'completed') sync();
});

let started = false;
host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  locale = ctx.locale;
  t = translator(ctx.locale);
  sessionBusy = Boolean(ctx.session?.busy);
  directory = ctx.directory;
  if (started) {
    render();
    return;
  }
  started = true;
  document.head.append(element('style', '', css));
  render();
  void exclusive(load);
  keepInSync(host, sync);
});
