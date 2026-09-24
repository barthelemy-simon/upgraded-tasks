import { type RequestUrlParam, type RequestUrlResponse, requestUrl } from 'obsidian';
import type { Task } from '../Task/Task';
import type { LocalStorageProvider } from '../Config/LocalStorageProvider';
import { logging } from '../lib/logging';
import { type NtfyScheduledEntries, computeDesiredNtfyMessages, planNtfySync } from './NtfyScheduler';

/** The ntfy-related settings a sync needs - a plain snapshot, so this module never reads global settings. */
export interface NtfyConfig {
    enabled: boolean;
    serverUrl: string;
    topic: string;
    accessToken: string;
    includeTaskText: boolean;
    vaultName: string;
    /** Opened when the push notification is tapped - see `main.ts`'s protocol handler. */
    clickUrl: string;
}

/** Persisted (per device, via Obsidian's local storage - deliberately not the vault-synced `data.json`)
 *  record of what this device has scheduled, and on which server/topic. */
interface NtfyPersistedState {
    serverUrl: string;
    topic: string;
    entries: NtfyScheduledEntries;
}

export const NTFY_STATE_STORAGE_KEY = 'upgraded-tasks-ntfy-scheduled';

/** How long to stop trying after a failed request, so a down server or a rate limit isn't hammered once per
 *  check interval (every request counts against ntfy.sh's per-visitor limits, failed or not). */
const FAILURE_BACKOFF_SECONDS = 5 * 60;

export type RequestFn = (request: RequestUrlParam) => Promise<RequestUrlResponse>;

function topicUrl(config: Pick<NtfyConfig, 'serverUrl' | 'topic'>, sequenceId?: string): string {
    const base = `${config.serverUrl.replace(/\/+$/, '')}/${encodeURIComponent(config.topic)}`;
    return sequenceId === undefined ? base : `${base}/${sequenceId}`;
}

/**
 * Keeps ntfy's server-side queue of scheduled messages in step with the vault's reminders, so reminders are
 * pushed to a phone (via ntfy's own app) even while Obsidian itself isn't running - the thing the foreground
 * check loop in `NotificationScheduler.ts` can never do. Roadmap item 4, Phase 2 (see CLAUDE.md).
 *
 * Each {@link sync} diffs the currently wanted messages (`computeDesiredNtfyMessages`) against what this
 * device already scheduled (persisted, so it survives restarts - without it, every startup would re-push
 * duplicates) and only sends the difference: new instants are published with `X-Delay`, changed ones are
 * cancelled and re-published, and ones whose tasks were completed/edited/removed are cancelled with
 * `DELETE /<topic>/<sequence_id>`. The live ntfy.sh server was verified (2026-09-24) to honour that DELETE
 * for not-yet-delivered messages, but *not* to replace a scheduled message on re-publish with the same
 * sequence ID (both were kept) - hence cancel-then-publish rather than relying on replacement.
 *
 * State is per device on purpose: two devices would clobber each other's writes in a synced `data.json`.
 * Since sequence IDs are deterministic per (vault, instant), two devices scheduling the same reminder still
 * target the same ID, and either one's cancel removes both copies.
 */
export class NtfyReminderSync {
    private readonly logger = logging.getLogger('tasks.Notifications.Ntfy');
    private running = false;
    private backoffUntil = 0;

    constructor(private readonly storage: LocalStorageProvider, private readonly request: RequestFn = requestUrl) {}

