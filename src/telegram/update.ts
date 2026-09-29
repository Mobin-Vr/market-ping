import { markBlocked } from "../db/users";
import { errorName, logEvent } from "../log";
import type { Env, TgChatMemberUpdated, TgUpdate } from "../types";
import { handleCallbackQueryUpdate } from "./callbacks";
import { handleMessageUpdate } from "./commands";

/** Private chats only: everything coming from groups and channels is ignored. */
export async function handleUpdate(env: Env, raw: unknown): Promise<void> {
  const update = raw as TgUpdate | null;
  if (!update || typeof update !== "object" || typeof update.update_id !== "number") {
    logEvent("update.invalid");
    return;
  }
  try {
    if (update.callback_query) {
      await handleCallbackQueryUpdate(env, update.callback_query);
      return;
    }
    if (update.message) {
      if (update.message.chat.type !== "private") return;
      await handleMessageUpdate(env, update.message);
      return;
    }
    const member = update.my_chat_member ?? update.chat_member;
    if (member) {
      if (member.chat.type !== "private") return;
      await handleMembershipUpdate(env, member);
    }
  } catch (err) {
    logEvent("update.failed", { error: errorName(err) });
  }
}

/**
 * A private-chat "kicked" status means the user blocked the bot, so we unsubscribe and
 * flag the row. "left" is handled defensively (bots do not receive it for private chats).
 */
export async function handleMembershipUpdate(env: Env, member: TgChatMemberUpdated): Promise<void> {
  const status = member.new_chat_member.status;
  if (status === "kicked" || status === "left") {
    await markBlocked(env.DB, member.chat.id);
    logEvent("membership.unsubscribed", { status });
  }
}
