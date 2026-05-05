#!/usr/bin/env node
import path from 'node:path';
import {
  KEYCHAIN_SERVICE,
  getMessageById,
  gmailAccountsForMailboxes,
  gmailAccountForMailbox,
  importCredentialsSecret,
  initAuth,
  mailboxSecretOptions,
  migrateKeychainService,
  parseArgs,
  parseMailboxSelection,
  searchMessages,
  secretRef,
  verifyGmailAuthForMailboxes,
} from './lib/gmail-access.mjs';

function usage() {
  console.error([
    'Usage:',
    '  node scripts/email.mjs --auth-check --mailbox both',
    '  node scripts/email.mjs --migrate-keychain-service --authorize-keychain-update',
    '  node scripts/email.mjs --import-credentials <path> --authorize-keychain-update',
    '  node scripts/email.mjs --init-auth --mailbox primary --authorize-keychain-update',
    '  node scripts/email.mjs --search <gmail-query> --mailboxes primary,secondary --max-results 20',
    '  node scripts/email.mjs --message-id <gmail-message-id> --mailbox primary',
    '',
    'Options:',
    '  --auth-check                    Verify Gmail read-only access; may persist refreshed OAuth tokens',
    '  --migrate-keychain-service      Copy transactions.gmail-oauth entries to my-automation.gmail-oauth, verify, then delete old entries',
    '  --import-credentials <path>     Import Google OAuth desktop-client JSON into Keychain',
    '  --authorize-keychain-update     Required with --migrate-keychain-service, --import-credentials, or --init-auth',
    '  --init-auth                     Start local OAuth callback server and print an auth URL',
    '  --auth-timeout-ms <ms>          Defaults to 180000',
    '  --mailbox <name>                Auth/message mode: primary by default; use secondary or both where supported',
    '  --mailboxes <list>              Search mode: primary,secondary by default',
    '  --search <gmail-query>          Search Gmail and return message metadata plus extracted text',
    '  --message-id <id>               Retrieve one Gmail API message ID',
    '  --max-results <n>               Search results per mailbox; defaults to 20',
    '  --no-text                       Return metadata without extracted message text',
  ].join('\n'));
}

function requireKeychainAuthorization(args, action) {
  if (!args['authorize-keychain-update']) {
    throw new Error(`${action} writes macOS Keychain; rerun with --authorize-keychain-update after user approval`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const secretOptions = { keychainService: KEYCHAIN_SERVICE };

  if (args['migrate-keychain-service']) {
    requireKeychainAuthorization(args, '--migrate-keychain-service');
    const result = await migrateKeychainService();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (args['import-credentials']) {
    requireKeychainAuthorization(args, '--import-credentials');
    const imported = importCredentialsSecret(path.resolve(String(args['import-credentials'])), secretOptions);
    process.stdout.write(`${JSON.stringify({
      ...imported,
      secretStore: 'keychain',
      credentialsRef: secretRef('credentials', secretOptions),
    }, null, 2)}\n`);
    return;
  }

  if (args['init-auth']) {
    requireKeychainAuthorization(args, '--init-auth');
    const mailboxLabels = parseMailboxSelection(args.mailbox || 'primary', ['primary']);
    const authResults = [];
    for (const mailbox of mailboxLabels) {
      authResults.push(await initAuth({
        ...mailboxSecretOptions(secretOptions, mailbox),
        allowKeychainWrite: true,
        timeoutMs: args['auth-timeout-ms'] ? Number(args['auth-timeout-ms']) : 180000,
      }));
    }
    process.stdout.write(`${JSON.stringify(
      authResults.length === 1 ? authResults[0] : { ok: authResults.every((result) => result.ok), mailboxes: authResults },
      null,
      2,
    )}\n`);
    return;
  }

  if (args['auth-check']) {
    const mailboxLabels = parseMailboxSelection(args.mailbox || 'primary', ['primary']);
    const result = await verifyGmailAuthForMailboxes(secretOptions, mailboxLabels);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (args.search) {
    const mailboxLabels = parseMailboxSelection(args.mailboxes || 'primary,secondary', ['primary', 'secondary']);
    const gmailAccounts = await gmailAccountsForMailboxes(secretOptions, mailboxLabels);
    const result = await searchMessages({
      gmailAccounts,
      query: String(args.search),
      maxResults: args['max-results'] ? Number(args['max-results']) : 20,
      includeText: !args['no-text'],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (args['message-id']) {
    const mailbox = parseMailboxSelection(args.mailbox || 'primary', ['primary'])[0];
    const gmailAccount = await gmailAccountForMailbox(secretOptions, mailbox);
    const result = await getMessageById({
      gmailAccount,
      messageId: String(args['message-id']),
      includeText: !args['no-text'],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  usage();
  throw new Error('No action specified');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
