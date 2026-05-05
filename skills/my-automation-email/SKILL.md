---
name: my-automation-email
description: Read the user's configured Gmail accounts for personal automation using Gmail API read-only OAuth. Use when Codex needs to answer questions from email contents, search Gmail, retrieve specific email messages, check Gmail OAuth setup, migrate Gmail OAuth Keychain entries, or build another skill/workflow that needs deterministic email access.
---

Use this skill to read the configured Gmail accounts through the Gmail API. The scripts use only the `gmail.readonly` OAuth scope and store OAuth material in macOS Keychain service `my-automation.gmail-oauth`.

## Accounts

Configured mailboxes:

| Mailbox | Gmail UI index | Keychain token account |
| --- | ---: | --- |
| `primary` | `/u/1/` | `token-primary` |
| `secondary` | `/u/0/` | `token-secondary` |

Shared OAuth client credentials are stored in Keychain account `credentials`.

## Safety

- Run commands from this skill directory.
- Request elevated command permission in Codex for commands that read Gmail or Keychain; sandboxed commands may not see the login Keychain or network.
- Require explicit user approval before importing credentials, starting first-time OAuth consent, or migrating/deleting Keychain entries.
- Include `--authorize-keychain-update` for every command that can create, update, or delete Keychain entries.
- Do not print, store, or summarize OAuth credentials, access tokens, refresh tokens, or raw Keychain values.
- Search and retrieve live email content only when the user's request requires it.

## Setup And Checks

Check both mailboxes:

```bash
node scripts/email.mjs --auth-check --mailbox both
```

Migrate existing entries from `transactions.gmail-oauth` to `my-automation.gmail-oauth` after user approval:

```bash
node scripts/email.mjs \
  --migrate-keychain-service \
  --authorize-keychain-update
```

The migration copies `credentials`, `token-primary`, and `token-secondary`, verifies Gmail auth using the new service, then deletes those old entries only after verification succeeds. After migration, use only `my-automation.gmail-oauth`; there is no runtime fallback to the old service.

Import Google OAuth desktop-client credentials after user approval:

```bash
node scripts/email.mjs \
  --import-credentials "/explicit/user/supplied/client-secret.json" \
  --authorize-keychain-update
```

Start OAuth consent for each mailbox after user approval:

```bash
node scripts/email.mjs \
  --init-auth \
  --mailbox primary \
  --authorize-keychain-update
```

```bash
node scripts/email.mjs \
  --init-auth \
  --mailbox secondary \
  --authorize-keychain-update
```

Open the printed auth URL manually, authorize read-only Gmail access with the intended account, and let the localhost callback store the token in Keychain.

## Reading Email

Search both mailboxes:

```bash
node scripts/email.mjs \
  --search 'from:example@example.com newer_than:30d' \
  --mailboxes primary,secondary \
  --max-results 20
```

Retrieve one Gmail API message ID from a mailbox:

```bash
node scripts/email.mjs \
  --message-id 18c123abc456def0 \
  --mailbox primary
```

Script output is JSON containing mailbox provenance, profile email, Gmail direct links, headers, snippet, and extracted text. Use `gmail_direct_url` for direct Gmail UI evidence links and `gmail_web_url` for Message-ID search links when available.

## Reusing The Library

Other skills can import deterministic helpers from:

```js
import {
  gmailAccountsForMailboxes,
  parseMailboxSelection,
  searchMessages,
  getMessageById,
} from '/Users/marceloschroeder/.codex/skills/my-automation-email/scripts/lib/gmail-access.mjs';
```

Keep domain-specific parsing in the calling skill. Use this library only for Gmail auth, search, message retrieval, metadata, text extraction, and Keychain migration.
