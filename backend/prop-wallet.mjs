// Only the game server can call this adapter. The browser never receives a management credential.
const fault = (status, message, code) => Object.assign(new Error(message), { status, code });
const PRICE = 5000;

export function createPropWallet({ env = process.env, fetchImpl = fetch } = {}) {
  const token = env.PROP_WALLET_ADMIN_TOKEN || '';
  const actorId = Number(env.PROP_WALLET_ADMIN_ID);
  const upstream = new URL(env.NEWAPI_URL || 'http://127.0.0.1:3000');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname);
  const enabled = env.PROP_WALLET_ENABLED === '1' && loopback && token.length >= 8 && Number.isSafeInteger(actorId) && actorId > 0;
  const headers = { Authorization: `Bearer ${token}`, 'New-Api-User': String(actorId), Accept: 'application/json', 'Content-Type': 'application/json' };
  const active = new Set();
  return {
    enabled,
    async debit({ userId, quota, operationId }) {
      if (!enabled) throw fault(503, '额度道具暂未开放。', 'WALLET_DISABLED');
      if (!Number.isSafeInteger(userId) || userId <= 0 || quota !== PRICE || !/^[a-zA-Z0-9_-]{8,128}$/.test(operationId || '')) {
        throw fault(400, '道具订单不正确。', 'WALLET_INPUT');
      }
      // A second purchase for the same account cannot race its first balance check.
      if (active.has(userId)) throw fault(409, '上一笔道具订单正在处理。', 'WALLET_BUSY');
      active.add(userId);
      try {
        let userResponse, account;
        try {
          userResponse = await fetchImpl(new URL(`/api/user/${userId}`, upstream), { headers, signal: AbortSignal.timeout(3000), redirect: 'error' });
          account = await userResponse.json();
        } catch { throw fault(503, '暂时无法确认账户余额，未发起扣款。', 'WALLET_UNAVAILABLE'); }
        if (!userResponse.ok || account?.success !== true || account.data?.id !== userId || account.data?.status !== 1 || !Number.isSafeInteger(account.data?.quota)) {
          throw fault(503, '暂时无法确认账户余额，未发起扣款。', 'WALLET_UNAVAILABLE');
        }
        if (account.data.quota < PRICE) throw fault(402, '账户额度不足 $0.01。', 'INSUFFICIENT_QUOTA');
        // New API's relative adjustment retains concurrent API usage; never overwrite its balance.
        // It has no idempotency key: persist a pending receipt BEFORE entering here and never
        // automatically resend this POST after a timeout, malformed response or service restart.
        let response, result;
        try {
          response = await fetchImpl(new URL('/api/user/manage', upstream), {
            method: 'POST', headers: { ...headers, 'X-Game-Order': operationId }, redirect: 'error',
            body: JSON.stringify({ id: userId, action: 'add_quota', mode: 'subtract', value: PRICE }),
            signal: AbortSignal.timeout(4000),
          });
          result = await response.json();
        } catch { throw fault(409, '扣款结果正在确认，请勿重复购买；联系管理员核对本笔订单。', 'PAYMENT_PENDING'); }
        if (response.ok && result?.success === true) return { reference: operationId, quota: PRICE };
        if (response.ok && result?.success === false || [400, 401, 403, 404, 429].includes(response.status)) {
          throw fault(503, '账户服务拒绝了本次扣款，道具未使用。', 'WALLET_REJECTED');
        }
        throw fault(409, '扣款结果正在确认，请勿重复购买；联系管理员核对本笔订单。', 'PAYMENT_PENDING');
      } finally { active.delete(userId); }
    },
  };
}
