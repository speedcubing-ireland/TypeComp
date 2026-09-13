import { describe, expect, test } from 'bun:test';
import { WcaApiError, WcaClient } from '../src/index';
import { competitionFixture } from './fixture';

describe('WCA client', () => {
  test('uses the public WCIF endpoint without a token', async () => {
    let requestedUrl = '';
    const competition = competitionFixture();
    competition.id = 'Test Open/2026';
    const client = new WcaClient({
      fetch: async (input) => {
        requestedUrl = String(input);
        return Response.json(competition);
      },
    });
    await client.fetchCompetition('Test Open/2026');
    expect(requestedUrl).toEndWith('/api/v0/competitions/Test%20Open%2F2026/wcif/public');
  });

  test('uses authorized WCIF and bearer authentication for publishing', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new WcaClient({
      accessToken: 'secret-token',
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return Response.json(competitionFixture());
      },
    });
    await client.fetchCompetition('TestOpen2026');
    await client.publishCompetition('TestOpen2026', { persons: [] });

    expect(requests[0]?.url).toEndWith('/wcif');
    expect(requests[0]?.url).not.toEndWith('/public');
    expect(new Headers(requests[1]?.init?.headers).get('Authorization')).toBe(
      'Bearer secret-token',
    );
    expect(requests[1]?.init?.method).toBe('PATCH');
  });

  test('turns HTTP failures into bounded domain errors', async () => {
    const client = new WcaClient({
      fetch: async () => new Response('forbidden detail', { status: 403 }),
    });
    await expect(client.fetchCompetition('Nope2026')).rejects.toEqual(
      new WcaApiError('WCA API request failed (403 ): forbidden detail', 403),
    );
  });

  test('normalizes malformed and unsupported WCIF responses', async () => {
    const malformed = new WcaClient({
      fetch: async () =>
        new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    });
    await expect(malformed.fetchCompetition('TestOpen2026')).rejects.toMatchObject({
      code: 'WCA_API_ERROR',
      message: 'WCA API returned malformed JSON.',
    });

    const unsupportedCompetition = competitionFixture();
    unsupportedCompetition.formatVersion = '1.3';
    const unsupported = new WcaClient({
      fetch: async () => Response.json(unsupportedCompetition),
    });
    await expect(unsupported.fetchCompetition('TestOpen2026')).rejects.toMatchObject({
      code: 'WCA_API_ERROR',
      message: 'WCA API returned unsupported WCIF version 1.3.',
    });
  });

  test('rejects a response for a different competition', async () => {
    const client = new WcaClient({
      fetch: async () => Response.json(competitionFixture()),
    });
    await expect(client.fetchCompetition('OtherOpen2026')).rejects.toMatchObject({
      code: 'WCA_API_ERROR',
      message: 'WCA API returned competition TestOpen2026 instead of OtherOpen2026.',
    });
  });
});
