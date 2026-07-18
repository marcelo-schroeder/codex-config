import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  GMAIL_MAILBOXES,
  GMAIL_READONLY_SCOPE,
  KEYCHAIN_SERVICE,
  getAccessToken,
  gmailMailboxConfig,
  gmailRequest,
  initAuth,
  mailboxSecretOptions,
  readToken,
  secretExists,
  secretRef,
  tokenHasScope,
} from './gmail-access.mjs';

export const AUTH_REPAIR_PLAN_VERSION = 1;

const SECRET_FIELD = /(credential|client.?secret|access.?token|refresh.?token|id.?token|password|private.?key|raw.?keychain|secret.?value|^token$|^secret$)/i;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanLabels(labels) {
  return [...new Set((labels || []).map((label) => gmailMailboxConfig(label).label))];
}

export function assertSanitizedAuthValue(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSanitizedAuthValue(entry, [...path, String(index)]));
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) {
      throw new Error(`Authentication repair payload contains forbidden secret field ${[...path, key].join('.')}`);
    }
    assertSanitizedAuthValue(child, [...path, key]);
  }
  return value;
}

function baseResult(mailbox, options) {
  const config = gmailMailboxConfig(mailbox);
  const expectedEmail = cleanEmail(options.expectedEmail || config.expectedEmail);
  if (!expectedEmail) {
    throw new Error(`Gmail mailbox ${mailbox} has no confirmed expected email address`);
  }
  return {
    mailbox,
    expectedEmail,
    profileEmail: '',
    gmailUserIndex: config.gmailUserIndex,
    keychainTokenAccount: config.tokenAccount,
    keychainTokenRef: secretRef('token', options),
    requiredScope: GMAIL_READONLY_SCOPE,
    status: '',
    reason: '',
    ready: false,
  };
}

function authFailureReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid_grant/i.test(message)) return 'invalid_grant';
  if (/no refresh_token/i.test(message)) return 'missing_refresh_grant';
  if (/invalid_client|unauthorized_client/i.test(message)) return 'client_authorization_failed';
  if (/401|invalid credentials|unauthorized/i.test(message)) return 'profile_authorization_failed';
  return 'readiness_check_failed';
}

export async function checkMailboxAuth(baseOptions, mailbox, dependencies = {}) {
  const options = mailboxSecretOptions(baseOptions, mailbox);
  const result = baseResult(mailbox, options);
  const secretExistsFn = dependencies.secretExistsFn || secretExists;
  const readTokenFn = dependencies.readTokenFn || readToken;
  const getAccessTokenFn = dependencies.getAccessTokenFn || getAccessToken;
  const gmailRequestFn = dependencies.gmailRequestFn || gmailRequest;

  if (!secretExistsFn('credentials', options)) {
    return { ...result, status: 'reauthorization_required', reason: 'missing_credentials' };
  }
  if (!secretExistsFn('token', options)) {
    return { ...result, status: 'missing_token', reason: 'missing_token' };
  }
  let token;
  try {
    token = readTokenFn(options);
  } catch {
    return { ...result, status: 'reauthorization_required', reason: 'unreadable_token' };
  }
  if (!tokenHasScope(token)) {
    return { ...result, status: 'missing_scope', reason: 'missing_scope' };
  }

  try {
    // Deliberately omit every write-enabling option: preparation may refresh only in memory.
    const accessToken = await getAccessTokenFn({ ...options, allowKeychainWrite: false, allowTokenRefreshWrite: false });
    const profile = await gmailRequestFn(accessToken, '/users/me/profile');
    const profileEmail = cleanEmail(profile.emailAddress);
    if (profileEmail !== result.expectedEmail) {
      return { ...result, profileEmail, status: 'wrong_account', reason: 'profile_mismatch' };
    }
    return { ...result, profileEmail, status: 'ready', reason: 'verified_profile', ready: true };
  } catch (error) {
    return { ...result, status: 'reauthorization_required', reason: authFailureReason(error) };
  }
}

