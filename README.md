# FlowClaude

A one-tap Android installer that sets up Claude Code in Termux with proper OAuth login, a home screen launcher, and optional local MCP server for power users.

> Predecessor to [FlowCode](#).

---

## Vision

FlowClaude makes Claude Code a first-class Android app experience — no technical setup required. Tap once, authenticate, and you're coding with Claude from your phone or tablet.

---

## Features

### Core (Free)
- **One-tap installer** — sets up Termux, Claude Code, and all dependencies automatically
- **OAuth login via Chrome** — proper browser-based authentication, no API key hunting
- **Home screen launcher** — open Claude Code like any other app
- **API billing** — pay only for what you use via Anthropic's free tier and usage-based pricing
- **Clipboard integration** — copy outputs, code, or login URLs directly to the Android clipboard via `termux-clipboard-set`

### Power Users (Paid)
- **Local MCP server** — run a Model Context Protocol server on-device for extended Claude capabilities
- **Persistent sessions** — keep context alive between launches
- **Advanced integrations** — connect Claude to local files, tools, and services

---

## How It Works

1. User taps the FlowClaude installer APK or runs a one-line bootstrap script
2. Termux is configured automatically (packages, storage permissions, shell)
3. Claude Code is installed and configured
4. Chrome opens for OAuth — user logs in with their Anthropic account
5. A home screen shortcut is created that launches Claude Code directly
6. (Optional) Local MCP server is set up for paid tier users

---

## Roadmap

- [ ] One-tap bootstrap script (includes `termux-api` install)
- [ ] OAuth flow via Chrome custom tabs
- [ ] Home screen launcher / shortcut
- [ ] Auto-updater for Claude Code
- [ ] Local MCP server setup (paid)
- [ ] FlowCode (successor — broader coding agent platform)

---

## Tiers

| Feature | Free | Paid |
|---|---|---|
| One-tap install | yes | yes |
| OAuth login | yes | yes |
| Home screen launcher | yes | yes |
| API billing (usage-based) | yes | yes |
| Local MCP server | — | yes |
| Persistent sessions | — | yes |

---

## Relationship to FlowCode

FlowClaude is the focused, Claude-specific predecessor to **FlowCode** — a broader mobile coding agent platform supporting multiple AI backends. FlowClaude proves the pattern: frictionless AI coding tools belong on Android.

---

## License

TBD
