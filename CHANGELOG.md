# Changelog

All notable changes to this extension are listed here. Versions follow [Semantic Versioning](https://semver.org); the `version` in `package.json` is what OpenChamber compares for Git updates.

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
