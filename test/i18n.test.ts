import { describe, expect, it } from 'vitest';
import {
   DEFAULT_LANG,
   LANGS,
   en,
   fa,
   isLang,
   resolveLang,
   t,
   type Lang,
   type MessageStrings,
   type TextBundle,
} from '../src/i18n';
import { countDisplayLines, renderMessage } from '../src/render/message';
import { resolveMetrics } from '../src/resolve/resolver';
import { allCandidates, FIXTURE_NOW } from './fixtures';

/** Recursively collects the shape of a bundle: key path -> typeof (functions are "function"). */
function shape(value: unknown, prefix = ''): Record<string, string> {
   if (typeof value === 'function') return { [prefix]: 'function' };
   if (value === null || typeof value !== 'object')
      return { [prefix]: typeof value };
   const out: Record<string, string> = {};
   for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
   )) {
      Object.assign(out, shape(child, prefix ? `${prefix}.${key}` : key));
   }
   return out;
}

/** Every plain string of a bundle, keyed by path (used for the parity check). */
function stringsOf(bundle: TextBundle): Array<[string, string]> {
   const out: Array<[string, string]> = [];
   for (const [key, value] of Object.entries(bundle)) {
      if (typeof value === 'string') out.push([key, value]);
      if (key === 'message') {
         const message = value as MessageStrings;
         for (const [nestedKey, nested] of Object.entries(message)) {
            if (typeof nested === 'string')
               out.push([`message.${nestedKey}`, nested]);
         }
         out.push([
            'message.metricLabels.usd_toman',
            message.metricLabels.usd_toman,
         ]);
         out.push([
            'message.metricLabels.coin_emami_toman',
            message.metricLabels.coin_emami_toman,
         ]);
      }
      if (key === 'profile') {
         out.push(['profile.description', bundle.profile.description]);
         out.push([
            'profile.shortDescription',
            bundle.profile.shortDescription,
         ]);
      }
   }
   return out;
}

function renderedMessage(lang: Lang): string {
   const metrics = resolveMetrics(
      allCandidates(),
      {},
      249601,
      FIXTURE_NOW,
   ).metrics;
   return renderMessage(
      {
         hourKey: '2026-09-29-10',
         createdAt: FIXTURE_NOW,
         metrics,
         sources: ['nerkh', 'megaweb'],
      },
      lang,
   );
}

describe('language registry', () => {
   it('knows Persian and English, with Persian as the default', () => {
      expect(LANGS).toEqual(['fa', 'en']);
      expect(DEFAULT_LANG).toBe('fa');
      expect(isLang('fa')).toBe(true);
      expect(isLang('en')).toBe(true);
      expect(isLang('de')).toBe(false);
      expect(isLang(null)).toBe(false);
      expect(resolveLang('en')).toBe('en');
      expect(resolveLang(undefined)).toBe('fa');
      expect(resolveLang('xx')).toBe('fa');
      expect(t('en')).toBe(en);
      expect(t('fa')).toBe(fa);
   });
});

describe('fa/en key parity', () => {
   it('has exactly the same key shape in both bundles', () => {
      expect(shape(fa)).toEqual(shape(en));
   });

   it('defines every user-facing string in both languages', () => {
      const faStrings = stringsOf(fa);
      const enStrings = stringsOf(en);
      expect(faStrings.map(([key]) => key)).toEqual(
         enStrings.map(([key]) => key),
      );
      expect(faStrings.length).toBeGreaterThan(25);
      for (const [key, value] of faStrings)
         expect(value.trim(), `fa.${key}`).not.toBe('');
      for (const [key, value] of enStrings)
         expect(value.trim(), `en.${key}`).not.toBe('');
   });

   it('keeps Persian copy Persian and English copy English', () => {
      const persian = /[\u0600-\u06FF]/;
      const latinWord = /[A-Za-z]{4,}/;
      expect(persian.test(fa.welcome)).toBe(true);
      expect(persian.test(fa.joined)).toBe(true);
      expect(persian.test(fa.left)).toBe(true);
      expect(persian.test(fa.help)).toBe(true);
      expect(persian.test(fa.message.metricLabels.usd_toman)).toBe(true);
      expect(latinWord.test(en.welcome)).toBe(true);
      expect(persian.test(en.welcome)).toBe(false);
      // The fa title is fully Persian; only the English one keeps the Latin brand name.
      expect(fa.message.title).toContain('مارکت پینگ');
      expect(/[A-Za-z]/.test(fa.message.title.replace(/<\/?[a-zA-Z]+>/g, ''))).toBe(false);
      expect(en.message.title).toContain('Market Ping');
   });

   it('uses ASCII digits and the agreed Persian units', () => {
      expect(fa.message.na).toBe('ناموجود');
      expect(fa.message.tomanSuffix.trim()).toBe('تومان');
      expect(fa.message.formatUsdValue('4,142')).toBe('4,142 دلار');
      expect(en.message.formatUsdValue('4,142')).toBe('$4,142');
      const persianDigits = /[\u06F0-\u06F9]/;
      expect(persianDigits.test(fa.message.tomanSuffix)).toBe(false);
      expect(persianDigits.test(fa.welcome)).toBe(false);
   });

   it('keeps the Telegram profile limits and localizes them', () => {
      for (const lang of LANGS) {
         const bundle = t(lang);
         expect(bundle.profile.commands).toHaveLength(6);
         expect(
            bundle.profile.commands.map((command) => command.command),
         ).toEqual(['start', 'menu', 'price', 'language', 'stop', 'help']);
         for (const command of bundle.profile.commands) {
            expect(command.command).toMatch(/^[a-z]{1,32}$/);
            expect(command.description.length).toBeGreaterThan(0);
            expect(command.description.length).toBeLessThanOrEqual(256);
         }
         expect(bundle.profile.description.length).toBeLessThanOrEqual(512);
         expect(bundle.profile.shortDescription.length).toBeLessThanOrEqual(
            120,
         );
      }
      expect(fa.profile.description).toContain('09:00');
   });
});

