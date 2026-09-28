import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerUser, loginUser, userFromToken, verifyPassword } from './session.js';
import { sessions } from './store.js';

describe('session auth', () => {
  it('rejects short passwords', () => assert.throws(() => registerUser('a@x.com', 'short')));
  it('signup -> login -> token resolves user', () => {
    const email = `u${Date.now()}@x.com`;
    const u = registerUser(email, 'password123');
    assert.equal(u.plan, 'free');
    assert.throws(() => registerUser(email, 'password123'), /taken/);
    const { token } = loginUser(email, 'password123');
    assert.ok(sessions.has(token));
    assert.equal(userFromToken(token)?.email, email);
    assert.throws(() => loginUser(email, 'wrongpass1'), /invalid/);
  });
  it('rejects bad tokens', () => assert.equal(userFromToken('nope'), null));
  it('wrong password fails verify', () => {
    const u = registerUser(`v${Date.now()}@x.com`, 'password123');
    void u;
    assert.equal(verifyPassword('x', 'salt', 'ab'), false);
  });
});
