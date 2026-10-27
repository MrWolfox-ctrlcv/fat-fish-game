import test from 'node:test';
import assert from 'node:assert/strict';
import { createPropWallet } from '../backend/prop-wallet.mjs';
const env = { PROP_WALLET_ENABLED: '1', PROP_WALLET_ADMIN_TOKEN: 'mock-management-only', PROP_WALLET_ADMIN_ID: '2' };
const order = { userId: 3, quota: 5000, operationId: 'test-order-123' };
const account = (quota = 10000) => Response.json({ success: true, data: { id: 3, status: 1, quota } });

test('wallet fails closed without explicit credentials and on non-loopback upstreams', async () => {
  for (const config of [{}, { ...env, NEWAPI_URL: 'https://example.com' }]) {
    const wallet = createPropWallet({ env: config, fetchImpl: () => { throw Error('must not call'); } });
    assert.equal(wallet.enabled, false);
    await assert.rejects(wallet.debit(order), { code: 'WALLET_DISABLED' });
  }
});
test('wallet uses a fixed relative quota adjustment after a fresh balance check', async () => {
  const calls = [];
  const wallet = createPropWallet({ env, fetchImpl: async (url, options) => {
    calls.push({ url: url.pathname, options });
    return calls.length === 1 ? account() : Response.json({ success: true });
  } });
  assert.deepEqual(await wallet.debit(order), { reference: order.operationId, quota: 5000 });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), { id: 3, action: 'add_quota', mode: 'subtract', value: 5000 });
  assert.equal(calls[1].options.headers['New-Api-User'], '2');
  await assert.rejects(wallet.debit({ ...order, quota: 1 }), { code: 'WALLET_INPUT' });
});
test('insufficient quota does not issue a debit', async () => {
  let calls = 0;
  const wallet = createPropWallet({ env, fetchImpl: async () => { calls++; return account(4999); } });
  await assert.rejects(wallet.debit(order), { code: 'INSUFFICIENT_QUOTA' });
  assert.equal(calls, 1);
});
test('ambiguous debit outcomes are pending and the adapter never retries', async () => {
  for (const failure of [() => { throw Error('timeout'); }, () => new Response('broken'), () => Response.json({ success: false }, { status: 500 })]) {
    let calls = 0;
    const wallet = createPropWallet({ env, fetchImpl: async () => ++calls === 1 ? account() : failure() });
    await assert.rejects(wallet.debit(order), { code: 'PAYMENT_PENDING' });
    assert.equal(calls, 2);
  }
});
