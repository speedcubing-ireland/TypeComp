import type { Competition, CompetitionTransport, WritableSection } from './domain/types';
import { WcaApiError } from './errors';

const MAX_ERROR_DETAIL_LENGTH = 500;

export interface WcaClientOptions {
  readonly accessToken?: string | undefined;
  readonly baseUrl?: string;
  readonly fetch?: Fetch;
}

export type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function isCompetition(value: unknown): value is Competition {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const schedule = candidate.schedule;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.formatVersion === 'string' &&
    Array.isArray(candidate.persons) &&
    Array.isArray(candidate.events) &&
    schedule !== null &&
    typeof schedule === 'object' &&
    Array.isArray((schedule as Record<string, unknown>).venues)
  );
}

export class WcaClient implements CompetitionTransport {
  private readonly accessToken: string | undefined;
  private readonly baseUrl: string;
  private readonly request: Fetch;

  constructor(options: WcaClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.baseUrl = (options.baseUrl ?? 'https://www.worldcubeassociation.org').replace(
      /\/+$/u,
      '',
    );
    this.request = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async fetchCompetition(competitionId: string): Promise<Competition> {
    const visibility = this.accessToken ? '' : '/public';
    return this.send(
      `/api/v0/competitions/${encodeURIComponent(competitionId)}/wcif${visibility}`,
      competitionId,
    );
  }

  async publishCompetition(
    competitionId: string,
    patch: Partial<Pick<Competition, WritableSection>>,
  ): Promise<Competition> {
    if (!this.accessToken) {
      throw new WcaApiError('Publishing requires an OAuth access token.', 401);
    }
    return this.send(
      `/api/v0/competitions/${encodeURIComponent(competitionId)}/wcif`,
      competitionId,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    );
  }

  private async send(
    path: string,
    competitionId: string,
    init: RequestInit = {},
  ): Promise<Competition> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`);

    const response = await this.request(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, MAX_ERROR_DETAIL_LENGTH);
      throw new WcaApiError(
        `WCA API request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ''}`,
        response.status,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new WcaApiError('WCA API returned malformed JSON.', response.status);
    }
    if (!isCompetition(body)) {
      throw new WcaApiError(
        'WCA API returned an invalid WCIF document.',
        response.status,
      );
    }
    if (body.formatVersion !== '1.2') {
      throw new WcaApiError(
        `WCA API returned unsupported WCIF version ${body.formatVersion}.`,
        response.status,
      );
    }
    if (body.id !== competitionId) {
      throw new WcaApiError(
        `WCA API returned competition ${body.id} instead of ${competitionId}.`,
        response.status,
      );
    }
    return body;
  }
}