function planBasis(results) {
  return {
    version: AUTH_REPAIR_PLAN_VERSION,
    keychainService: KEYCHAIN_SERVICE,
    requiredScope: GMAIL_READONLY_SCOPE,
    mailboxes: results.map((result) => ({
      mailbox: result.mailbox,
      expectedEmail: result.expectedEmail,
      gmailUserIndex: result.gmailUserIndex,
      keychainTokenAccount: result.keychainTokenAccount,
      keychainTokenRef: result.keychainTokenRef,
      status: result.status,
      reason: result.reason,
    })),
  };
}

export function repairPlanId(results) {
  return `gmail-auth-repair-${sha256(stableJson(planBasis(results)))}`;
}

export async function prepareAuthRepair({
  baseOptions = { keychainService: KEYCHAIN_SERVICE },
  mailboxes,
  now = new Date(),
  checkMailboxAuthFn = checkMailboxAuth,
} = {}) {
  const labels = cleanLabels(mailboxes);
  if (labels.length === 0) throw new Error('At least one Gmail mailbox is required');
  const results = [];
  for (const mailbox of labels) {
    results.push(await checkMailboxAuthFn(baseOptions, mailbox));
  }
  const repairTargets = results.filter((result) => !result.ready).map((result) => ({
    mailbox: result.mailbox,
    expectedEmail: result.expectedEmail,
    gmailUserIndex: result.gmailUserIndex,
    keychainTokenAccount: result.keychainTokenAccount,
    keychainTokenRef: result.keychainTokenRef,
    approvedStatus: result.status,
    action: 'reauthorize',
  }));
  const plan = {
    kind: 'gmail_auth_repair_plan',
    version: AUTH_REPAIR_PLAN_VERSION,
    planId: repairPlanId(results),
    preparedAt: new Date(now).toISOString(),
    keychainService: KEYCHAIN_SERVICE,
    requiredScope: GMAIL_READONLY_SCOPE,
    ok: repairTargets.length === 0,
    status: repairTargets.length === 0 ? 'ready' : 'repair_required',
    mailboxes: results,
    repairTargets,
  };
  assertSanitizedAuthValue(plan);
  return plan;
}

export function validateAuthRepairPlan(plan) {
  assertSanitizedAuthValue(plan);
  if (!plan || plan.kind !== 'gmail_auth_repair_plan' || plan.version !== AUTH_REPAIR_PLAN_VERSION) {
    throw new Error('Unsupported Gmail authentication repair plan');
  }
  if (!Array.isArray(plan.mailboxes) || !Array.isArray(plan.repairTargets) || !plan.planId) {
    throw new Error('Gmail authentication repair plan is incomplete');
  }
  const labels = cleanLabels(plan.mailboxes.map((mailbox) => mailbox.mailbox));
  if (labels.length !== plan.mailboxes.length) throw new Error('Gmail authentication repair plan has duplicate mailboxes');
  for (const item of plan.mailboxes) {
    const config = gmailMailboxConfig(item.mailbox);
    if (
      cleanEmail(item.expectedEmail) !== cleanEmail(config.expectedEmail)
      || Number(item.gmailUserIndex) !== config.gmailUserIndex
      || item.keychainTokenAccount !== config.tokenAccount
      || item.keychainTokenRef !== secretRef('token', mailboxSecretOptions({ keychainService: KEYCHAIN_SERVICE }, item.mailbox))
    ) {
      throw new Error(`Gmail mailbox configuration changed for ${item.mailbox}; prepare a new repair plan`);
    }
  }
  const expectedPlanId = repairPlanId(plan.mailboxes);
  if (plan.planId !== expectedPlanId) throw new Error('Gmail authentication repair plan ID does not match its contents');
  const expectedTargets = plan.mailboxes.filter((mailbox) => mailbox.status !== 'ready').map((mailbox) => mailbox.mailbox).sort();
  const actualTargets = plan.repairTargets.map((target) => target.mailbox).sort();
  if (stableJson(expectedTargets) !== stableJson(actualTargets)) {
    throw new Error('Gmail authentication repair targets do not match the approved plan state');
  }
  for (const target of plan.repairTargets) {
    const mailbox = plan.mailboxes.find((item) => item.mailbox === target.mailbox);
    if (
      target.action !== 'reauthorize'
      || cleanEmail(target.expectedEmail) !== cleanEmail(mailbox.expectedEmail)
      || Number(target.gmailUserIndex) !== Number(mailbox.gmailUserIndex)
      || target.keychainTokenAccount !== mailbox.keychainTokenAccount
      || target.keychainTokenRef !== mailbox.keychainTokenRef
      || target.approvedStatus !== mailbox.status
    ) {
      throw new Error(`Gmail authentication repair target changed for ${target.mailbox}`);
    }
  }
  return plan;
}

