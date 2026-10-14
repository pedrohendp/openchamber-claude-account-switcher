// The iframe cannot use the host's React i18n, so the panel picks its own
// dictionary from `HostReadyContext.locale`. Portuguese for `pt*`, English
// for everything else.

const en = {
  title: 'Claude Code accounts',
  refresh: 'Refresh',
  loading: 'Reading the Claude Code login…',
  readFailed: 'Could not read the Claude Code login',
  retry: 'Try again',
  activeSection: 'In use',
  savedSection: 'Other accounts',
  noOthers: 'No other account saved yet. Sign in with another account and it shows up here.',
  activeBadge: 'Active',
  expiredBadge: 'Login expired',
  expiredHint: 'Sign in with this account again to renew it.',
  signedOutTitle: 'Claude Code is signed out',
  signedOutBody: 'Pick a saved account below, or sign in.',
  unidentifiedTitle: 'Signed in, account unknown',
  unidentifiedBody: 'Claude Code has a login, but ~/.claude.json does not say which account it is, so it was not saved. Run Claude Code once to let it finish, then refresh.',
  conflictTitle: 'Login and account do not match',
  conflictBody: '~/.claude.json names {named}, but the login on disk is the saved one for {owner}. Nothing was saved. Pick an account below or sign in again.',
  unreadableTitle: 'Some saved accounts could not be read',
  unreadableBody: '{count} saved entry(ies) were skipped. The other accounts still work.',
  busyTitle: 'This chat is working',
  busyBody: 'The turn in progress finishes on the current account. A switch applies from the next turn.',
  use: 'Use',
  remove: 'Remove',
  cancel: 'Cancel',
  confirmRemove: 'Remove {email}? To get it back you will have to sign in with it again.',
  switched: 'Now using {email}. Applies from the next Claude Code turn.',
  alreadyActive: '{email} is already in use.',
  switchFailed: 'Could not switch account: {error}',
  removed: '{email} removed.',
  removeFailed: 'Could not remove: {error}',
  addTitle: 'Add an account',
  addBody: 'Sign in to Claude Code with the other account. The current one is already saved here, so there is no need to sign out first.',
  addTerminal: 'In a terminal:',
  addSettings: 'Or in Settings → Providers → Claude Code → Sign in.',
  addThen: 'Then come back and press Refresh.',
  copy: 'Copy',
  copied: 'Command copied.',
  storageNote: 'Saved logins live in this extension’s storage on the OpenChamber server. Removing the extension deletes them.',
  notGranted: 'the extension may not read the Claude Code files yet. Approve access in Settings → Extensions.',
} as const;

export type MessageKey = keyof typeof en;
type Dictionary = { [K in MessageKey]: string };

const pt: Dictionary = {
  title: 'Contas do Claude Code',
  refresh: 'Atualizar',
  loading: 'Lendo o login do Claude Code…',
  readFailed: 'Não foi possível ler o login do Claude Code',
  retry: 'Tentar de novo',
  activeSection: 'Em uso',
  savedSection: 'Outras contas',
  noOthers: 'Nenhuma outra conta salva ainda. Faça login com outra conta e ela aparece aqui.',
  activeBadge: 'Ativa',
  expiredBadge: 'Login expirado',
  expiredHint: 'Faça login com esta conta de novo para renovar.',
  signedOutTitle: 'Claude Code sem login',
  signedOutBody: 'Escolha uma conta salva abaixo ou faça login.',
  unidentifiedTitle: 'Com login, mas sem conta identificada',
  unidentifiedBody: 'O Claude Code tem um login, mas o ~/.claude.json não diz de qual conta é, então ele não foi salvo. Rode o Claude Code uma vez para ele completar e clique em Atualizar.',
  conflictTitle: 'Login e conta não batem',
  conflictBody: 'O ~/.claude.json indica {named}, mas o login no disco é o salvo de {owner}. Nada foi salvo. Escolha uma conta abaixo ou faça login de novo.',
  unreadableTitle: 'Algumas contas salvas não puderam ser lidas',
  unreadableBody: '{count} registro(s) foram ignorados. As outras contas continuam funcionando.',
  busyTitle: 'Este chat está trabalhando',
  busyBody: 'O turno em andamento termina na conta atual. A troca vale a partir do próximo turno.',
  use: 'Usar',
  remove: 'Remover',
  cancel: 'Cancelar',
  confirmRemove: 'Remover {email}? Para voltar a ela, você vai precisar fazer login de novo.',
  switched: 'Agora usando {email}. Vale a partir do próximo turno do Claude Code.',
  alreadyActive: '{email} já está em uso.',
  switchFailed: 'Não foi possível trocar de conta: {error}',
  removed: '{email} removida.',
  removeFailed: 'Não foi possível remover: {error}',
  addTitle: 'Adicionar conta',
  addBody: 'Faça login no Claude Code com a outra conta. A atual já está salva aqui, então não precisa sair dela antes.',
  addTerminal: 'No terminal:',
  addSettings: 'Ou em Settings → Providers → Claude Code → Sign in.',
  addThen: 'Depois volte aqui e clique em Atualizar.',
  copy: 'Copiar',
  copied: 'Comando copiado.',
  storageNote: 'Os logins salvos ficam no armazenamento desta extensão no servidor do OpenChamber. Remover a extensão apaga esses logins.',
  notGranted: 'a extensão ainda não pode ler os arquivos do Claude Code. Aprove o acesso em Settings → Extensions.',
};

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export const translator = (locale: string | undefined): Translate => {
  const dictionary: Dictionary = locale?.toLowerCase().startsWith('pt') ? pt : en;
  return (key, values) => dictionary[key].replace(/\{(\w+)\}/g, (match, name: string) => (
    values && name in values ? String(values[name]) : match
  ));
};
