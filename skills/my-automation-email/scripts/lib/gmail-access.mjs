import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { URL, URLSearchParams } from 'node:url';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';
export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const KEYCHAIN_SERVICE = 'my-automation.gmail-oauth';
export const LEGACY_KEYCHAIN_SERVICE = 'transactions.gmail-oauth';
export const KEYCHAIN_CREDENTIALS_ACCOUNT = 'credentials';
export const KEYCHAIN_PRIMARY_TOKEN_ACCOUNT = 'token-primary';
export const KEYCHAIN_TOKEN_ACCOUNT = KEYCHAIN_PRIMARY_TOKEN_ACCOUNT;
export const KEYCHAIN_SECONDARY_TOKEN_ACCOUNT = 'token-secondary';
export const KEYCHAIN_TERTIARY_TOKEN_ACCOUNT = 'token-tertiary';
export const MIGRATED_KEYCHAIN_ACCOUNTS = [
  KEYCHAIN_CREDENTIALS_ACCOUNT,
  KEYCHAIN_PRIMARY_TOKEN_ACCOUNT,
  KEYCHAIN_SECONDARY_TOKEN_ACCOUNT,
];
export const GMAIL_MAILBOXES = [
  {
    label: 'primary',
    tokenAccount: KEYCHAIN_PRIMARY_TOKEN_ACCOUNT,
    gmailUserIndex: 1,
    matchPriority: 1,
  },
  {
    label: 'secondary',
    tokenAccount: KEYCHAIN_SECONDARY_TOKEN_ACCOUNT,
    gmailUserIndex: 0,
    matchPriority: 0,
  },
  {
    label: 'tertiary',
    tokenAccount: KEYCHAIN_TERTIARY_TOKEN_ACCOUNT,
    gmailUserIndex: 2,
    matchPriority: -1,
  },
];

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

export function assertKeychainSupported() {
  if (process.platform !== 'darwin') {
    throw new Error('Gmail OAuth secrets are stored in macOS Keychain; this workflow requires macOS');
  }
}

export function keychainRef(account, service = KEYCHAIN_SERVICE) {
  return `keychain://${service}/${account}`;
}

export function gmailMailboxConfig(label) {
  const normalized = String(label || '').trim().toLowerCase();
  const found = GMAIL_MAILBOXES.find((mailbox) => mailbox.label === normalized);
  if (!found) {
    throw new Error(`Unknown Gmail mailbox: ${label}`);
  }
  return { ...found };
}

export function tokenAccountForMailbox(label) {
  return gmailMailboxConfig(label).tokenAccount;
}

export function mailboxSecretOptions(baseOptions = {}, label) {
  const mailbox = gmailMailboxConfig(label);
  return {
    ...baseOptions,
    mailbox: mailbox.label,
    tokenAccount: mailbox.tokenAccount,
    gmailUserIndex: mailbox.gmailUserIndex,
    matchPriority: mailbox.matchPriority,
  };
}

export function parseMailboxSelection(value, defaultLabels = ['primary']) {
  const text = String(value ?? '').trim();
  const rawLabels = text ? text.split(',') : defaultLabels;
  const labels = [];
  for (const rawLabel of rawLabels) {
    const label = String(rawLabel || '').trim().toLowerCase();
    if (!label) {
      continue;
    }
    if (label === 'both') {
      labels.push('primary', 'secondary');
      continue;
    }
    gmailMailboxConfig(label);
    labels.push(label);
  }
  const uniqueLabels = [...new Set(labels)];
  if (uniqueLabels.length === 0) {
    throw new Error('At least one Gmail mailbox must be selected');
  }
  return uniqueLabels;
}

export function secretRef(kind, { keychainService = KEYCHAIN_SERVICE, tokenAccount = KEYCHAIN_TOKEN_ACCOUNT } = {}) {
  assertKeychainSupported();
  return keychainRef(kind === 'credentials' ? KEYCHAIN_CREDENTIALS_ACCOUNT : tokenAccount, keychainService);
}

