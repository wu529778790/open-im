import { describe, expect, it, vi } from 'vitest';
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
