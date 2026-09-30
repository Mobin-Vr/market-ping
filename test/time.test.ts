import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import {
   formatTehranHeader,
   formatTehranShort,
   hourKey,
   isWithinSendHours,
   jalaliToEpochSec,
   nextSendTimeEpochSec,
   tehranHour,
   tehranParts,
   WEEKDAYS,
} from '../src/time';

const UTC = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** Independent Persian-calendar implementation (ICU) used to cross-check jalaali-js. */
function intlPersian(epochSec: number): {
   y: number;
   m: number;
   d: number;
   weekday: string;
} {
   const parts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
   }).formatToParts(new Date(epochSec * 1000));
   const get = (type: string): string => {
      const found = parts.find((part) => part.type === type);
      if (!found) throw new Error(`missing Intl part ${type}`);
      return found.value;
   };
   return {
      y: Number(get('year')),
      m: Number(get('month')),
      d: Number(get('day')),
      weekday: get('weekday'),
   };
}

describe('Tehran / Jalali formatting', () => {
   it('renders the header exactly as specified', () => {
      expect(formatTehranHeader(UTC('2026-09-29T05:30:00Z'))).toBe(
         '3Shanbe, 7 Mehr 1405 | 09:00',
      );
      expect(formatTehranHeader(UTC('2026-09-29T17:30:00Z'))).toBe(
         '3Shanbe, 7 Mehr 1405 | 21:00',
      );
      expect(formatTehranHeader(UTC('2026-09-29T04:30:00Z'))).toBe(
         '3Shanbe, 7 Mehr 1405 | 08:00',
      );
   });

   it('matches the live-verified source pair (navasan date field <-> unix timestamp)', () => {
      expect(jalaliToEpochSec('1405-07-06 20:58:50')).toBe(1790616530);
      expect(formatTehranShort(1790616530)).toBe('6 Mehr 1405 20:58');
      expect(formatTehranHeader(1790616530)).toBe(
         '2Shanbe, 6 Mehr 1405 | 20:58',
      );
   });

   it('parses live nerkh Jalali update strings', () => {
      expect(jalaliToEpochSec('1405-07-07 11:12:52')).toBe(
         UTC('2026-09-29T07:42:52Z'),
      );
   });

   it('rejects malformed or impossible Jalali strings', () => {
      expect(jalaliToEpochSec('')).toBeNull();
      expect(jalaliToEpochSec('garbage')).toBeNull();
      expect(jalaliToEpochSec('1405-13-01 00:00:00')).toBeNull();
      expect(jalaliToEpochSec('1405-07-32 00:00:00')).toBeNull();
      expect(jalaliToEpochSec('1405-07-07 25:00:00')).toBeNull();
   });

   it('agrees with the ICU Persian calendar for our date range', () => {
      const samples = [
         '2026-09-28T17:28:50Z',
         '2026-09-29T05:30:00Z',
         '2026-09-29T20:59:59Z',
         '2026-12-31T20:30:00Z',
         '2027-03-20T12:00:00Z',
      ];
      for (const iso of samples) {
         const parts = tehranParts(UTC(iso));
         const icu = intlPersian(UTC(iso));
         expect({ y: parts.jy, m: parts.jm, d: parts.jd }).toEqual({
            y: icu.y,
            m: icu.m,
            d: icu.d,
         });
         expect(WEEKDAYS[parts.weekday]).toBe(icu.weekday);
      }
   });
});

