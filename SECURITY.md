# Security policy

Claude Account Switcher handles Claude Code login tokens, so security reports get priority.

## Supported versions

Only the latest release receives fixes. Update from **Settings → Extensions** in OpenChamber, or reinstall from the newest tag.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to the [new advisory form](https://github.com/pedrohendp/openchamber-claude-account-switcher/security/advisories/new).

Include what an attacker could do, the steps to reproduce it, and the extension and OpenChamber versions. Never include real tokens, `~/.claude/.credentials.json`, or the extension's storage file; redact them.

You can expect a first answer within a week. Once a fix is released, the advisory is published with credit to you, unless you prefer otherwise.

## Scope

In scope:

- The extension's pages, its local service, and how they read, store, write, or send Claude Code login data.
- The built bundles in this repository (`panel/main.js`, `status/main.js`, `service/main.js`) not matching their sources.

Out of scope, please report to the project concerned:

- OpenChamber itself, its extension sandbox, and its approval dialog: [openchamber/openchamber](https://github.com/openchamber/openchamber/security).
- Claude Code and Anthropic's APIs: [Anthropic's disclosure program](https://www.anthropic.com/responsible-disclosure-policy).
- Anyone who can already read your user's files, since they can read Claude Code's own credentials file just the same.

## How the extension protects your login

The README's [Security and privacy](./README.md#security-and-privacy) section describes what the extension can reach, where saved logins are kept, and what leaves the machine.
