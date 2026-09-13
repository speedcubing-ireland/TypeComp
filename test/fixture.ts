import type { Activity, Competition, Person } from '../src/index';

function person(id: number, countryIso2: string): Person {
  return {
    registrantId: id,
    name: `${countryIso2 === 'IE' ? 'Irish' : 'British'} Person ${id}`,
    wcaUserId: id,
    wcaId: `2020TEST${String(id).padStart(2, '0')}`,
    countryIso2,
    gender: id % 2 === 0 ? 'f' : 'm',
    roles: [],
    registration: {
      wcaRegistrationId: id,
      eventIds: ['333'],
      status: 'accepted',
      isCompeting: true,
    },
    assignments: [],
    personalBests: [
      {
        eventId: '333',
        type: 'average',
        best: 1_000 + id * 100,
        worldRanking: id,
        continentalRanking: id,
        nationalRanking: id,
      },
    ],
    extensions: [],
  };
}

export function activity(
  id: number,
  activityCode: string,
  startTime: string,
  endTime: string,
): Activity {
  return {
    id,
    activityCode,
    name: activityCode,
    startTime,
    endTime,
    childActivities: [],
    extensions: [],
  };
}

export function competitionFixture(): Competition {
  return {
    formatVersion: '1.2',
    id: 'TestOpen2026',
    name: 'Test Open 2026',
    shortName: 'Test Open',
    persons: Array.from({ length: 8 }, (_, index) =>
      person(index + 1, index < 4 ? 'IE' : 'GB'),
    ),
    events: [
      {
        id: '333',
        rounds: [
          {
            id: '333-r1',
            format: 'a',
            timeLimit: null,
            cutoff: null,
            advancementCondition: { type: 'ranking', level: 4 },
            results: [],
            scrambleSetCount: 1,
            extensions: [],
          },
          {
            id: '333-r2',
            format: 'a',
            timeLimit: null,
            cutoff: null,
            advancementCondition: null,
            results: [],
            scrambleSetCount: 1,
            extensions: [],
          },
        ],
        competitorLimit: null,
        qualification: null,
        extensions: [],
      },
    ],
    schedule: {
      startDate: '2026-10-03',
      numberOfDays: 1,
      venues: [
        {
          id: 1,
          name: 'Main Venue',
          latitudeMicrodegrees: 53_349_800,
          longitudeMicrodegrees: -6_260_300,
          countryIso2: 'IE',
          timezone: 'Europe/Dublin',
          rooms: [
            {
              id: 1,
              name: 'Side Stage',
              color: '#336699',
              activities: [],
              extensions: [],
            },
          ],
          extensions: [],
        },
        {
          id: 2,
          name: 'Annex',
          latitudeMicrodegrees: 53_349_800,
          longitudeMicrodegrees: -6_260_300,
          countryIso2: 'IE',
          timezone: 'Europe/Dublin',
          rooms: [
            {
              id: 2,
              name: 'Main Stage',
              color: '#cc3333',
              activities: [
                activity(
                  1,
                  '333-r1',
                  '2026-10-03T09:00:00.000Z',
                  '2026-10-03T10:00:00.000Z',
                ),
                activity(
                  2,
                  '333-r2',
                  '2026-10-03T11:00:00.000Z',
                  '2026-10-03T11:30:00.000Z',
                ),
              ],
              extensions: [],
            },
          ],
          extensions: [],
        },
      ],
    },
    series: [],
    competitorLimit: null,
    extensions: [],
    registrationInfo: {
      openTime: '2026-01-01T00:00:00.000Z',
      closeTime: '2026-09-01T00:00:00.000Z',
      baseEntryFee: 2_000,
      currencyCode: 'EUR',
      onTheSpotRegistration: false,
      useWcaRegistration: true,
    },
  };
}