export function readAuthRepairPlan(filePath) {
  return validateAuthRepairPlan(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export async function applyAuthRepairPlan(plan, {
  baseOptions = { keychainService: KEYCHAIN_SERVICE },
  timeoutMs = 180000,
  prepareAuthRepairFn = prepareAuthRepair,
  initAuthFn = initAuth,
} = {}) {
  validateAuthRepairPlan(plan);
  const labels = plan.mailboxes.map((mailbox) => mailbox.mailbox);
  const current = await prepareAuthRepairFn({ baseOptions, mailboxes: labels });
  const approvedTargets = new Map(plan.repairTargets.map((target) => [target.mailbox, target]));
  const expanded = current.repairTargets.filter((target) => !approvedTargets.has(target.mailbox));
  if (expanded.length > 0) {
    return {
      ok: false,
      status: 'approval_invalidated',
      approvedPlanId: plan.planId,
      currentPlan: current,
      expandedRepairTargets: expanded,
      results: [],
    };
  }

  const results = [];
  for (const approved of plan.repairTargets) {
    const currentMailbox = current.mailboxes.find((mailbox) => mailbox.mailbox === approved.mailbox);
    if (currentMailbox?.ready) {
      results.push({ mailbox: approved.mailbox, status: 'skipped_ready', expectedEmail: approved.expectedEmail });
      continue;
    }
    const options = mailboxSecretOptions(baseOptions, approved.mailbox);
    const authorized = await initAuthFn({
      ...options,
      expectedEmail: approved.expectedEmail,
      allowKeychainWrite: true,
      timeoutMs,
    });
    if (!authorized?.ok) {
      results.push({
        mailbox: approved.mailbox,
        status: authorized?.status || 'reauthorization_failed',
        expectedEmail: approved.expectedEmail,
        profileEmail: authorized?.profileEmail || '',
        tokenPreserved: authorized?.tokenPreserved !== false,
      });
      return { ok: false, status: 'recovery_failed', approvedPlanId: plan.planId, results };
    }
    const verifiedPlan = await prepareAuthRepairFn({ baseOptions, mailboxes: [approved.mailbox] });
    const verified = verifiedPlan.mailboxes[0];
    if (!verified?.ready) {
      results.push({ mailbox: approved.mailbox, status: 'verification_failed', expectedEmail: approved.expectedEmail });
      return { ok: false, status: 'recovery_failed', approvedPlanId: plan.planId, results };
    }
    results.push({ mailbox: approved.mailbox, status: 'repaired', expectedEmail: approved.expectedEmail, profileEmail: verified.profileEmail });
  }

  const finalPlan = await prepareAuthRepairFn({ baseOptions, mailboxes: labels });
  const output = {
    ok: finalPlan.ok,
    status: finalPlan.ok ? 'ready' : 'recovery_failed',
    approvedPlanId: plan.planId,
    verifiedPlanId: finalPlan.planId,
    results,
    mailboxes: finalPlan.mailboxes,
  };
  assertSanitizedAuthValue(output);
  return output;
}

export function configuredMailboxIdentities() {
  return GMAIL_MAILBOXES.map(({ label, expectedEmail, gmailUserIndex, tokenAccount }) => ({
    mailbox: label,
    expectedEmail,
    gmailUserIndex,
    keychainTokenAccount: tokenAccount,
  }));
}
