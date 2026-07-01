#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  KEYCHAIN_SERVICE,
  LEGACY_KEYCHAIN_SERVICE,
  canPersistTokenRefresh,
  encodeKeychainValue,
  extractMessageText,
  formatMessageForOutput,
  gmailMessageAccountChooserUrl,
  gmailMailboxConfig,
  gmailMessageSearchQuery,
  gmailMessageWebUrl,
  gmailThreadAccountChooserUrl,
  gmailThreadDirectUrl,
  googleAccountChooserUrl,
  keychainRef,
  migrateKeychainService,
  parseArgs,
  parseMailboxSelection,
  tokenAccountForMailbox,
  tokenRefreshWriteOptions,
} from './lib/gmail-access.mjs';

function encodeBody(text) {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function message({ id = 'msg-1', subject = 'Example', from = 'sender@example.com', body = 'Hello' } = {}) {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: String(Date.parse('2026-01-02T03:04:05Z')),
    snippet: 'snippet text',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
        { name: 'Date', value: 'Fri, 02 Jan 2026 03:04:05 +0000' },
        { name: 'Message-ID', value: `<${id}@example.com>` },
      ],
      parts: [
        {
          mimeType: 'text/html',
          body: { data: encodeBody(`<p>${body}</p>`) },
        },
        {
          mimeType: 'text/plain',
          body: { data: encodeBody(body) },
        },
      ],
    },
  };
}

assert.deepEqual(parseArgs(['--search', 'from:a', '--max-results=2', '--no-text']), {
  search: 'from:a',
  'max-results': '2',
  'no-text': true,
});
assert.deepEqual(parseMailboxSelection('both'), ['primary', 'secondary']);
assert.deepEqual(parseMailboxSelection('tertiary'), ['tertiary']);
assert.deepEqual(parseMailboxSelection('secondary,primary,secondary'), ['secondary', 'primary']);
assert.equal(KEYCHAIN_SERVICE, 'my-automation.gmail-oauth');
assert.equal(LEGACY_KEYCHAIN_SERVICE, 'transactions.gmail-oauth');
assert.equal(tokenAccountForMailbox('primary'), 'token-primary');
assert.equal(tokenAccountForMailbox('secondary'), 'token-secondary');
assert.equal(tokenAccountForMailbox('tertiary'), 'token-tertiary');
assert.equal(gmailMailboxConfig('primary').gmailUserIndex, 1);
assert.equal(gmailMailboxConfig('primary').matchPriority, 1);
assert.equal(gmailMailboxConfig('secondary').gmailUserIndex, 0);
assert.equal(gmailMailboxConfig('secondary').matchPriority, 0);
assert.equal(gmailMailboxConfig('tertiary').gmailUserIndex, 2);
assert.equal(gmailMailboxConfig('tertiary').matchPriority, -1);
assert.equal(keychainRef('token-primary'), 'keychain://my-automation.gmail-oauth/token-primary');

const secondaryRefreshOptions = tokenRefreshWriteOptions({
  tokenAccount: 'token-secondary',
  mailbox: 'secondary',
});
assert.equal(secondaryRefreshOptions.allowTokenRefreshWrite, true);
assert.equal(secondaryRefreshOptions.allowKeychainWrite, undefined);
assert.equal(canPersistTokenRefresh(secondaryRefreshOptions), true);
assert.equal(canPersistTokenRefresh({ allowKeychainWrite: true }), true);
assert.equal(canPersistTokenRefresh({}), false);

