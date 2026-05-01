import { describe, expect, it } from 'vitest';
import { toGitHubHooks, toGitHubPushPayload } from '../server/webhook.js';

describe('toGitHubPushPayload', () => {
  it('keeps supported push payload fields', () => {
    expect(toGitHubPushPayload({
      ref: 'refs/heads/main',
      repository: {
        name: 'live-edit-typescript',
        owner: { login: 'octocat' },
      },
      organization: { login: 'github' },
    })).toEqual({
      ref: 'refs/heads/main',
      repository: {
        name: 'live-edit-typescript',
        owner: { login: 'octocat' },
      },
      organization: { login: 'github' },
    });
  });

  it('drops malformed push payload fields without throwing', () => {
    expect(toGitHubPushPayload({
      ref: 123,
      repository: {
        name: null,
        owner: { login: false },
      },
      organization: 'github',
    })).toEqual({
      ref: undefined,
      repository: {
        name: undefined,
        owner: { login: undefined },
      },
      organization: undefined,
    });
  });

  it('returns an empty payload for non-objects', () => {
    expect(toGitHubPushPayload(null)).toEqual({});
    expect(toGitHubPushPayload('payload')).toEqual({});
  });
});

describe('toGitHubHooks', () => {
  it('keeps supported hook fields', () => {
    expect(toGitHubHooks([
      { id: 1, config: { url: 'https://example.test/api/webhook' } },
    ])).toEqual([
      { id: 1, config: { url: 'https://example.test/api/webhook' } },
    ]);
  });

  it('drops non-object hooks and malformed hook fields without throwing', () => {
    expect(toGitHubHooks([
      null,
      42,
      { id: '1', config: { url: 123 } },
      { id: 2, config: null },
    ])).toEqual([
      { id: undefined, config: { url: undefined } },
      { id: 2, config: undefined },
    ]);
  });

  it('returns an empty list for non-arrays', () => {
    expect(toGitHubHooks({ id: 1 })).toEqual([]);
    expect(toGitHubHooks(undefined)).toEqual([]);
  });
});
