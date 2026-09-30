import { isValidJalaaliDate, toGregorian, toJalaali } from 'jalaali-js';
import { SEND_HOUR_FIRST, SEND_HOUR_LAST, TEHRAN_OFFSET_MIN } from './config';
import type { Lang } from './types';

const TEHRAN_OFFSET_MS = TEHRAN_OFFSET_MIN * 60_000;
const DAY_MS = 86_400_000;

export const JALALI_MONTHS = [
   'Farvardin',
   'Ordibehesht',
   'Khordad',
   'Tir',
   'Mordad',
   'Shahrivar',
   'Mehr',
   'Aban',
   'Azar',
   'Dey',
   'Bahman',
   'Esfand',
] as const;

/** Persian Jalali month names (numbers stay ASCII digits). */
export const JALALI_MONTHS_FA = [
   'فروردین',
   'اردیبهشت',
   'خرداد',
   'تیر',
   'مرداد',
   'شهریور',
   'مهر',
   'آبان',
   'آذر',
   'دی',
   'بهمن',
   'اسفند',
] as const;

/**
 * English weekday abbreviations, indexed by the Tehran weekday number (0 = Sunday).
 * Kept as an independent reference for the ICU cross-check in the tests.
 */
export const WEEKDAYS = [
   'Sun',
   'Mon',
   'Tue',
   'Wed',
   'Thu',
   'Fri',
   'Sat',
] as const;

/**
 * Persian weekday names in Latin letters, indexed by the Tehran weekday number
 * (0 = Sunday). The Iranian week starts on Saturday (Shanbeh).
 */
export const PERSIAN_WEEKDAYS = [
   '1Shanbe', // Sunday
   '2Shanbe', // Monday
   '3Shanbe', // Tuesday
   '4Shanbe', // Wednesday
   '5Shanbe', // Thursday
   'Jomeh', // Friday
   'Shanbe', // Saturday
] as const;

/**
 * Persian weekday names in Persian script, indexed by the Tehran weekday number
 * (0 = Sunday). The Iranian week starts on Saturday (شنبه).
 */
export const WEEKDAYS_FA = [
   'یکشنبه', // Sunday
   'دوشنبه', // Monday
   'سه‌شنبه', // Tuesday
   'چهارشنبه', // Wednesday
   'پنجشنبه', // Thursday
   'جمعه', // Friday
   'شنبه', // Saturday
] as const;

/** Current unix time in seconds. */
export function nowSec(): number {
   return Math.floor(Date.now() / 1000);
}

function pad2(value: number): string {
   return value < 10 ? `0${value}` : String(value);
}

export interface TehranParts {
   epochSec: number;
   /** Gregorian date parts in Tehran. */
   year: number;
   month: number;
   day: number;
   hour: number;
   minute: number;
   second: number;
   /** 0 = Sunday. */
   weekday: number;
   /** Jalali date parts in Tehran. */
   jy: number;
   jm: number;
   jd: number;
}

/**
 * Tehran wall-clock parts for an instant. Implemented by shifting the instant by the
 * fixed Tehran offset and reading UTC accessors, so the host time zone never matters.
 */
export function tehranParts(epochSec: number): TehranParts {
   const shifted = new Date(epochSec * 1000 + TEHRAN_OFFSET_MS);
   const year = shifted.getUTCFullYear();
   const month = shifted.getUTCMonth() + 1;
   const day = shifted.getUTCDate();
   const { jy, jm, jd } = toJalaali(year, month, day);
   return {
      epochSec,
      year,
      month,
      day,
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
      weekday: shifted.getUTCDay(),
      jy,
      jm,
      jd,
   };
}

/** epoch seconds from a Tehran wall-clock date/time. */
function tehranWallToEpochSec(
   y: number,
   m: number,
   d: number,
   h: number,
   min: number,
   sec: number,
): number {
   return Math.floor(
      (Date.UTC(y, m - 1, d, h, min, sec) - TEHRAN_OFFSET_MS) / 1000,
   );
}

