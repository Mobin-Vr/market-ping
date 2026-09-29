import { t, type Lang } from '../i18n';
import { logEvent } from '../log';
import type { Env } from '../types';
import { tgCall } from './api';

export interface ProfileCallResult {
   /** e.g. "setMyCommands(fa)". */
   label: string;
   ok: boolean;
   /** "HTTP 200" or "HTTP 400: Bad Request: ..." */
   detail: string;
}

/**
 * Telegram profile targets: the default (no language_code) is Persian, plus explicit "fa"
 * and "en" overrides.
 */
export const PROFILE_TARGETS: ReadonlyArray<{ code: string; lang: Lang }> = [
   { code: '', lang: 'fa' },
   { code: 'fa', lang: 'fa' },
   { code: 'en', lang: 'en' },
];

async function callProfileMethod(
   env: Env,
   method: string,
   label: string,
   payload: Record<string, unknown>,
): Promise<ProfileCallResult> {
   const response = await tgCall(env.TELEGRAM_BOT_TOKEN, method, payload);
   const detail = response.ok
      ? `HTTP ${response.status}`
      : `HTTP ${response.status}${response.description ? `: ${response.description}` : ''}`;
   return { label, ok: response.ok, detail };
}

/**
 * Localises the bot profile for the default language, Persian and English.
 * Idempotent: the same three methods are re-sent unchanged every time.
 * The token is never printed or logged.
 */
export async function setupBotProfile(env: Env): Promise<ProfileCallResult[]> {
   const results: ProfileCallResult[] = [];
   for (const target of PROFILE_TARGETS) {
      const bundle = t(target.lang);
      const scope = target.code === '' ? 'default' : target.code;
      const scopePayload = target.code === '' ? {} : { language_code: target.code };
      results.push(
         await callProfileMethod(env, 'setMyCommands', `setMyCommands(${scope})`, {
            commands: bundle.profile.commands,
            ...scopePayload,
         }),
      );
      results.push(
         await callProfileMethod(env, 'setMyDescription', `setMyDescription(${scope})`, {
            description: bundle.profile.description,
            ...scopePayload,
         }),
      );
      results.push(
         await callProfileMethod(env, 'setMyShortDescription', `setMyShortDescription(${scope})`, {
            short_description: bundle.profile.shortDescription,
            ...scopePayload,
         }),
      );
   }
   logEvent('profile.setup', {
      total: results.length,
      failed: results.filter((result) => !result.ok).length,
   });
   return results;
}

/** English-only report for the admin (admin surfaces never localize). */
export function renderProfileReport(results: readonly ProfileCallResult[]): string {
   const lines = results.map((result) => `${result.label}: ${result.ok ? 'OK' : 'FAIL'} (${result.detail})`);
   const failed = results.filter((result) => !result.ok).length;
   return [
      '⚙️ <b>Bot profile setup</b>',
      `<pre>${lines.join('\n')}</pre>`,
      failed === 0 ? 'All calls succeeded.' : `${failed} call(s) failed.`,
   ].join('\n');
}