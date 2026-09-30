import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSnapshotForUser, hasAnyValue } from '../src/broadcast/snapshot';
import {
   MESSAGE_MAX_DISPLAY_LINES,
   ON_DEMAND_MAX_AGE_HOURS,
   ON_DEMAND_REFRESH_MIN_GAP_SEC,
   SETTING_LAST_REFRESH_AT,
} from '../src/config';
import { countDisplayLines, renderMessage } from '../src/render/message';
import { resolveMetrics } from '../src/resolve/resolver';
import { t } from '../src/i18n';
import {
   createFakeD1,
   fakeEnv,
   jsonResponse,
   stubNetwork,
   type FakeRoute,
   type SourceHandlers,
} from './fakes';
import { allCandidates, FIXTURE_NOW, rawFixtures } from './fixtures';

const NOW = FIXTURE_NOW;
const HOUR_SEC = 3600;
/** One hour before NOW: the snapshot header must keep this time, not NOW's. */
const SNAPSHOT_AT = NOW - HOUR_SEC;
const HOUR_KEY = '2026-09-29-09';

interface SnapshotState {
   row: {
      id: number;
      created_at: number;
      hour_key: string;
      message_html: string;
      data_json: string;
   } | null;
   inserts: number;
   fetchCount: number;
}

function newState(row: SnapshotState['row'], fetchCount = 0): SnapshotState {
   return { row, inserts: 0, fetchCount };
}

/** Source handlers that count every attempt (including the retry of a failing source). */
function countingSources(state: SnapshotState): SourceHandlers {
   const ok = (payload: unknown) => () => {
      state.fetchCount += 1;
      return jsonResponse(payload);
   };
   return {
      nerkh: ok(rawFixtures.nerkh),
      navasan: ok(rawFixtures.navasan),
      megaweb: ok(rawFixtures.megaweb),
      zipodo: ok(rawFixtures.zipodo),
   };
}

function failingSources(state: SnapshotState): SourceHandlers {
   const fail = (): never => {
      state.fetchCount += 1;
      throw new TypeError('fetch failed');
   };
   return { nerkh: fail, navasan: fail, megaweb: fail, zipodo: fail };
}

function fakeSnapshotRoutes(
   state: SnapshotState,
   readLastRefreshAt: () => number | null,
): readonly FakeRoute[] {
   return [
      [
         'SELECT value FROM settings WHERE key',
         () => ({
            first:
               readLastRefreshAt() === null
                  ? null
                  : { value: String(readLastRefreshAt()) },
         }),
      ],
      ['ORDER BY id DESC LIMIT 1', () => ({ first: state.row ?? undefined })],
      [
         'INSERT INTO snapshots',
         (params) => {
            state.inserts += 1;
            state.row = {
               id: 100 + state.inserts,
               created_at: Number(params[0]),
               hour_key: String(params[1]),
               message_html: String(params[2]),
               data_json: String(params[3]),
            };
            return { lastRowId: state.row.id };
         },
      ],
      ['INSERT INTO settings', { changes: 1 }],
      ['FROM last_good', { all: [] }],
   ];
}

/** A real rendered message for a given creation time (and optional metric tweaks). */
function renderedMessage(
   createdAt: number,
   tweak?: (metrics: ReturnType<typeof resolveMetrics>['metrics']) => void,
): string {
   const metrics = resolveMetrics(
      allCandidates(),
      {},
      249601,
      createdAt,
   ).metrics;
   if (tweak) tweak(metrics);
   return renderMessage({
      hourKey: HOUR_KEY,
      createdAt,
      metrics,
      sources: ['nerkh', 'megaweb'],
   });
}

afterEach(() => {
   vi.unstubAllGlobals();
});

describe('hasAnyValue', () => {
   it('is false for an all-N/A cycle and true as soon as one metric resolved', () => {
      const empty = resolveMetrics([], {}, null, NOW).metrics;
      expect(hasAnyValue(empty)).toBe(false);
      empty.usd_toman = {
         metric: 'usd_toman',
         value: 249950,
         source: 'zipodo',
         updatedAtEpochSec: NOW,
         stale: false,
         approximate: true,
      };
      expect(hasAnyValue(empty)).toBe(true);
   });
});

