# Changelog

All notable changes to this extension are listed here. Versions follow [Semantic Versioning](https://semver.org); the `version` in `package.json` is what OpenChamber compares for Git updates.

## 1.2.1 — 2026-10-15

- **Fix: a new sign-in could be saved under the previous account.** `claude auth login` writes the new tokens and the new account name one after the other; read in between, the new tokens were saved as the old account, the new account never appeared, and switching to the old account later signed in as the new one. A login is now saved only after it has looked the same for 10 seconds; meanwhile both views say Claude Code is updating its login. A switch made right after Claude Code renewed its tokens waits for them in the same way, so they are saved first.
- **Fix: a change made in one view took up to 30 seconds to show in the other.** Removing an account in the rail panel, or an account saved by one view, now shows in the other within about 3 seconds.
- Usage readings that fail (expired token, rate limit) are retried at most every two minutes per account instead of on every re-read.

If an account shows the wrong login after using 1.2.0 (for example "Login and account do not match" after switching to it), remove it and sign in with it again.

## 1.2.0 — 2026-10-14

- **Plan usage per account.** The 5-hour session, the weekly limit, and weekly model limits such as Fable, each with the percentage used and when it resets, read from the same Anthropic endpoint as Claude Code's `/usage`. The rail panel shows them on every account card; the Work Status section keeps them hidden until **Show usage**.
- Readings are kept per account and reused for two minutes. An account whose access token has expired shows its last reading with the time it was taken; **Refresh** reads again right away.
- New local service (`service/main.js`) that makes the usage call, since Anthropic's API refuses calls from an extension page. **Existing installs must approve the extension again** in Settings → Extensions.
- Removing an account also deletes its usage reading.
- Security: the local service checks its secret in constant time, caps request size, accepts only a well-formed token, and refuses redirects. New `SECURITY.md` for private reports, CodeQL scanning, Dependabot for dependencies and actions, actions pinned to commit SHAs, and CI checkouts without stored credentials.
- README: usage in the screenshots, and a link to the OpenChamber extensions catalog.

## 1.1.0 — 2026-10-14

- **Switch from the Work Status panel.** A new **Claude Code** section lists every saved account as a radio row with its plan; click one to switch. Expired logins are greyed out, and **Manage accounts** opens the rail panel.
- Both views stay in sync within seconds: they watch the size and modification time of the two Claude Code files every 3 seconds and re-read when they change, so a switch from the other view, a sign-in from a terminal, or a token rotation shows up right away. Full re-reads every 30 seconds, down from 60.
- The section also saves rotated tokens when a chat turn ends.
- Shared code moved to `src/`; `bun run preview` shows both pages.

## 1.0.1 — 2026-10-14

- Renamed to **Claude Account Switcher** (repository `openchamber-claude-account-switcher`). The extension id stays `claude-accounts`, so existing installs keep their approval and saved logins.
- Licensed under MIT.

## 1.0.0 — 2026-10-13

First release.

- Rail panel listing the Claude Code account in use and every saved account, with organization, plan, and expired-login status.
- One-click switch that replaces `claudeAiOauth` in `~/.claude/.credentials.json` and `oauthAccount` in `~/.claude.json`, keeps everything else and each file's formatting, restores the credentials if the config write fails, and verifies the result.
- Automatic saving of the account in use, refreshed every minute while the panel is visible and before every switch.
- Guard against saving one account's tokens under another account's name.
- Remove with inline confirmation.
- Notice while the open chat is busy.
- English and Portuguese (Brazil).
- `bun run preview`: the panel in a simulated host with fake accounts.
