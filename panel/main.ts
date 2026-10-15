import { connectHost } from '@openchamber/sdk';
import { applyHostReady, mountBadge, mountBanner, mountButton, mountSpinner } from '@openchamber/sdk/ui';
import {
  createSettle,
  removeProfile,
  reconcile,
  summarize,
  switchAccount,
  type AccountSummary,
  type Profile,
  type Snapshot,
} from '../src/accounts.ts';
import { translator, type Translate } from '../src/i18n.ts';
import { createQueue, createSettleTimer, describeError, keepInSync, LOGIN_COMMAND, notify as toast, usageReader } from '../src/runtime.ts';
import { describeUsage, loadUsage, USAGE_CSS, usageBlock, type UsageAttempts, type UsageEntry, type UsageView } from '../src/usage.ts';

const css = `
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--oc-bg);color:var(--oc-fg);font-family:var(--oc-font);font-size:13px;line-height:1.45}
[data-oc-theme="dark"]{color-scheme:dark}[data-oc-theme="light"]{color-scheme:light}[hidden]{display:none!important}
.app{display:flex;flex-direction:column;gap:16px;padding:12px 12px 20px}
.head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.head h1{margin:0;font-size:13px;font-weight:600}
.body{display:flex;flex-direction:column;gap:16px}
.section{display:flex;flex-direction:column;gap:8px}
.section-title{margin:0;font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--oc-muted)}
.account{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--oc-border);border-radius:10px;min-width:0}
.account[data-active="true"]{border-color:var(--oc-primary);background:var(--oc-muted-surface)}
.account-top{display:flex;align-items:center;gap:10px;min-width:0}
.avatar{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--oc-selection);color:var(--oc-selection-fg);font-weight:600;font-size:12px}
.who{flex:1;min-width:0}
.email{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{font-size:11.5px;color:var(--oc-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badges{display:flex;flex-wrap:wrap;gap:4px}
.actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px}
.confirm{font-size:12px}
.hint{margin:0;font-size:12px;color:var(--oc-muted)}
.command{display:flex;align-items:center;gap:6px}
.command code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 7px;border-radius:6px;background:var(--oc-muted-surface);font:11.5px var(--oc-mono)}
.note{margin:0;padding-top:12px;border-top:1px solid var(--oc-border);font-size:11px;color:var(--oc-muted)}
.center{display:flex;justify-content:center;padding:24px 0}
${USAGE_CSS}
`;

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; snapshot: Snapshot };

type Pending = { kind: 'switch' | 'remove'; id: string } | null;

type Disposable = { dispose: () => void };

const host = connectHost();
const root = document.querySelector('#root');
if (!root) throw new Error('no root');

let t: Translate = translator(undefined);
let locale = '';
let view: View = { kind: 'loading' };
let sessionBusy = false;
let pending: Pending = null;
let confirmRemoveId: string | null = null;
let generation = 0;
let lastRenderKey = '';
let usage: Map<string, UsageEntry> | null = null;
let usageGeneration = 0;
let forceUsage = false;
const readUsage = usageReader(host);
const usageAttempts: UsageAttempts = new Map();

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const notify = (kind: 'info' | 'success' | 'error', message: string): void => toast(host, kind, message);

const errorText = (error: unknown): string => describeError(error, t);

const exclusive = createQueue();
const settle = createSettle();

const load = async (showSpinner: boolean): Promise<void> => {
  const current = ++generation;
  if (showSpinner) {
    view = { kind: 'loading' };
    render();
  }
  try {
    const snapshot = await reconcile(host, host.storage, Date.now(), settle);
    if (current !== generation) return;
    view = { kind: 'ready', snapshot };
    resyncWhenSettled(snapshot.settlingMs);
  } catch (error) {
    if (current !== generation) return;
    view = { kind: 'error', message: errorText(error) };
  }
  render();
  void refreshUsage();
};

/** Every account's usage; a reading younger than two minutes is reused unless Refresh was pressed. */
async function refreshUsage(): Promise<void> {
  if (view.kind !== 'ready') return;
  const { profiles } = view.snapshot;
  const force = forceUsage;
  forceUsage = false;
  const current = ++usageGeneration;
  let next: Map<string, UsageEntry>;
  try {
    next = await loadUsage(host.storage, readUsage, profiles, { force, attempts: usageAttempts });
  } catch (error) {
    next = new Map(profiles.map((profile) => [profile.id, { usage: null, error }]));
  }
  if (current !== usageGeneration) return;
  usage = next;
  render();
}

const sync = (): void => {
  if (pending) return;
  void exclusive(() => load(false));
};

const resyncWhenSettled = createSettleTimer(sync);

