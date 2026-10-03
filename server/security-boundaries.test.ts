import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasRole, type Actor } from './auth/actor';
import { originMatchesHost, originMatchesUrl } from './security/origin';

const actor = (role: Actor['roles'] extends ReadonlySet<infer R> ? R : never): Actor => ({ userId: 'test-user', roles: new Set([role]) });

test('payment review permission requires an admin role', () => {
  assert.equal(hasRole(actor('reader'), 'admin'), false);
  assert.equal(hasRole(actor('editor'), 'admin'), false);
  assert.equal(hasRole(actor('admin'), 'admin'), true);
  assert.equal(hasRole(null, 'admin'), false);
});

test('state-changing API origins must be present and match the request host/origin', () => {
  assert.equal(originMatchesHost('https://nerio.mn', 'nerio.mn'), true);
  assert.equal(originMatchesHost('https://evil.example', 'nerio.mn'), false);
  assert.equal(originMatchesHost('ftp://nerio.mn', 'nerio.mn'), false);
  assert.equal(originMatchesHost(null, 'nerio.mn'), false);
  assert.equal(originMatchesHost('not a URL', 'nerio.mn'), false);
  assert.equal(originMatchesUrl('https://nerio.mn', 'https://nerio.mn/api/upload'), true);
  assert.equal(originMatchesUrl('http://nerio.mn', 'https://nerio.mn/api/upload'), false);
});
