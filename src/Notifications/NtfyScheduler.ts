import type { Task } from '../Task/Task';
import { buildReminderNotificationContent } from './ReminderNotifier';

/**
 * The earliest a reminder can be handed to ntfy for scheduled delivery, relative to 'now'. ntfy's own
 * documented minimum delay is 10 seconds; this adds headroom for request latency and clock skew. Anything
 * closer than this is left to the foreground check loop (`NotificationScheduler.ts`), which is already
 * running whenever this code is.
 */
export const NTFY_MIN_LEAD_SECONDS = 30;

/**
 * The furthest ahead a reminder can be scheduled with ntfy. ntfy.sh (and a self-hosted server's default
 * `message-delay-limit`) rejects anything more than 3 days out with HTTP 400, so this stays an hour short
 * of that. Reminders further out are picked up by a later sync, once they come within range - meaning a
 * reminder more than 3 days away only gets scheduled if Obsidian runs on *some* device in the meantime.
 */
export const NTFY_MAX_HORIZON_SECONDS = 3 * 24 * 3600 - 3600;

/** ntfy messages are capped at 4,096 bytes (longer ones become attachments); stay well under that. */
const MAX_BODY_CHARS = 3000;

/** One ntfy message this plugin wants scheduled: every reminder that falls on the same instant, combined. */
export interface NtfyMessage {
    sequenceId: string;
    /** Unix timestamp (seconds) - passed to ntfy as `X-Delay`. */
    fireAt: number;
    title: string;
    body: string;
    /** Fingerprint of {@link title}/{@link body}, so a sync can tell whether a scheduled message is stale. */
    contentHash: string;
}

/** What this device has already scheduled with ntfy, as persisted between syncs (see `NtfyReminderSync`). */
export interface NtfyScheduledEntry {
    fireAt: number;
    contentHash: string;
}

export type NtfyScheduledEntries = Record<string, NtfyScheduledEntry>;

export interface NtfySyncPlan {
    /** Messages to publish. Any that replace an existing entry also appear in {@link toCancel}, and must be
     *  cancelled first - the live ntfy.sh server keeps *both* if a sequence ID is simply re-published. */
    toPublish: NtfyMessage[];
    /** Sequence IDs of scheduled-but-not-yet-delivered messages to cancel (`DELETE /<topic>/<sequence_id>`). */
    toCancel: string[];
    /** Sequence IDs whose message has already been delivered - drop from persisted state, nothing to send. */
    toForget: string[];
}

/** Small, stable, non-cryptographic string hash (djb2), rendered in base 36. */
export function stableHash(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
}

/**
 * The sequence ID for the message covering every reminder at {@link fireAt}. Deterministic, so two devices
 * syncing the same vault compute the same ID for the same instant, and restricted to `[A-Za-z0-9_-]` (the
 * live ntfy.sh server 404s on anything else in the path). {@link vaultName} is hashed into the prefix so
 * two vaults publishing to the same topic can't cancel each other's messages.
 */
export function ntfySequenceId(vaultName: string, fireAt: number): string {
    return `ut-${stableHash(vaultName)}-${fireAt}`;
}

function limitBody(lines: string[]): string {
    const kept: string[] = [];
    let length = 0;
    for (const [index, line] of lines.entries()) {
        if (length + line.length + 1 > MAX_BODY_CHARS) {
            kept.push(`…and ${lines.length - index} more`);
            break;
        }
        kept.push(line);
        length += line.length + 1;
    }
    return kept.join('\n');
}

/**
 * The ntfy messages that *should* currently be scheduled, given {@link tasks}: one per distinct reminder
 * instant in `[now + NTFY_MIN_LEAD_SECONDS, now + NTFY_MAX_HORIZON_SECONDS]`, combining every non-done task
 * whose reminder lands on it - the same "one notification per instant, never one per task" shape as the
 * foreground notifications (see `ReminderNotifier.ts`).
 *
 * With {@link includeTaskText} off, the message says only how many reminders are due, not what they are -
 * for users who don't want task text passing through a (by default public) ntfy server.
 */
export function computeDesiredNtfyMessages(
    tasks: Task[],
    now: Moment,
    vaultName: string,
    includeTaskText: boolean,
): NtfyMessage[] {
    const nowSeconds = now.unix();
    const earliest = nowSeconds + NTFY_MIN_LEAD_SECONDS;
    const latest = nowSeconds + NTFY_MAX_HORIZON_SECONDS;

    const tasksByInstant = new Map<number, Task[]>();
    for (const task of tasks) {
        if (task.isDone) {
            continue;
        }
        const reminderDateTime = task.reminderDateTime;
        if (reminderDateTime === null) {
            continue;
        }
        const fireAt = reminderDateTime.unix();
        if (fireAt < earliest || fireAt > latest) {
            continue;
        }
        const existing = tasksByInstant.get(fireAt);
        if (existing) {
            existing.push(task);
        } else {
            tasksByInstant.set(fireAt, [task]);
        }
    }

    return [...tasksByInstant.entries()]
        .sort(([a], [b]) => a - b)
        .map(([fireAt, instantTasks]) => {
            const content = buildReminderNotificationContent(instantTasks);
            const title = content.title;
            const body = includeTaskText
                ? limitBody(content.body.split('\n'))
                : instantTasks.length === 1
                ? 'A task reminder is due.'
                : `${instantTasks.length} task reminders are due.`;
            return {
                sequenceId: ntfySequenceId(vaultName, fireAt),
                fireAt,
                title,
                body,
                contentHash: stableHash(`${title}\n${body}`),
            };
        });
}

/**
 * Diffs what should be scheduled ({@link desired}) against what this device already scheduled
 * ({@link scheduled}), so a sync only sends what actually changed - ntfy.sh allows just 250 messages a day
 * per visitor, so re-publishing everything on every check is not an option.
 *
 * Entries already inside the final {@link NTFY_MIN_LEAD_SECONDS} before firing are left untouched: they're
 * outside {@link computeDesiredNtfyMessages}'s window, so without this they'd look 'no longer wanted' and be
 * cancelled moments before being delivered.
 */
export function planNtfySync(desired: NtfyMessage[], scheduled: NtfyScheduledEntries, now: Moment): NtfySyncPlan {
    const nowSeconds = now.unix();
    const plan: NtfySyncPlan = { toPublish: [], toCancel: [], toForget: [] };
    const desiredIds = new Set<string>();

    for (const message of desired) {
        desiredIds.add(message.sequenceId);
        const existing = scheduled[message.sequenceId];
        if (existing === undefined) {
            plan.toPublish.push(message);
        } else if (existing.contentHash !== message.contentHash) {
            plan.toCancel.push(message.sequenceId);
            plan.toPublish.push(message);
        }
    }

    for (const [sequenceId, entry] of Object.entries(scheduled)) {
        if (desiredIds.has(sequenceId)) {
            continue;
        }
        if (entry.fireAt <= nowSeconds) {
            plan.toForget.push(sequenceId);
        } else if (entry.fireAt >= nowSeconds + NTFY_MIN_LEAD_SECONDS) {
            plan.toCancel.push(sequenceId);
        }
    }

    return plan;
}