describe('getSnapshotForUser - stored snapshot', () => {
   it('serves the newest stored snapshot as is, with its own header time and an age note', async () => {
      const html = renderedMessage(SNAPSHOT_AT);
      const state = newState({
         id: 5,
         created_at: SNAPSHOT_AT,
         hour_key: HOUR_KEY,
         message_html: html,
         data_json: '{}',
      });
      const network = stubNetwork({ sources: countingSources(state) });
      const fake = createFakeD1(fakeSnapshotRoutes(state, () => null));

      const result = await getSnapshotForUser(fakeEnv({ DB: fake.db }), NOW);

      expect(result?.id).toBe(5);
      expect(result?.createdAt).toBe(SNAPSHOT_AT);
      expect(result?.refreshed).toBe(false);
      expect(result?.html).toContain('3Shanbe, 7 Mehr 1405 | 09:34');
      expect(result?.html).not.toContain('10:34');
      expect(result?.html).toContain('🕒 Last update: 09:34 (1 h ago)');
      expect(state.inserts).toBe(0);
      expect(state.fetchCount).toBe(0);
      expect(network.telegramCalls).toHaveLength(0);
   });

   it('causes no API fetch for 100 users asking within the same minute', async () => {
      const state = newState({
         id: 7,
         created_at: NOW - 60,
         hour_key: HOUR_KEY,
         message_html: renderedMessage(NOW - 60),
         data_json: '{}',
      });
      stubNetwork({ sources: countingSources(state) });
      const fake = createFakeD1(fakeSnapshotRoutes(state, () => null));
      const env = fakeEnv({ DB: fake.db });

      const results = await Promise.all(
         Array.from({ length: 100 }, () => getSnapshotForUser(env, NOW)),
      );

      expect(results).toHaveLength(100);
      expect(
         results.every(
            (result) => result?.id === 7 && result.refreshed === false,
         ),
      ).toBe(true);
      expect(state.fetchCount).toBe(0);
      expect(state.inserts).toBe(0);
   });

   it('serves a snapshot that is a few hours old, without refreshing', async () => {
      const state = newState({
         id: 8,
         created_at: NOW - 5 * HOUR_SEC,
         hour_key: HOUR_KEY,
         message_html: renderedMessage(NOW - 5 * HOUR_SEC),
         data_json: '{}',
      });
      stubNetwork({ sources: countingSources(state) });
      const fake = createFakeD1(fakeSnapshotRoutes(state, () => null));

      const result = await getSnapshotForUser(fakeEnv({ DB: fake.db }), NOW);

      expect(result?.refreshed).toBe(false);
      expect(result?.html).toContain('(5 h ago)');
      expect(state.fetchCount).toBe(0);
      expect(state.inserts).toBe(0);
   });

   it('appends the age note on a new line under the budget of 26', async () => {
      const full = renderedMessage(SNAPSHOT_AT, (metrics) => {
         metrics.usd_toman = {
            metric: 'usd_toman',
            value: 249950,
            source: 'zipodo',
            updatedAtEpochSec: SNAPSHOT_AT,
            stale: false,
            approximate: true,
         };
         metrics.btc_usd = {
            metric: 'btc_usd',
            value: 83989,
            source: 'megaweb',
            updatedAtEpochSec: SNAPSHOT_AT - 9000,
            stale: true,
            approximate: false,
         };
      });
      expect(countDisplayLines(full)).toBeLessThanOrEqual(
         MESSAGE_MAX_DISPLAY_LINES - 1,
      );
      const state = newState({
         id: 9,
         created_at: SNAPSHOT_AT,
         hour_key: HOUR_KEY,
         message_html: full,
         data_json: '{}',
      });
      stubNetwork({ sources: countingSources(state) });
      const fake = createFakeD1(fakeSnapshotRoutes(state, () => null));

      const result = await getSnapshotForUser(fakeEnv({ DB: fake.db }), NOW);

      expect(countDisplayLines(result?.html ?? '')).toBeLessThanOrEqual(
         MESSAGE_MAX_DISPLAY_LINES,
      );
      expect(result?.html).toContain('🕒 Last update: 09:34 (1 h ago)');
      expect(result?.html?.split('\n').pop()).toContain('🕒 Last update');
   });

   it('folds the age note into the last line when the message is exactly at the budget', async () => {
      const atBudget = Array.from(
         { length: MESSAGE_MAX_DISPLAY_LINES },
         (_, i) => `line ${i + 1}`,
      ).join('\n');
      const state = newState({
         id: 10,
         created_at: SNAPSHOT_AT,
         hour_key: HOUR_KEY,
         message_html: atBudget,
         data_json: '{}',
      });
      stubNetwork({ sources: countingSources(state) });
      const fake = createFakeD1(fakeSnapshotRoutes(state, () => null));

      const result = await getSnapshotForUser(fakeEnv({ DB: fake.db }), NOW);

      expect(countDisplayLines(result?.html ?? '')).toBe(
         MESSAGE_MAX_DISPLAY_LINES,
      );
      expect(result?.html?.split('\n').pop()).toContain('🕒 Last update');
   });
});

