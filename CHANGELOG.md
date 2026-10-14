# Changelog

All notable changes to this extension are listed here. Versions follow [Semantic Versioning](https://semver.org); the `version` in `package.json` is what OpenChamber compares for Git updates.

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