export function keychainRead(account, service = KEYCHAIN_SERVICE) {
  try {
    return execFileSync('/usr/bin/security', [
      'find-generic-password',
      '-s',
      service,
      '-a',
      account,
      '-w',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export function keychainWrite(account, value, service = KEYCHAIN_SERVICE) {
  try {
    execFileSync('/usr/bin/security', [
      'delete-generic-password',
      '-s',
      service,
      '-a',
      account,
    ], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    // Item did not exist. Continue with add.
  }
  execFileSync('/usr/bin/security', [
    'add-generic-password',
    '-s',
    service,
    '-a',
    account,
    '-w',
    value,
    '-U',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

export function keychainDelete(account, service = KEYCHAIN_SERVICE) {
  try {
    execFileSync('/usr/bin/security', [
      'delete-generic-password',
      '-s',
      service,
      '-a',
      account,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

export function encodeKeychainValue(value) {
  return `base64:${Buffer.from(String(value), 'utf8').toString('base64')}`;
}

export function decodeKeychainValue(value) {
  const text = String(value || '');
  if (!text.startsWith('base64:')) {
    return text;
  }
  return Buffer.from(text.slice('base64:'.length), 'base64').toString('utf8');
}

export function readSecret(kind, { keychainService = KEYCHAIN_SERVICE, tokenAccount = KEYCHAIN_TOKEN_ACCOUNT } = {}) {
  assertKeychainSupported();
  const value = keychainRead(kind === 'credentials' ? KEYCHAIN_CREDENTIALS_ACCOUNT : tokenAccount, keychainService);
  return value == null ? null : decodeKeychainValue(value);
}

export function writeSecret(kind, value, { keychainService = KEYCHAIN_SERVICE, tokenAccount = KEYCHAIN_TOKEN_ACCOUNT } = {}) {
  assertKeychainSupported();
  keychainWrite(kind === 'credentials' ? KEYCHAIN_CREDENTIALS_ACCOUNT : tokenAccount, encodeKeychainValue(value), keychainService);
}

export function secretExists(kind, options = {}) {
  return readSecret(kind, options) != null;
}

export function importCredentialsSecret(importPath, options = {}) {
  const content = fs.readFileSync(importPath, 'utf8');
  const credentials = JSON.parse(content);
  const client = credentials.installed || credentials.web || credentials;
  if (!client.client_id || !client.client_secret) {
    throw new Error(`OAuth credentials at ${importPath} must include client_id and client_secret`);
  }
  writeSecret('credentials', `${JSON.stringify(credentials, null, 2)}\n`, options);
  return {
    ok: true,
    sourcePath: importPath,
    credentialsRef: secretRef('credentials', options),
  };
}

export function tokenRefreshWriteOptions(options = {}) {
  return {
    ...options,
    allowTokenRefreshWrite: true,
  };
}

export function canPersistTokenRefresh(options = {}) {
  return Boolean(options.allowKeychainWrite || options.allowTokenRefreshWrite);
}

export function gmailMessageSearchQuery(messageIdHeader) {
  const clean = String(messageIdHeader || '').trim().replace(/^<|>$/g, '');
  if (!clean) {
    return '';
  }
  return `rfc822msgid:${clean}`;
}

export function gmailMessageWebUrl(messageIdHeader, accountIndex = 0) {
  const query = gmailMessageSearchQuery(messageIdHeader);
  if (!query) {
    return '';
  }
  return `https://mail.google.com/mail/u/${accountIndex}/#search/${encodeURIComponent(query)}`;
}

export function gmailThreadDirectUrl(threadId, accountIndex = 0) {
  const clean = String(threadId || '').trim();
  if (!clean) {
    return '';
  }
  return `https://mail.google.com/mail/u/${accountIndex}/#all/${encodeURIComponent(clean)}`;
}

export function base64UrlDecode(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeComparable(value) {
  return normalizeWhitespace(value).toLowerCase();
}

export function headerValue(message, name) {
  const headers = message?.payload?.headers || [];
  const found = headers.find((header) => String(header.name || '').toLowerCase() === String(name).toLowerCase());
  return found?.value || '';
}

export function collectMessageText(part, out = { text: [], html: [] }) {
  if (!part) {
    return out;
  }
  const mimeType = String(part.mimeType || '').toLowerCase();
  const bodyText = part.body?.data ? base64UrlDecode(part.body.data) : '';
  if (bodyText && mimeType === 'text/plain') {
    out.text.push(bodyText);
  } else if (bodyText && mimeType === 'text/html') {
    out.html.push(stripHtml(bodyText));
  }
  for (const child of part.parts || []) {
    collectMessageText(child, out);
  }
  return out;
}

export function extractMessageText(message) {
  const collected = collectMessageText(message.payload);
  const text = collected.text.join('\n\n').trim();
  if (text) {
    return text;
  }
  return collected.html.join('\n\n').trim();
}

export function messageMetadata(message, gmailAccount = {}) {
  const rfc822MessageId = headerValue(message, 'Message-ID');
  const fallbackMailbox = gmailMailboxConfig('secondary');
  const mailboxLabel = gmailAccount.label || fallbackMailbox.label;
  const configuredMailbox = GMAIL_MAILBOXES.find((mailbox) => mailbox.label === mailboxLabel) || fallbackMailbox;
  const gmailUserIndex = Number.isInteger(Number(gmailAccount.gmailUserIndex))
    ? Number(gmailAccount.gmailUserIndex)
    : configuredMailbox.gmailUserIndex;
  const matchPriority = Number.isInteger(Number(gmailAccount.matchPriority))
    ? Number(gmailAccount.matchPriority)
    : configuredMailbox.matchPriority;
  return {
    gmail_message_id: message.id || '',
    gmail_thread_id: message.threadId || '',
    gmail_rfc822_message_id: rfc822MessageId,
    gmail_search_query: gmailMessageSearchQuery(rfc822MessageId),
    gmail_web_url: gmailMessageWebUrl(rfc822MessageId, gmailUserIndex),
    gmail_direct_url: gmailThreadDirectUrl(message.threadId || message.id, gmailUserIndex),
    gmail_mailbox: mailboxLabel,
    gmail_mailbox_email: gmailAccount.profileEmail || '',
    gmail_account_index: gmailUserIndex,
    gmail_match_priority: matchPriority,
    gmail_from: headerValue(message, 'From'),
    gmail_subject: headerValue(message, 'Subject'),
    gmail_date_header: headerValue(message, 'Date'),
    gmail_internal_date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : '',
    snippet: message.snippet || '',
  };
}

export function safeHeaders(message) {
  return (message?.payload?.headers || []).map((header) => ({
    name: header.name || '',
    value: header.value || '',
  }));
}

export function formatMessageForOutput(message, gmailAccount = {}, options = {}) {
  return {
    ...messageMetadata(message, gmailAccount),
    headers: safeHeaders(message),
    text: options.includeText === false ? undefined : extractMessageText(message),
  };
}

export function loadOauthClient(options) {
  const raw = readSecret('credentials', options);
  if (!raw) {
    throw new Error(`Missing Gmail OAuth credentials: ${secretRef('credentials', options)}`);
  }
  const credentials = JSON.parse(raw);
  const client = credentials.installed || credentials.web || credentials;
  if (!client.client_id || !client.client_secret) {
    throw new Error(`OAuth credentials at ${secretRef('credentials', options)} must include client_id and client_secret`);
  }
  return {
    clientId: client.client_id,
    clientSecret: client.client_secret,
    authUri: client.auth_uri || OAUTH_AUTH_URL,
    tokenUri: client.token_uri || OAUTH_TOKEN_URL,
  };
}

export function readToken(options) {
  const raw = readSecret('token', options);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

export function tokenHasScope(token, scope = GMAIL_READONLY_SCOPE) {
  return String(token?.scope || '').split(/\s+/).includes(scope);
}

export function tokenExpired(token) {
  if (!token?.access_token) {
    return true;
  }
  if (!token.expiry_date) {
    return false;
  }
  return Number(token.expiry_date) <= Date.now() + 60000;
}

export async function exchangeToken(client, params) {
  const response = await fetch(client.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      ...params,
    }),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!response.ok) {
    throw new Error(`OAuth token request failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

export async function refreshAccessToken(client, options, token) {
  if (!token?.refresh_token) {
    throw new Error('OAuth token is expired and has no refresh_token; rerun --init-auth');
  }
  const refreshed = await exchangeToken(client, {
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token',
  });
  const updated = {
    ...token,
    ...refreshed,
    refresh_token: refreshed.refresh_token || token.refresh_token,
    expiry_date: refreshed.expires_in ? Date.now() + Number(refreshed.expires_in) * 1000 : token.expiry_date,
  };
  if (canPersistTokenRefresh(options)) {
    writeSecret('token', `${JSON.stringify(updated, null, 2)}\n`, options);
  }
  return updated;
}

export async function getAccessToken(options) {
  const client = loadOauthClient(options);
  let token = readToken(options);
  if (!token) {
    throw new Error(`Missing Gmail OAuth token: ${secretRef('token', options)}. Run with --init-auth first.`);
  }
  if (!tokenHasScope(token)) {
    throw new Error(`Gmail OAuth token does not include ${GMAIL_READONLY_SCOPE}`);
  }
  if (tokenExpired(token)) {
    token = await refreshAccessToken(client, options, token);
  }
  return token.access_token;
}

export async function gmailAccountForMailbox(baseOptions, label) {
  const mailboxOptions = mailboxSecretOptions(baseOptions, label);
  const accessToken = await getAccessToken(tokenRefreshWriteOptions(mailboxOptions));
  const profile = await gmailRequest(accessToken, '/users/me/profile');
  return {
    label,
    tokenAccount: mailboxOptions.tokenAccount,
    tokenRef: secretRef('token', mailboxOptions),
    gmailUserIndex: mailboxOptions.gmailUserIndex,
    matchPriority: mailboxOptions.matchPriority,
    profileEmail: profile.emailAddress || '',
    accessToken,
  };
}

export async function gmailAccountsForMailboxes(baseOptions, labels) {
  const accounts = [];
  for (const label of labels) {
    accounts.push(await gmailAccountForMailbox(baseOptions, label));
  }
  return accounts;
}

export async function initAuth({ timeoutMs = 180000, ...options }) {
  const client = loadOauthClient(options);
  let redirectUri = '';

  const server = http.createServer();
  const callback = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error(`Timed out waiting for OAuth callback after ${timeoutMs}ms`));
    }, timeoutMs);

    server.on('request', (request, response) => {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      if (requestUrl.pathname !== '/oauth2callback') {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      const error = requestUrl.searchParams.get('error');
      const code = requestUrl.searchParams.get('code');
      response.writeHead(error ? 400 : 200, { 'Content-Type': 'text/plain' });
      response.end(error ? `OAuth failed: ${error}` : 'Gmail authorization complete. You can close this tab.');
      clearTimeout(timeout);
      server.close();
      if (error) {
        reject(new Error(`OAuth failed: ${error}`));
      } else if (!code) {
        reject(new Error('OAuth callback did not include code'));
      } else {
        resolve({ code, redirectUri });
      }
    });

    server.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
      const authUrl = new URL(client.authUri);
      authUrl.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GMAIL_READONLY_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
      }).toString();
      process.stdout.write(`${JSON.stringify({
        action: 'open_auth_url',
        mailbox: options.mailbox || 'primary',
        authUrl: authUrl.toString(),
        redirectUri,
        tokenRef: secretRef('token', options),
      }, null, 2)}\n`);
    });
  });

  const token = await exchangeToken(client, {
    code: callback.code,
    redirect_uri: callback.redirectUri,
    grant_type: 'authorization_code',
  });
  const stored = {
    ...token,
    scope: token.scope || GMAIL_READONLY_SCOPE,
    expiry_date: token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : undefined,
  };
  writeSecret('token', `${JSON.stringify(stored, null, 2)}\n`, options);
  return {
    ok: true,
    mailbox: options.mailbox || 'primary',
    tokenRef: secretRef('token', options),
    scope: stored.scope,
    expiryDate: stored.expiry_date ? new Date(stored.expiry_date).toISOString() : '',
  };
}

export async function gmailRequest(accessToken, pathname, params = {}) {
  const url = new URL(`${GMAIL_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!response.ok) {
    throw new Error(`Gmail request failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

export async function verifyGmailAuth(options) {
  const mailbox = gmailMailboxConfig(options.mailbox || 'primary');
  const credentialsExists = secretExists('credentials', options);
  const tokenExists = secretExists('token', options);
  const result = {
    ok: false,
    mailbox: options.mailbox || mailbox.label,
    gmailUserIndex: options.gmailUserIndex ?? mailbox.gmailUserIndex,
    matchPriority: options.matchPriority ?? mailbox.matchPriority,
    credentialsRef: secretRef('credentials', options),
    tokenRef: secretRef('token', options),
    secretStore: 'keychain',
    credentialsExists,
    tokenExists,
    requiredScope: GMAIL_READONLY_SCOPE,
    tokenHasRequiredScope: false,
    consentComplete: false,
    profileEmail: '',
    messagesTotal: '',
    historyId: '',
    status: '',
  };
  if (!credentialsExists) {
    result.status = 'missing_credentials';
    return result;
  }
  if (!tokenExists) {
    result.status = 'missing_token';
    return result;
  }
  const token = readToken(options);
  result.tokenHasRequiredScope = tokenHasScope(token);
  if (!result.tokenHasRequiredScope) {
    result.status = 'missing_required_scope';
    return result;
  }
  const accessToken = await getAccessToken(tokenRefreshWriteOptions(options));
  const profile = await gmailRequest(accessToken, '/users/me/profile');
  result.ok = true;
  result.consentComplete = true;
  result.profileEmail = profile.emailAddress || '';
  result.messagesTotal = profile.messagesTotal ?? '';
  result.historyId = profile.historyId || '';
  result.status = 'ready';
  return result;
}

export async function verifyGmailAuthForMailboxes(baseOptions, labels) {
  const results = [];
  for (const label of labels) {
    results.push(await verifyGmailAuth(mailboxSecretOptions(baseOptions, label)));
  }
  if (results.length === 1) {
    return results[0];
  }
  const statusCounts = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
  return {
    ok: results.every((result) => result.ok),
    secretStore: 'keychain',
    requiredScope: GMAIL_READONLY_SCOPE,
    status: results.every((result) => result.ok) ? 'ready' : 'mixed',
    statusCounts,
    mailboxes: results,
  };
}

export async function listMessageIds(accessToken, query, maxResults = 20) {
  const body = await gmailRequest(accessToken, '/users/me/messages', {
    q: query,
    maxResults,
  });
  return (body.messages || []).map((message) => message.id).filter(Boolean);
}

export async function getMessage(accessToken, id) {
  return gmailRequest(accessToken, `/users/me/messages/${encodeURIComponent(id)}`, {
    format: 'full',
  });
}

export async function fetchCandidateMessages(accessToken, queries, maxResultsPerQuery = 20, options = {}) {
  const byId = new Map();
  const totalLimit = options.totalLimit || Infinity;
  const fallbackMailbox = gmailMailboxConfig('secondary');
  const gmailAccount = options.gmailAccount || {
    label: fallbackMailbox.label,
    gmailUserIndex: fallbackMailbox.gmailUserIndex,
    matchPriority: fallbackMailbox.matchPriority,
    profileEmail: '',
  };
  for (const query of queries) {
    if (byId.size >= totalLimit) {
      break;
    }
    const ids = await listMessageIds(accessToken, query, maxResultsPerQuery);
    for (const id of ids) {
      if (byId.size >= totalLimit && !byId.has(id)) {
        break;
      }
      if (!byId.has(id)) {
        byId.set(id, { id, queries: [] });
      }
      byId.get(id).queries.push(query);
    }
  }

  const messages = [];
  for (const item of byId.values()) {
    const message = await getMessage(accessToken, item.id);
    messages.push({ message, queries: item.queries, gmailAccount });
  }
  return messages;
}

export async function searchMessages({ gmailAccounts, query, maxResults = 20, includeText = true }) {
  const messages = [];
  for (const account of gmailAccounts) {
    const ids = await listMessageIds(account.accessToken, query, maxResults);
    for (const id of ids) {
      const message = await getMessage(account.accessToken, id);
      messages.push(formatMessageForOutput(message, account, { includeText }));
    }
  }
  return {
    ok: true,
    query,
    resultCount: messages.length,
    gmailAccounts: gmailAccounts.map((account) => ({
      label: account.label || '',
      profileEmail: account.profileEmail || '',
      gmailUserIndex: account.gmailUserIndex ?? 0,
      matchPriority: account.matchPriority ?? 0,
      tokenRef: account.tokenRef || '',
    })),
    messages,
  };
}

export async function getMessageById({ gmailAccount, messageId, includeText = true }) {
  const message = await getMessage(gmailAccount.accessToken, messageId);
  return {
    ok: true,
    mailbox: gmailAccount.label || '',
    message: formatMessageForOutput(message, gmailAccount, { includeText }),
  };
}

export async function migrateKeychainService({
  fromService = LEGACY_KEYCHAIN_SERVICE,
  toService = KEYCHAIN_SERVICE,
  accounts = MIGRATED_KEYCHAIN_ACCOUNTS,
  keychain = {
    read: keychainRead,
    write: keychainWrite,
    delete: keychainDelete,
  },
  verifyGmailAuthForMailboxesFn = verifyGmailAuthForMailboxes,
} = {}) {
  assertKeychainSupported();
  if (fromService === toService) {
    throw new Error('Source and destination Keychain services must differ');
  }
  const copied = [];
  const refs = {
    from: {},
    to: {},
  };
  const sourceValues = new Map();

  for (const account of accounts) {
    refs.from[account] = keychainRef(account, fromService);
    refs.to[account] = keychainRef(account, toService);
    const sourceValue = keychain.read(account, fromService);
    if (sourceValue == null) {
      throw new Error(`Missing source Keychain item: ${refs.from[account]}`);
    }
    const destinationValue = keychain.read(account, toService);
    if (destinationValue != null && destinationValue !== sourceValue) {
      throw new Error(`Destination Keychain item already exists with a different value: ${refs.to[account]}`);
    }
    sourceValues.set(account, sourceValue);
  }

  for (const [account, sourceValue] of sourceValues.entries()) {
    keychain.write(account, sourceValue, toService);
    if (keychain.read(account, toService) !== sourceValue) {
      throw new Error(`Could not verify copied Keychain item: ${refs.to[account]}`);
    }
    copied.push(account);
  }

  const auth = await verifyGmailAuthForMailboxesFn({ keychainService: toService }, ['primary', 'secondary']);
  if (!auth.ok) {
    throw new Error(`Copied Keychain entries, but Gmail auth verification failed: ${JSON.stringify(auth)}`);
  }

  const deleted = [];
  for (const account of accounts) {
    keychain.delete(account, fromService);
    if (keychain.read(account, fromService) != null) {
      throw new Error(`Could not delete migrated source Keychain item: ${refs.from[account]}`);
    }
    deleted.push(account);
  }

  return {
    ok: true,
    status: 'migrated_keychain_service',
    migrated: true,
    fromService,
    toService,
    copiedAccounts: copied,
    deletedSourceAccounts: deleted,
    refs,
    auth,
  };
}