describe('getSnapshotForUser - guarded emergency refresh', () => {
   it('refreshes when no snapshot exists yet', async () => {
      const state = newState(null);
      stubNetwork({ sources: countingSources(state) });
      const fake = createFakeD1(fakeSnapshotRoutes(state, () => null));

      const result = await getSnapshotForUser(fakeEnv({ DB: fake.db }), NOW);

      expect(result?.refreshed).toBe(true);
      expect(result?.createdAt).toBe(NOW);
      expect(result?.html).toContain('🕒 Last update: 10:34 (just now)');
      expect(state.inserts).toBe(1);
      expect(state.fetchCount).toBe(4);
      const claim = fake.statements.find((statement) =>
         statement.sql.includes('INSERT INTO settings'),
      );
      expect(claim?.params).toEqual([SETTING_LAST_REFRESH_AT, String(NOW)]);
   });

   it('refreshes when the newest snapshot is older than ON_DEMAND_MAX_AGE_HOURS', async () => {
      const old = NOW - (ON_DEMAND_MAX_AGE_HOURS * HOUR_SEC + 60);
      const state = newState({
         id: 3,
         created_at: old,
         hour_key: HOUR_KEY,
         message_html: renderedMessage(old),
         data_json: '{}',
      });
      stubNetwork({ sources: countingSources(state) });
      const fake = createFakeD1(fakeSnapshotRoutes(state, () => null));

      const result = await getSnapshotForUser(fakeEnv({ DB: fake.db }), NOW);

      expect(result?.refreshed).toBe(true);
      expect(result?.id).toBe(101);
      expect(result?.html).toContain('🕒 Last update: 10:34 (just now)');
      expect(state.inserts).toBe(1);
      expect(state.fetchCount).toBe(4);
   });

   it('serves a snapshot of exactly ON_DEMAND_MAX_AGE_HOURS without refreshing', async () => {
      const atLimit = NOW - ON_DEMAND_MAX_AGE_HOURS * HOUR_SEC;
      const state = newState({
         id: 4,
         created_at: atLimit,
         hour_key: HOUR_KEY,
         message_html: renderedMessage(atLimit),
         data_json: '{}',
      });
      stubNetwork({ sources: countingSources(state) });
      const fake = createFakeD1(fakeSnapshotRoutes(state, () => null));

      const result = await getSnapshotForUser(fakeEnv({ DB: fake.db }), NOW);

      expect(result?.refreshed).toBe(false);
      expect(result?.html).toContain('(24 h ago)');
      expect(state.fetchCount).toBe(0);
   });

   it('attempts only one refresh inside ON_DEMAND_REFRESH_MIN_GAP_SEC', async () => {
      const old = NOW - (ON_DEMAND_MAX_AGE_HOURS * HOUR_SEC + 60);
      const state = newState({
         id: 3,
         created_at: old,
         hour_key: HOUR_KEY,
         message_html: renderedMessage(old),
         data_json: '{}',
      });
      let lastRefreshAt: number | null = null;
      stubNetwork({ sources: failingSources(state) });
      const fake = createFakeD1(fakeSnapshotRoutes(state, () => lastRefreshAt));
      const env = fakeEnv({ DB: fake.db });

      const first = await getSnapshotForUser(env, NOW);
      const fetchesAfterFirst = state.fetchCount;
      lastRefreshAt = NOW;
      const second = await getSnapshotForUser(env, NOW + 1);
      const third = await getSnapshotForUser(
         env,
         NOW + ON_DEMAND_REFRESH_MIN_GAP_SEC - 1,
      );

      expect(fetchesAfterFirst).toBeGreaterThan(0);
      expect(state.fetchCount).toBe(fetchesAfterFirst);
      expect(first?.id).toBe(3);
      expect(first?.refreshed).toBe(false);
      expect(second?.refreshed).toBe(false);
      expect(third?.refreshed).toBe(false);
      expect(second?.html).toContain('🕒 Last update');
   });

   it('returns null when there is no snapshot and the refresh finds nothing', async () => {
      const state = newState(null);
      stubNetwork({ sources: failingSources(state) });
      const fake = createFakeD1(fakeSnapshotRoutes(state, () => null));

      expect(
         await getSnapshotForUser(fakeEnv({ DB: fake.db }), NOW),
      ).toBeNull();
      expect(state.fetchCount).toBeGreaterThan(0);
      expect(state.inserts).toBe(0);
   });
});

describe('on-demand age note', () => {
   it("uses 'just now', minutes and hours", () => {
      expect(t('en').ageAgoText(0)).toBe('just now');
      expect(t('en').ageAgoText(59)).toBe('just now');
      expect(t('en').ageAgoText(-5)).toBe('just now');
      expect(t('en').ageAgoText(60)).toBe('1 min ago');
      expect(t('en').ageAgoText(12 * 60)).toBe('12 min ago');
      expect(t('en').ageAgoText(3599)).toBe('59 min ago');
      expect(t('en').ageAgoText(HOUR_SEC)).toBe('1 h ago');
      expect(t('en').ageAgoText(3 * HOUR_SEC + 59 * 60)).toBe('3 h ago');
   });

   it("prints the snapshot's own clock time", () => {
      expect(t('en').lastUpdateLine(NOW, NOW)).toBe(
         '🕒 Last update: 10:34 (just now)',
      );
      expect(t('en').lastUpdateLine(NOW, NOW + 12 * 60)).toBe(
         '🕒 Last update: 10:34 (12 min ago)',
      );
      expect(t('en').lastUpdateLine(NOW - 3 * HOUR_SEC, NOW)).toBe(
         '🕒 Last update: 07:34 (3 h ago)',
      );
   });
});