describe('lastUpdateLine city-word guard', () => {
   it('has no Tehran/تهران, no dash placeholder and no double space in either language', () => {
      for (const lang of LANGS) {
         for (const now of [FIXTURE_NOW, FIXTURE_NOW + 7 * 60, FIXTURE_NOW + 2 * 3600]) {
            const line = t(lang).lastUpdateLine(FIXTURE_NOW, now);
            expect(line).not.toContain('Tehran');
            expect(line).not.toContain('تهران');
            expect(line).not.toContain(' - ');
            expect(line).not.toContain('  ');
         }
      }
   });
});

describe('localized price message', () => {
   it('renders the English message with English labels and units', () => {
      const message = renderedMessage('en');
      expect(message).toContain('📈 <b>Market Ping</b>');
      expect(message).toContain('💱 <b>Currency</b>');
      expect(message).toContain('🥇 <b>Gold &amp; Coins</b>');
      expect(message).toContain('₿ <b>Crypto</b>');
      expect(message).toContain('Tala Garam (18K)');
      expect(message).toContain('$4,142');
      expect(message).toContain('244,800 T');
      expect(message).not.toContain('T = Toman');
   });

   it('renders the Persian message with Persian labels and units', () => {
      const message = renderedMessage('fa');
      expect(message).toContain('💱 <b>نرخ ارز</b>');
      expect(message).toContain('🥇 <b>طلا و سکه</b>');
      expect(message).toContain('₿ <b>ارز دیجیتال</b>');
      expect(message).toContain('طلا گرم 18 عیار');
      expect(message).toContain('سکه امامی');
      expect(message).toContain('4,142 دلار');
      expect(message).toContain('244,800 تومان');
      expect(message).not.toContain('منبع');
      expect(message).toContain('سه‌شنبه، 7 مهر 1405 | 10:34');
      // Persian uses the word دلار after the number, never the $ symbol.
      expect(message).not.toContain('$');
      expect(message).not.toContain('<pre>');
      expect(message).toContain('<blockquote>');
   });

   it('keeps the layout and the line budget in both languages', () => {
      for (const lang of LANGS) {
         const message = renderedMessage(lang);
         expect(countDisplayLines(message)).toBeLessThanOrEqual(26);
         expect(message.match(/<pre>/g)?.length ?? 0).toBe(
            lang === 'en' ? 3 : 0,
         );
         expect(message.match(/<blockquote>/g)?.length ?? 0).toBe(
            lang === 'fa' ? 3 : 0,
         );
      }
   });

   it('renders Persian placeholders, stale footnotes and the approximate note', () => {
      const metrics = resolveMetrics(
         allCandidates(),
         {},
         249601,
         FIXTURE_NOW,
      ).metrics;
      metrics.coin_emami_toman = {
         metric: 'coin_emami_toman',
         value: null,
         source: null,
         updatedAtEpochSec: null,
         stale: false,
         approximate: false,
      };
      metrics.usd_toman = {
         metric: 'usd_toman',
         value: 249950,
         source: 'zipodo',
         updatedAtEpochSec: FIXTURE_NOW,
         stale: false,
         approximate: true,
      };
      metrics.btc_usd = {
         metric: 'btc_usd',
         value: 83989,
         source: 'megaweb',
         updatedAtEpochSec: 1790616530,
         stale: true,
         approximate: false,
      };
      const message = renderMessage(
         {
            hourKey: '2026-09-29-10',
            createdAt: FIXTURE_NOW,
            metrics,
            sources: ['nerkh', 'zipodo', 'megaweb'],
         },
         'fa',
      );
      expect(message).toContain('ناموجود');
      expect(message).toContain('~249,950 تومان');
      expect(message).toContain('~ بر اساس نرخ تتر');
      expect(message).toContain(
         '* بیت‌کوین: آخرین به‌روزرسانی 6 مهر 1405 20:58',
      );
      expect(countDisplayLines(message)).toBeLessThanOrEqual(26);
   });
});
