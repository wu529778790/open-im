import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionState } from 'centrifuge';
import { WorkBuddyCentrifugeClient } from './centrifuge-client.js';

function createClient(): WorkBuddyCentrifugeClient {
  return new WorkBuddyCentrifugeClient({
    url: 'wss://example.com/ws',
    connectionToken: 'conn-token',
    subscriptionToken: 'sub-token',
    channel: 'primary',
    guid: 'guid',
    userId: 'user-1',
  });
}

function createSubscription(state = SubscriptionState.Subscribed) {
  return {
    state,
    on: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
}

describe('WorkBuddyCentrifugeClient extra subscriptions', () => {
  it('reuses an existing extra subscription for the same channel', () => {
    const client = createClient();
    const sub = createSubscription();
    const newSubscription = vi.fn(() => sub);

    (client as unknown as { client: { newSubscription: typeof newSubscription } }).client = {
      newSubscription,
    };

    client.subscribeChannel('extra-channel', 'token-a');
    client.subscribeChannel('extra-channel', 'token-b');

    expect(newSubscription).toHaveBeenCalledTimes(1);
    expect(sub.subscribe).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes instead of recreating an unsubscribed extra subscription', () => {
    const client = createClient();
    const existing = createSubscription(SubscriptionState.Unsubscribed);
    const newSubscription = vi.fn();

    (client as unknown as { client: { newSubscription: typeof newSubscription } }).client = {
      newSubscription,
    };
    (client as unknown as { extraSubs: Map<string, typeof existing> }).extraSubs = new Map([
      ['extra-channel', existing],
    ]);

    client.subscribeChannel('extra-channel', 'token-a');

    expect(newSubscription).not.toHaveBeenCalled();
    expect(existing.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe('WorkBuddyCentrifugeClient OAuth refresh on 401', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes the access token once on 401 and retries the COPILOT_RESPONSE', async () => {
    const authHeaders: string[] = [];
    let token = 'old-token';
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      authHeaders.push(String((init?.headers as Record<string, string>)?.Authorization ?? ''));
      const isFirst = fetchMock.mock.calls.length === 1;
      return {
        ok: !isFirst,
        status: isFirst ? 401 : 200,
        text: async () => (isFirst ? 'unauthorized' : '{"ok":true}'),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    let refreshCount = 0;
    const client = new WorkBuddyCentrifugeClient({
      url: 'wss://x',
      connectionToken: 'c',
      subscriptionToken: 's',
      channel: 'ch',
      guid: 'g',
      userId: 'u',
      httpBaseUrl: 'https://wb.example.com',
      httpAccessToken: 'initial', // 触发 HTTP 路径的门槛；实际 token 走 getAccessToken
      getAccessToken: () => token,
      refreshToken: async () => {
        refreshCount += 1;
        token = 'new-token';
      },
    });

    await client.sendPromptResponse({
      session_id: 'sess1', // 无 '::' → externalUserId 为 null → 跳过 registerChannelFn
      prompt_id: 'm1',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'hello' }],
    } as never);

    expect(refreshCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeaders[0]).toContain('old-token');
    expect(authHeaders[1]).toContain('new-token');
  });
});