/**
 * e.g. "3Shanbe, 7 Mehr 1405 | 09:00" (en, default) or
 * "سه‌شنبه، 7 مهر 1405 | 09:00" (fa). Digits stay ASCII in both. No city word.
 */
export function formatTehranHeader(epochSec: number, lang: Lang = 'en'): string {
   const p = tehranParts(epochSec);
   const clock = `${pad2(p.hour)}:${pad2(p.minute)}`;
   if (lang === 'fa') {
      return `${WEEKDAYS_FA[p.weekday]}، ${p.jd} ${JALALI_MONTHS_FA[p.jm - 1]} ${p.jy} | ${clock}`;
   }
   return `${PERSIAN_WEEKDAYS[p.weekday]}, ${p.jd} ${JALALI_MONTHS[p.jm - 1]} ${p.jy} | ${clock}`;
}

/** "6 Mehr 1405 20:58" (en) / "6 مهر 1405 20:58" (fa) - used in stale footnotes. */
export function formatTehranShort(epochSec: number, lang: Lang = 'en'): string {
   const p = tehranParts(epochSec);
   const month = lang === 'fa' ? JALALI_MONTHS_FA[p.jm - 1] : JALALI_MONTHS[p.jm - 1];
   return `${p.jd} ${month} ${p.jy} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "10:00" (Tehran clock time only). */
export function formatTehranClock(epochSec: number): string {
   const p = tehranParts(epochSec);
   return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Idempotency key for one hourly broadcast: Gregorian date + Tehran hour. */
export function hourKey(epochSec: number): string {
   const p = tehranParts(epochSec);
   return `${p.year}-${pad2(p.month)}-${pad2(p.day)}-${pad2(p.hour)}`;
}

/** Tehran hour (0-23). */
export function tehranHour(epochSec: number): number {
   return tehranParts(epochSec).hour;
}

/** True between 09:00 and 21:00 Tehran inclusive. */
export function isWithinSendHours(epochSec: number): boolean {
   const hour = tehranHour(epochSec);
   return hour >= SEND_HOUR_FIRST && hour <= SEND_HOUR_LAST;
}

/**
 * Parses a Jalali string such as "1405-07-07 11:12:52" that the Iranian APIs return in
 * Tehran local time and converts it to epoch seconds. Returns null when invalid.
 */
export function jalaliToEpochSec(jalali: string): number | null {
   const match =
      /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/.exec(
         jalali.trim(),
      );
   if (!match) return null;
   const jy = Number(match[1]);
   const jm = Number(match[2]);
   const jd = Number(match[3]);
   const hh = Number(match[4]);
   const mi = Number(match[5]);
   const ss = Number(match[6]);
   if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd))
      return null;
   if (hh > 23 || mi > 59 || ss > 59) return null;
   if (!isValidJalaaliDate(jy, jm, jd)) return null;
   const { gy, gm, gd } = toGregorian(jy, jm, jd);
   return tehranWallToEpochSec(gy, gm, gd, hh, mi, ss);
}

/**
 * Next hourly update time: the next full hour inside the send window
 * (09:00..21:00 Tehran), rolling to 09:00 the following day when needed.
 */
export function nextSendTimeEpochSec(epochSec: number): number {
   const p = tehranParts(epochSec);
   if (p.hour < SEND_HOUR_FIRST)
      return tehranWallToEpochSec(
         p.year,
         p.month,
         p.day,
         SEND_HOUR_FIRST,
         0,
         0,
      );
   if (p.hour < SEND_HOUR_LAST)
      return tehranWallToEpochSec(p.year, p.month, p.day, p.hour + 1, 0, 0);
   const tomorrow = new Date(epochSec * 1000 + TEHRAN_OFFSET_MS + DAY_MS);
   return tehranWallToEpochSec(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth() + 1,
      tomorrow.getUTCDate(),
      SEND_HOUR_FIRST,
      0,
      0,
   );
}