    /**
     * Brings ntfy's scheduled messages in line with {@link tasks}. Callers must only pass a *complete* task
     * list (a warm cache): an empty or partial list reads as "those reminders were removed" and cancels them.
     *
     * With {@link config} disabled (or with no topic), this cancels anything still pending from earlier, so
     * turning the feature off really does stop pushes that were already queued.
     */
    public async sync(tasks: Task[], now: Moment, config: NtfyConfig): Promise<void> {
        if (this.running || now.unix() < this.backoffUntil) {
            return;
        }
        this.running = true;
        try {
            let state = this.loadState();
            const active = config.enabled && config.topic.trim() !== '';

            if (state && (!active || state.serverUrl !== config.serverUrl || state.topic !== config.topic)) {
                await this.cancelAllPending(state, now, config.accessToken);
                state = null;
            }
            if (!active) {
                this.saveState(null);
                return;
            }
            state ??= { serverUrl: config.serverUrl, topic: config.topic, entries: {} };

            const desired = computeDesiredNtfyMessages(tasks, now, config.vaultName, config.includeTaskText);
            const plan = planNtfySync(desired, state.entries, now);

            for (const sequenceId of plan.toForget) {
                delete state.entries[sequenceId];
            }
            this.saveState(state);

            // Persist after every request, so an interruption part-way never loses track of what's on the server.
            for (const sequenceId of plan.toCancel) {
                await this.send({ url: topicUrl(config, sequenceId), method: 'DELETE' }, config.accessToken);
                delete state.entries[sequenceId];
                this.saveState(state);
            }
            for (const message of plan.toPublish) {
                await this.send(
                    {
                        url: topicUrl(config, message.sequenceId),
                        method: 'POST',
                        body: message.body,
                        headers: this.messageHeaders(message.title, config, String(message.fireAt)),
                    },
                    config.accessToken,
                );
                state.entries[message.sequenceId] = { fireAt: message.fireAt, contentHash: message.contentHash };
                this.saveState(state);
            }
        } catch (error) {
            this.backoffUntil = now.unix() + FAILURE_BACKOFF_SECONDS;
            this.logger.warn(`ntfy sync failed, retrying in ${FAILURE_BACKOFF_SECONDS / 60} minutes`, error);
        } finally {
            this.running = false;
        }
    }

    /** Publishes one immediate message, for the "Send test notification" settings button. Throws on failure. */
    public async sendTest(config: NtfyConfig): Promise<void> {
        await this.send(
            {
                url: topicUrl(config),
                method: 'POST',
                body: 'Test notification from Tasks (Upgraded Fork). Reminders will arrive like this.',
                headers: this.messageHeaders('Tasks reminders are set up', config),
            },
            config.accessToken,
        );
    }

    private messageHeaders(title: string, config: NtfyConfig, delay?: string): Record<string, string> {
        const headers: Record<string, string> = {
            'X-Title': title,
            'X-Tags': 'alarm_clock',
            'X-Priority': '4',
            'X-Click': config.clickUrl,
        };
        if (delay !== undefined) {
            headers['X-Delay'] = delay;
        }
        return headers;
    }

    /** Best-effort: the old server/topic may be unreachable, or need credentials that were since replaced. */
    private async cancelAllPending(state: NtfyPersistedState, now: Moment, accessToken: string): Promise<void> {
        for (const [sequenceId, entry] of Object.entries(state.entries)) {
            if (entry.fireAt <= now.unix()) {
                continue;
            }
            try {
                await this.send({ url: topicUrl(state, sequenceId), method: 'DELETE' }, accessToken);
            } catch (error) {
                this.logger.warn(`Could not cancel scheduled ntfy message ${sequenceId}`, error);
            }
        }
    }

    private async send(request: RequestUrlParam, accessToken: string): Promise<void> {
        const headers = { ...request.headers };
        if (accessToken.trim() !== '') {
            headers['Authorization'] = `Bearer ${accessToken.trim()}`;
        }
        const response = await this.request({ ...request, headers, throw: false });
        if (response.status >= 400) {
            throw new Error(`ntfy ${request.method} ${request.url} failed: HTTP ${response.status} ${response.text}`);
        }
    }

    private loadState(): NtfyPersistedState | null {
        const raw = this.storage.load(NTFY_STATE_STORAGE_KEY);
        if (raw === null || typeof raw !== 'object') {
            return null;
        }
        return raw as NtfyPersistedState;
    }

    private saveState(state: NtfyPersistedState | null): void {
        this.storage.save(NTFY_STATE_STORAGE_KEY, state);
    }
}