const use = (profile: Profile, summary: AccountSummary): void => {
  if (pending) return;
  pending = { kind: 'switch', id: profile.id };
  confirmRemoveId = null;
  render();
  void exclusive(async () => {
    try {
      const result = await switchAccount(host, host.storage, profile.id, Date.now(), settle);
      notify(result.kind === 'switched' ? 'success' : 'info', t(result.kind === 'switched' ? 'switched' : 'alreadyActive', { email: summary.email }));
    } catch (error) {
      notify('error', t('switchFailed', { error: errorText(error) }));
    } finally {
      pending = null;
    }
    await load(false);
  });
};

const remove = (profile: Profile, summary: AccountSummary): void => {
  if (pending) return;
  pending = { kind: 'remove', id: profile.id };
  render();
  void exclusive(async () => {
    try {
      await removeProfile(host.storage, profile.id);
      notify('success', t('removed', { email: summary.email }));
    } catch (error) {
      notify('error', t('removeFailed', { error: errorText(error) }));
    } finally {
      pending = null;
      confirmRemoveId = null;
    }
    await load(false);
  });
};

const copyCommand = (): void => {
  // Save the newest tokens of the current account before the user signs in
  // with another one and Claude Code overwrites them.
  sync();
  void host.writeClipboard(LOGIN_COMMAND)
    .then(() => notify('info', t('copied')))
    .catch((error: unknown) => notify('error', errorText(error)));
};

let mounted: Disposable[] = [];
let shell: { title: HTMLElement; refresh: ReturnType<typeof mountButton>; body: HTMLElement } | null = null;

const usageOf = (profile: Profile | undefined, now: number): UsageView | null => (
  profile ? describeUsage(usage?.get(profile.id), profile, now, locale, t, errorText) : null
);

const accountCard = (
  parent: HTMLElement,
  summary: AccountSummary,
  active: boolean,
  usageView: UsageView | null,
): HTMLElement => {
  const card = element('div', 'account');
  card.dataset.active = active ? 'true' : 'false';
  const top = element('div', 'account-top');
  top.append(element('span', 'avatar', summary.initial));
  const who = element('div', 'who');
  const email = element('div', 'email', summary.email);
  email.title = summary.email;
  who.append(email);
  const meta = [summary.name, summary.organization, summary.plan].filter((part): part is string => Boolean(part)).join(' · ');
  if (meta) {
    const line = element('div', 'meta', meta);
    line.title = meta;
    who.append(line);
  }
  top.append(who);
  card.append(top);
  if (active || summary.loginExpired) {
    const badges = element('div', 'badges');
    if (active) mounted.push(mountBadge(badges, { label: t('activeBadge'), tone: 'success' }));
    if (summary.loginExpired) mounted.push(mountBadge(badges, { label: t('expiredBadge'), tone: 'error' }));
    card.append(badges);
    if (summary.loginExpired) card.append(element('p', 'hint', t('expiredHint')));
  }
  if (usageView) card.append(usageBlock(usageView));
  parent.append(card);
  return card;
};

const section = (parent: HTMLElement, title: string): HTMLElement => {
  const node = element('section', 'section');
  node.append(element('h2', 'section-title', title));
  parent.append(node);
  return node;
};