const sample = message({ id: 'abc123', subject: 'Receipt', body: 'Plain text body' });
assert.equal(extractMessageText(sample), 'Plain text body');
assert.equal(gmailMessageSearchQuery('<abc123@example.com>'), 'rfc822msgid:abc123@example.com');
assert.equal(gmailMessageWebUrl('<abc123@example.com>', 1), 'https://mail.google.com/mail/u/1/#search/rfc822msgid%3Aabc123%40example.com');
assert.equal(gmailMessageWebUrl('<abc123@example.com>', 1, 'primary@example.com'), 'https://mail.google.com/mail/?authuser=primary%40example.com#search/rfc822msgid%3Aabc123%40example.com');
assert.equal(gmailThreadDirectUrl('thread-abc123', 1), 'https://mail.google.com/mail/u/1/#all/thread-abc123');
assert.equal(gmailThreadDirectUrl('thread-abc123', 1, 'primary@example.com'), 'https://mail.google.com/mail/?authuser=primary%40example.com#all/thread-abc123');
assert.equal(
  googleAccountChooserUrl('https://mail.google.com/mail/?authuser=primary%40example.com#all/thread-abc123', 'primary@example.com'),
  'https://accounts.google.com/AccountChooser?Email=primary%40example.com&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F%3Fauthuser%3Dprimary%2540example.com%23all%2Fthread-abc123',
);
assert.equal(
  gmailThreadAccountChooserUrl('thread-abc123', 1, 'primary@example.com'),
  'https://accounts.google.com/AccountChooser?Email=primary%40example.com&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F%3Fauthuser%3Dprimary%2540example.com%23all%2Fthread-abc123',
);
assert.equal(
  gmailMessageAccountChooserUrl('<abc123@example.com>', 1, 'primary@example.com'),
  'https://accounts.google.com/AccountChooser?Email=primary%40example.com&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F%3Fauthuser%3Dprimary%2540example.com%23search%2Frfc822msgid%253Aabc123%2540example.com',
);
const formatted = formatMessageForOutput(sample, {
  label: 'primary',
  profileEmail: 'primary@example.com',
  gmailUserIndex: 1,
  matchPriority: 1,
  accessToken: 'must-not-leak',
});
assert.equal(formatted.gmail_message_id, 'abc123');
assert.equal(formatted.gmail_mailbox, 'primary');
assert.equal(formatted.gmail_mailbox_email, 'primary@example.com');
assert.equal(formatted.gmail_account_index, 1);
assert.equal(formatted.gmail_direct_url, 'https://mail.google.com/mail/?authuser=primary%40example.com#all/thread-abc123');
assert.equal(formatted.gmail_web_url, 'https://mail.google.com/mail/?authuser=primary%40example.com#search/rfc822msgid%3Aabc123%40example.com');
assert.equal(formatted.gmail_account_chooser_direct_url, 'https://accounts.google.com/AccountChooser?Email=primary%40example.com&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F%3Fauthuser%3Dprimary%2540example.com%23all%2Fthread-abc123');
assert.equal(formatted.gmail_account_chooser_web_url, 'https://accounts.google.com/AccountChooser?Email=primary%40example.com&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F%3Fauthuser%3Dprimary%2540example.com%23search%2Frfc822msgid%253Aabc123%2540example.com');
assert.equal(formatted.text, 'Plain text body');
assert.equal(Object.values(formatted).includes('must-not-leak'), false);

const tertiaryFormatted = formatMessageForOutput(sample, {
  label: 'tertiary',
  profileEmail: 'tertiary@example.com',
  gmailUserIndex: 2,
  matchPriority: -1,
});
assert.equal(tertiaryFormatted.gmail_mailbox, 'tertiary');
assert.equal(tertiaryFormatted.gmail_mailbox_email, 'tertiary@example.com');
assert.equal(tertiaryFormatted.gmail_account_index, 2);
assert.equal(tertiaryFormatted.gmail_direct_url, 'https://mail.google.com/mail/?authuser=tertiary%40example.com#all/thread-abc123');

const store = new Map();
function key(account, service) {
  return `${service}/${account}`;
}
for (const account of ['credentials', 'token-primary', 'token-secondary']) {
  store.set(key(account, LEGACY_KEYCHAIN_SERVICE), encodeKeychainValue(`${account}-secret`));
}
const keychain = {
  read(account, service) {
    return store.get(key(account, service)) ?? null;
  },
  write(account, value, service) {
    store.set(key(account, service), value);
  },
  delete(account, service) {
    store.delete(key(account, service));
    return true;
  },
};
const migration = await migrateKeychainService({
  keychain,
  verifyGmailAuthForMailboxesFn: async (baseOptions, labels) => {
    assert.equal(baseOptions.keychainService, KEYCHAIN_SERVICE);
    assert.deepEqual(labels, ['primary', 'secondary']);
    return { ok: true, status: 'ready' };
  },
});
assert.equal(migration.ok, true);
assert.deepEqual(migration.copiedAccounts, ['credentials', 'token-primary', 'token-secondary']);
assert.deepEqual(migration.deletedSourceAccounts, ['credentials', 'token-primary', 'token-secondary']);
assert.equal(store.get(key('credentials', LEGACY_KEYCHAIN_SERVICE)), undefined);
assert.equal(store.get(key('credentials', KEYCHAIN_SERVICE)), encodeKeychainValue('credentials-secret'));

const collisionStore = new Map([
  [key('credentials', LEGACY_KEYCHAIN_SERVICE), 'source'],
  [key('token-primary', LEGACY_KEYCHAIN_SERVICE), 'source-primary'],
  [key('token-secondary', LEGACY_KEYCHAIN_SERVICE), 'source-secondary'],
  [key('credentials', KEYCHAIN_SERVICE), 'different'],
]);
await assert.rejects(
  migrateKeychainService({
    keychain: {
      read(account, service) {
        return collisionStore.get(key(account, service)) ?? null;
      },
      write(account, value, service) {
        collisionStore.set(key(account, service), value);
      },
      delete(account, service) {
        collisionStore.delete(key(account, service));
        return true;
      },
    },
    verifyGmailAuthForMailboxesFn: async () => ({ ok: true }),
  }),
  /Destination Keychain item already exists/,
);

process.stdout.write('gmail-access tests passed\n');