describe('send window and hour keys', () => {
   it('is inside 09:00-21:00 Tehran inclusive', () => {
      expect(isWithinSendHours(UTC('2026-09-29T05:30:00Z'))).toBe(true);
      expect(isWithinSendHours(UTC('2026-09-29T17:30:00Z'))).toBe(true);
      expect(isWithinSendHours(UTC('2026-09-29T04:30:00Z'))).toBe(false);
      expect(isWithinSendHours(UTC('2026-09-29T18:30:00Z'))).toBe(false);
   });

   it('builds the hourly idempotency key in ', () => {
      expect(hourKey(UTC('2026-09-29T05:30:00Z'))).toBe('2026-09-29-09');
      expect(hourKey(UTC('2026-09-29T17:30:00Z'))).toBe('2026-09-29-21');
      expect(hourKey(UTC('2026-09-29T20:30:00Z'))).toBe('2026-09-30-00');
      expect(tehranHour(UTC('2026-09-29T20:30:00Z'))).toBe(0);
   });

   it('covers 13 distinct broadcast hours per day', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 13; i += 1) {
         keys.add(hourKey(UTC('2026-09-29T05:30:00Z') + i * 3600));
      }
      expect(keys.size).toBe(13);
   });
});

describe('next update time', () => {
   it('points at the next full hour inside the window', () => {
      expect(nextSendTimeEpochSec(UTC('2026-09-29T05:30:00Z'))).toBe(
         UTC('2026-09-29T06:30:00Z'),
      );
      expect(nextSendTimeEpochSec(UTC('2026-09-29T04:30:00Z'))).toBe(
         UTC('2026-09-29T05:30:00Z'),
      );
   });

   it('rolls over to 09:00 the next day after the window closes', () => {
      expect(nextSendTimeEpochSec(UTC('2026-09-29T17:30:00Z'))).toBe(
         UTC('2026-09-30T05:30:00Z'),
      );
      expect(nextSendTimeEpochSec(UTC('2026-09-29T18:30:00Z'))).toBe(
         UTC('2026-09-30T05:30:00Z'),
      );
   });

   it('renders a short English sentence', () => {
      expect(t('en').nextUpdateText(UTC('2026-09-29T05:30:00Z'))).toBe(
         'Next update: today at 10:00.',
      );
      expect(t('en').nextUpdateText(UTC('2026-09-29T18:30:00Z'))).toBe(
         'Next update: tomorrow at 09:00.',
      );
   });
});

describe('Persian weekday names in the header', () => {
   it('uses all seven Iranian weekday names, following the Tehran date', () => {
      const samples: Array<[string, string]> = [
         ['2026-09-26T08:30:00Z', 'Shanbe, 4 Mehr 1405 | 12:00'],
         ['2026-09-27T08:30:00Z', '1Shanbe, 5 Mehr 1405 | 12:00'],
         ['2026-09-28T08:30:00Z', '2Shanbe, 6 Mehr 1405 | 12:00'],
         ['2026-09-29T08:30:00Z', '3Shanbe, 7 Mehr 1405 | 12:00'],
         ['2026-09-30T08:30:00Z', '4Shanbe, 8 Mehr 1405 | 12:00'],
         ['2026-10-01T08:30:00Z', '5Shanbe, 9 Mehr 1405 | 12:00'],
         ['2026-10-02T08:30:00Z', 'Jomeh, 10 Mehr 1405 | 12:00'],
      ];
      for (const [iso, expected] of samples) {
         expect(formatTehranHeader(UTC(iso))).toBe(expected);
      }
      expect(new Set(samples.map((pair) => pair[1].split(',')[0])).size).toBe(
         7,
      );
   });

   it('follows the Tehran date when the UTC date differs (midnight boundary)', () => {
      // 2026-09-28T20:30Z is 2026-09-29 00:00 in Tehran (Tuesday) while UTC is still Monday.
      expect(formatTehranHeader(UTC('2026-09-28T20:30:00Z'))).toBe(
         '3Shanbe, 7 Mehr 1405 | 00:00',
      );
      expect(formatTehranHeader(UTC('2026-09-28T20:29:00Z'))).toBe(
         '2Shanbe, 6 Mehr 1405 | 23:59',
      );
      expect(hourKey(UTC('2026-09-28T20:30:00Z'))).toBe('2026-09-29-00');
   });
});
