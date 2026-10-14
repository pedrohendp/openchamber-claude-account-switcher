# Claude Account Switcher for OpenChamber

**English** · [Português (Brasil)](./README.pt-BR.md)

Switch the account Claude Code is signed in to, from a panel in [OpenChamber](https://openchamber.dev)'s right-hand rail. Keep a work account and a personal account (or several organizations) signed in and swap between them with one click, without running `claude auth login` again.

<img src="./docs/screenshot-en.jpg" alt="The Claude Account Switcher panel: the account in use, two saved accounts with Use and Remove buttons, one marked Login expired, and instructions to add another account." width="360" />

The switch applies to everything that reads Claude Code's login on that machine: the `claude-code` provider in OpenChamber ([opencode-claude](https://github.com/openchamber/opencode-claude)) and the `claude` CLI in your terminal.

> [!NOTE]
> This is a community extension. It is not made by or affiliated with Anthropic or the OpenChamber team. You are responsible for how you use your own accounts; if you are unsure whether something is allowed, check Anthropic's terms.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Usage](#usage)
- [How it works](#how-it-works)
- [Security and privacy](#security-and-privacy)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Project layout](#project-layout)
- [License](#license)

## Features

- **One-click switch** between saved Claude Code logins.
- **Saves the account in use automatically.** Open the panel and the current login is stored; sign in with another account and it shows up next to the first.
- **Keeps saved logins fresh.** Claude Code rotates its OAuth tokens while it runs, so the panel refreshes the saved copy of the active account every minute while it is visible, and always right before a switch.
- **Touches only the login.** Replaces two JSON keys and leaves every other setting, MCP token, and project entry exactly as written, including the file's formatting.
- **Safe failure.** If the second file cannot be written, the first is put back, so Claude Code never ends up with tokens from one account and the name of another.
- **Detects a mismatched login** (credentials of one saved account under the name of another) and refuses to save it.
- **Shows plan and status**: organization, plan (Pro, Max 5x/20x, Team, Enterprise), and whether a saved login has expired.
- English and Portuguese, following OpenChamber's language. Light and dark themes follow the app.

## Requirements

| | |
| --- | --- |
| OpenChamber | 2.3.1 or later, **web or desktop** (VS Code and mobile do not load extensions) |
| Claude Code | Signed in with a Claude plan (`claude auth login --claudeai`) |
| Operating system | **Windows** or **Linux** on the machine that runs the OpenChamber server. Not macOS: see [Limitations](#limitations). |

## Install

### From GitHub

1. In OpenChamber, open **Settings → Extensions → Add**.
2. Paste `https://github.com/pedrohendp/openchamber-claude-account-switcher.git`.
3. Approve the requested access: read and write `~/.claude.json` and `~/.claude/.credentials.json`.
4. Click the **Claude Account Switcher** icon in the right-hand rail.

Git installs can be updated from **Settings → Extensions** when a newer `version` is published. Append a tag such as `#v1.0.1` to the URL to pin that release.

### From a local folder

Clone the repository, then add the folder from **Settings → Extensions → Add**. A folder install runs from that folder, so after `bun run build` you only need to reopen the panel. The built `panel/main.js` is committed, so a fresh clone installs without building.

## Usage

**First run.** Open the panel. The account Claude Code is signed in to appears under **In use** and is saved.

**Add another account.**

1. Sign in to Claude Code with the other account, without signing out first:
   - in a terminal: `claude auth login --claudeai` (the panel has a Copy button), or
   - in OpenChamber: **Settings → Providers → Claude Code → Sign in**.
2. Back in the panel, press **Refresh**. The new account is now in use, and the previous one is listed under **Other accounts**.

**Switch.** Press **Use** on an account. A toast confirms the switch. It applies from the next Claude Code turn; a turn that is already running finishes on the previous account. The panel shows a notice while the open chat is busy.

**Remove.** Press **Remove**, then confirm. This deletes the saved login for that account only. To get it back, sign in with that account again.

**Expired login.** A saved account marked **Login expired** has a refresh token that is past its expiry date, so Claude Code cannot renew it. Sign in with that account again; the panel replaces the saved copy.

## How it works

Claude Code keeps its login in two files. The extension swaps one key in each:

| File | Key replaced | Left untouched |
| --- | --- | --- |
| `~/.claude/.credentials.json` | `claudeAiOauth`: access token, refresh token, expiry, plan | `mcpOAuth` (MCP server tokens) and any other key |
| `~/.claude.json` | `oauthAccount`: account and organization the tokens belong to | projects, settings, caches, everything else |

Each saved login is identified by **account UUID + organization UUID**, because one person can belong to several organizations and each one gets its own tokens.

A switch runs these steps:

```text
1. Read both files and the saved logins.
2. Save the newest tokens of the account in use (unless they look like another account's).
3. Read the target account's saved login.
4. Write ~/.claude/.credentials.json  with the target's claudeAiOauth.
5. Write ~/.claude.json               with the target's oauthAccount.
     └─ if this fails: restore the original credentials file, report the error.
6. Read both files again and check that the target is the account in use.
```

Writes keep each file's indentation, line endings, and trailing newline. OpenChamber performs every write atomically (temporary file, then rename), so Claude Code never reads a half-written file.

Operations run one at a time inside the panel, so a background refresh cannot interleave with a switch.

## Security and privacy

- **Scoped file access.** The manifest declares exactly two paths and asks for no project-file access. OpenChamber refuses every other path, compares canonical paths, and rejects `..`, backslashes, and symlinks that leave the allowed paths. The extension has no network access and no local process.
- **Where saved logins live.** In the extension's own storage on the OpenChamber server: `guest-storage/claude-accounts.json` in OpenChamber's data directory, written with mode `0600`. Tokens are stored as Claude Code stores them, in plain JSON; anyone who can read your user's files can read them, exactly as with `~/.claude/.credentials.json`.
- **Removing the extension deletes them.** Uninstalling clears the extension's storage, including every saved login.
- **Nothing is logged or sent anywhere.** Tokens never leave the server; the panel shows only email, organization, and plan.
- **Mismatch guard.** If the tokens on disk match the saved login of a different account than `~/.claude.json` names, the panel saves nothing and shows a warning, so one account's tokens are never stored under another's name.

## Limitations

- **macOS is not supported.** Claude Code on macOS keeps its tokens in the login Keychain, not in `~/.claude/.credentials.json`, and an extension cannot reach the Keychain.
- **Linux file permissions.** OpenChamber rewrites files with default permissions (usually `0644`). After switching on Linux, run `chmod 600 ~/.claude/.credentials.json`.
- **`CLAUDE_CONFIG_DIR` is not supported.** The extension always uses `~/.claude` and `~/.claude.json`.
- **Running processes.** A Claude Code process that is already running keeps the tokens it loaded until its next turn or restart. If such a process later rewrites the credentials, the panel shows the mismatch warning; pick the account you want again.
- **One server.** Saved logins belong to the OpenChamber server they were saved on. A remote OpenChamber switches the login on that remote machine.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| *"The extension may not read the Claude Code files yet"* | Approve the extension's access in **Settings → Extensions**. |
| **Claude Code is signed out** | Pick a saved account, or sign in with `claude auth login --claudeai`. |
| **Signed in, account unknown** | `~/.claude.json` has no `oauthAccount` yet. Run Claude Code once so it finishes setting up, then press Refresh. |
| **Login and account do not match** | The credentials on disk belong to another saved account. Press **Use** on the account you want. |
| The new account does not appear after signing in | Press **Refresh** (the panel also re-reads when it becomes visible). |
| A switch reports *files changed during the switch* | Something else wrote the files at the same moment, usually a running Claude Code. Refresh and switch again. |

To check which account Claude Code is using, run `claude auth status`.

## Development

Requires [Bun](https://bun.sh) 1.4 or later.

```bash
bun install
bun run build        # bundle panel/main.ts into panel/main.js (a single IIFE)
bun test             # switch logic against fake files and fake storage
bun run type-check   # tsc --noEmit
bun run preview      # http://127.0.0.1:4517 — the panel with a simulated host
```

**Preview.** `bun run preview` serves the built panel inside a page that plays OpenChamber's part with fake accounts and in-memory files. Its toolbar simulates token rotation, a busy chat, a mismatched login, and signing out, and it shows the files and storage as the panel changes them. It never touches your real Claude Code login. Query parameters: `?locale=pt-BR`, `?theme=light`, `?panelOnly=1`.

**Shipping changes.** OpenChamber never compiles TypeScript: it loads `panel/main.js` as committed. Rebuild and commit `panel/main.js` with every source change (CI fails when it is stale), and bump `version` in `package.json` so Git installs offer the update.

**Testing in OpenChamber.** Install your clone as a folder extension (see [Install](#from-a-local-folder)), run `bun run build`, and reopen the panel.

The extension is built on the public [`@openchamber/sdk`](https://www.npmjs.com/package/@openchamber/sdk): `connectHost` for file and storage calls, and the SDK's UI kit for buttons, badges, and banners.

## Project layout

```text
package.json            Extension manifest (the "openchamber" block) and scripts
panel/
  index.html            Page OpenChamber loads in the rail
  main.ts               Panel UI: rendering, actions, background refresh
  main.js               Built bundle that OpenChamber runs (committed)
  accounts.ts           Reading the Claude Code files, saved logins, switch and rollback (no DOM)
  accounts.test.ts      Tests for accounts.ts
  i18n.ts               English and Portuguese strings
dev/
  preview.html          Simulated OpenChamber host with fake data
  serve.ts              Static server for the preview
docs/                   Screenshots
```

## License

[MIT](./LICENSE) © Pedro Arruda