const renderReady = (body: HTMLElement, snapshot: Snapshot): void => {
  const now = Date.now();
  const { active } = snapshot;
  const activeId = active.kind === 'signed-in' ? active.id : null;

  if (sessionBusy) {
    mounted.push(mountBanner(body, { tone: 'info', title: t('busyTitle'), body: t('busyBody') }));
  }
  if (snapshot.settlingMs > 0) body.append(element('p', 'hint', t('settling')));
  if (snapshot.conflictOwnerId && active.kind === 'signed-in') {
    const owner = snapshot.profiles.find((profile) => profile.id === snapshot.conflictOwnerId);
    mounted.push(mountBanner(body, {
      tone: 'warning',
      title: t('conflictTitle'),
      body: t('conflictBody', {
        named: summarize(active.oauthAccount, active.claudeAiOauth, now).email,
        owner: owner ? summarize(owner.oauthAccount, owner.claudeAiOauth, now).email : '?',
      }),
    }));
  }
  if (snapshot.unreadable.length > 0) {
    mounted.push(mountBanner(body, {
      tone: 'warning',
      title: t('unreadableTitle'),
      body: t('unreadableBody', { count: snapshot.unreadable.length }),
    }));
  }

  // With a conflict the banner above says what is in use; there is no account to show.
  if (active.kind === 'signed-in' && !snapshot.conflictOwnerId) {
    const profile = snapshot.profiles.find((saved) => saved.id === active.id);
    accountCard(section(body, t('activeSection')), summarize(active.oauthAccount, active.claudeAiOauth, now), true, usageOf(profile, now));
  } else if (active.kind === 'signed-out') {
    mounted.push(mountBanner(section(body, t('activeSection')), { tone: 'info', title: t('signedOutTitle'), body: t('signedOutBody') }));
  } else if (active.kind === 'unidentified') {
    mounted.push(mountBanner(section(body, t('activeSection')), { tone: 'warning', title: t('unidentifiedTitle'), body: t('unidentifiedBody') }));
  }

  const others = section(body, t('savedSection'));
  const listed = snapshot.profiles.filter((profile) => profile.id !== activeId || snapshot.conflictOwnerId !== null);
  if (listed.length === 0) others.append(element('p', 'hint', t('noOthers')));
  for (const profile of listed) {
    const summary = summarize(profile.oauthAccount, profile.claudeAiOauth, now);
    const card = accountCard(others, summary, false, usageOf(profile, now));
    const actions = element('div', 'actions');
    if (confirmRemoveId === profile.id) {
      card.append(element('div', 'confirm', t('confirmRemove', { email: summary.email })));
      mounted.push(mountButton(actions, {
        label: t('cancel'),
        variant: 'ghost',
        size: 'xs',
        disabled: pending !== null,
        onClick: () => { confirmRemoveId = null; render(); },
      }));
      mounted.push(mountButton(actions, {
        label: t('remove'),
        variant: 'destructive',
        size: 'xs',
        loading: pending?.kind === 'remove' && pending.id === profile.id,
        disabled: pending !== null,
        onClick: () => remove(profile, summary),
      }));
    } else {
      mounted.push(mountButton(actions, {
        label: t('remove'),
        variant: 'ghost',
        size: 'xs',
        disabled: pending !== null,
        onClick: () => { confirmRemoveId = profile.id; render(); },
      }));
      mounted.push(mountButton(actions, {
        label: t('use'),
        size: 'xs',
        loading: pending?.kind === 'switch' && pending.id === profile.id,
        disabled: pending !== null,
        onClick: () => use(profile, summary),
      }));
    }
    card.append(actions);
  }

  const add = section(body, t('addTitle'));
  add.append(element('p', 'hint', t('addBody')));
  add.append(element('p', 'hint', t('addTerminal')));
  const command = element('div', 'command');
  command.append(element('code', '', LOGIN_COMMAND));
  mounted.push(mountButton(command, { label: t('copy'), variant: 'outline', size: 'xs', onClick: copyCommand }));
  add.append(command);
  add.append(element('p', 'hint', t('addSettings')));
  add.append(element('p', 'hint', t('addThen')));

  body.append(element('p', 'note', t('storageNote')));
};

/**
 * What the panel shows, as data. Background syncs that change nothing visible
 * (a token rotated, the same accounts) skip repainting, so focus and hover stay
 * where the user left them.
 */
const renderKey = (): string => {
  const now = Date.now();
  const visible = view.kind === 'ready'
    ? {
      active: view.snapshot.active.kind === 'signed-in'
        ? [view.snapshot.active.id, summarize(view.snapshot.active.oauthAccount, view.snapshot.active.claudeAiOauth, now)]
        : view.snapshot.active.kind,
      profiles: view.snapshot.profiles.map((profile) => [profile.id, summarize(profile.oauthAccount, profile.claudeAiOauth, now)]),
      conflict: view.snapshot.conflictOwnerId,
      settling: view.snapshot.settlingMs > 0,
      unreadable: view.snapshot.unreadable.length,
      usage: view.snapshot.profiles.map((profile) => usageOf(profile, now)),
    }
    : view;
  return JSON.stringify([locale, visible, sessionBusy, pending, confirmRemoveId]);
};

function render(): void {
  if (!shell) return;
  const key = renderKey();
  if (key === lastRenderKey) return;
  lastRenderKey = key;
  for (const handle of mounted) handle.dispose();
  mounted = [];
  const { body } = shell;
  body.replaceChildren();
  shell.title.textContent = t('title');
  shell.refresh.update({ label: t('refresh'), disabled: pending !== null || view.kind === 'loading' });

  if (view.kind === 'loading') {
    const center = element('div', 'center');
    body.append(center);
    mounted.push(mountSpinner(center, { label: t('loading') }));
    return;
  }
  if (view.kind === 'error') {
    mounted.push(mountBanner(body, {
      tone: 'error',
      title: t('readFailed'),
      body: view.message,
      action: { label: t('retry'), onClick: () => void exclusive(() => load(true)) },
    }));
    return;
  }
  renderReady(body, view.snapshot);
}

host.onSession((session) => {
  sessionBusy = Boolean(session?.busy);
  render();
});

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  locale = ctx.locale;
  t = translator(ctx.locale);
  sessionBusy = Boolean(ctx.session?.busy);
  if (shell) {
    render();
    return;
  }
  const style = element('style', '', css);
  document.head.append(style);
  const app = element('main', 'app');
  const head = element('header', 'head');
  const title = element('h1', '', t('title'));
  const headActions = element('div');
  const refresh = mountButton(headActions, {
    label: t('refresh'),
    variant: 'ghost',
    size: 'xs',
    onClick: () => {
      forceUsage = true;
      void exclusive(() => load(true));
    },
  });
  head.append(title, headActions);
  const body = element('div', 'body');
  app.append(head, body);
  root.append(app);
  shell = { title, refresh, body };
  render();
  void exclusive(() => load(true));
  keepInSync(host, sync);
});
