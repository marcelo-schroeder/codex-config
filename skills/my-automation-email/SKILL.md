---
name: my-automation-email
description: Read and recover the user's configured Gmail accounts for personal automation, and provide explicitly approved narrow Gmail thread-state mutations through the shared OAuth and Keychain boundary. Use when Codex needs to search or retrieve Gmail, check OAuth readiness, prepare or apply an approved auth repair, upgrade a mailbox to Gmail modify access, read or change known-thread read/starred state, migrate Gmail OAuth Keychain entries, or build another deterministic email workflow.
---

Use this skill as the sole Gmail API, OAuth, account-verification, and Keychain boundary. Reading
defaults to `gmail.readonly`. An explicitly approved workflow may authorize `gmail.modify`; the only
implemented mailbox mutations are explicitly setting `UNREAD` and `STARRED` on a known thread. No
draft, reply, send, archive, trash, delete, or general label interface is exposed. OAuth material stays in macOS
Keychain service `my-automation.gmail-oauth`.

## Accounts

Configured mailboxes:

| Mailbox | Expected Gmail address | Gmail UI index | Keychain token account |
| --- | --- | ---: | --- |
| `primary` | `marcelo.schroeder@gmail.com` | `/u/1/` | `token-primary` |
| `secondary` | `schroeder.marcelo@gmail.com` | `/u/0/` | `token-secondary` |
| `tertiary` | `schroeder.adriana@gmail.com` | `/u/2/` | `token-tertiary` |

Shared OAuth client credentials are stored in Keychain account `credentials`.
The `tertiary` mailbox is optional and is never included by `both` or by default searches; select it explicitly when a workflow requests tertiary fallback.

## Safety

- Run commands from this skill directory.
- Request elevated command permission in Codex for commands that read Gmail or Keychain; sandboxed commands may not see the login Keychain or network.
- Require explicit user approval before importing credentials, starting first-time OAuth consent, or migrating/deleting Keychain entries.
- Include `--authorize-keychain-update` for every command that can create, update, or delete Keychain entries.
- Do not print, store, or summarize OAuth credentials, access tokens, refresh tokens, or raw Keychain values.
- Search and retrieve live email content only when the user's request requires it.
- Treat auth-repair preparation as read-only: it may read Keychain, refresh only in memory, and call the Gmail profile endpoint, but must not persist a refreshed token or search messages.
- Apply only the exact user-approved repair plan. Verify the selected Gmail profile before replacing a Keychain token; preserve the old token on a wrong-account selection.
- Require an explicit user action before a caller changes a Gmail thread's read or starred state.
  Reading current state is non-mutating. Never turn the broader authority of `gmail.modify` into an
  implicit send, reply, archive, delete, or arbitrary-label action.

## Setup And Checks

Check both mailboxes:

```bash
node scripts/email.mjs --auth-check --mailbox both
```

Require and verify modify capability without changing Keychain state:

```bash
node scripts/email.mjs --auth-check --mailbox both --scope modify
```

Prepare a sanitized, non-mutating readiness and repair plan for exact mailbox labels:

```bash
node scripts/email.mjs \
  --prepare-auth-repair \
  --mailboxes primary,secondary
```

The plan reports `ready`, `reauthorization_required`, `missing_token`, `missing_scope`, or `wrong_account` independently for every mailbox. It contains expected/profile addresses and Keychain references, but no credentials or token values. Save the exact JSON plan only when a calling workflow needs approval-bound recovery.

After the user explicitly approves that exact plan, apply it sequentially:

```bash
node scripts/email.mjs \
  --apply-auth-repair \
  --plan-json /absolute/path/to/approved-gmail-auth-plan.json \
  --authorize-keychain-update
```

Preparation is optional and does not change ordinary search, retrieval, `--auth-check`, or `--init-auth` use. Other skills may ignore it.

Migrate existing entries from `transactions.gmail-oauth` to `my-automation.gmail-oauth` after user approval:

```bash
node scripts/email.mjs \
  --migrate-keychain-service \
  --authorize-keychain-update
```

The migration copies `credentials`, `token-primary`, and `token-secondary`, verifies Gmail auth using the new service, then deletes those old entries only after verification succeeds. After migration, use only `my-automation.gmail-oauth`; there is no runtime fallback to the old service.
The optional `token-tertiary` account is not part of legacy migration; initialize it directly under `my-automation.gmail-oauth` if needed.

Import Google OAuth desktop-client credentials after user approval:

```bash
node scripts/email.mjs \
  --import-credentials "/explicit/user/supplied/client-secret.json" \
  --authorize-keychain-update
```

Start read-only OAuth consent for each mailbox after user approval:

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

For the optional tertiary mailbox, use:

```bash
node scripts/email.mjs \
  --init-auth \
  --mailbox tertiary \
  --authorize-keychain-update
```

Open the printed auth URL manually, authorize read-only Gmail access with the intended account, and let the localhost callback store the token in Keychain.

## Modify-Scope Upgrade

Only after explicit approval, replace the existing primary and secondary tokens with profile-verified
`gmail.modify` tokens:

```bash
node scripts/email.mjs \
  --init-auth \
  --mailbox primary \
  --scope modify \
  --authorize-keychain-update
```

```bash
node scripts/email.mjs \
  --init-auth \
  --mailbox secondary \
  --scope modify \
  --authorize-keychain-update
```

Verify both expected profiles and the required capability afterward:

```bash
node scripts/email.mjs --auth-check --mailbox both --scope modify
```

Consent, cancellation, timeout, missing scope, or wrong-account selection must preserve the prior
Keychain token. A later authentication repair preserves `gmail.modify` rather than silently
downgrading the token. Although Google grants compose/send authority with this scope, this skill
does not implement those operations.

## Reading Email

Search both mailboxes:

```bash
node scripts/email.mjs \
  --search 'from:example@example.com newer_than:30d' \
  --mailboxes primary,secondary \
  --max-results 20
```

Search the optional tertiary mailbox only when explicitly requested:

```bash
node scripts/email.mjs \
  --search 'from:example@example.com newer_than:30d' \
  --mailboxes tertiary \
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
  getThreadState,
  markThreadRead,
  parseMailboxSelection,
  searchMessages,
  setThreadRead,
  setThreadStarred,
  getMessageById,
} from '/Users/marceloschroeder/.codex/skills/my-automation-email/scripts/lib/gmail-access.mjs';
```

For approval-bound multi-account recovery, import `prepareAuthRepair`, `readAuthRepairPlan`, and `applyAuthRepairPlan` from `scripts/lib/auth-repair.mjs`.

Keep domain-specific parsing in the calling skill. Use this library only for Gmail auth, search,
message retrieval, metadata, text extraction, Keychain migration, and the explicit narrow known-thread
read/starred operations. `getThreadState` fetches only minimal message IDs and label IDs. Read state is
true only when no existing message has `UNREAD`; starred state is true when any existing message has
`STARRED`. The setters apply the requested state to every existing message in the thread.
Call `gmailAccountForMailbox` with `requiredCapability: 'modify'` before any state setter; never pass
unverified account or thread identity from a browser request directly to the Gmail API. Keep
`markThreadRead` as the compatibility helper for callers that only need to set read state to true.
