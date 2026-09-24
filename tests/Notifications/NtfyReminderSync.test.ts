/**
 * @jest-environment jsdom
 */
import moment from 'moment';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { type NtfyConfig, NtfyReminderSync } from '../../src/Notifications/NtfyReminderSync';
import { ntfySequenceId } from '../../src/Notifications/NtfyScheduler';
import type { LocalStorageProvider } from '../../src/Config/LocalStorageProvider';
import { Status } from '../../src/Statuses/Status';
import { TaskBuilder } from '../TestingTools/TaskBuilder';

window.moment = moment;

class MemoryStorage implements LocalStorageProvider {
    public data = new Map<string, unknown>();
    load(key: string): unknown {
        return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null;
    }
    save(key: string, value: unknown): void {
        if (value === null) {
            this.data.delete(key);
        } else {
            this.data.set(key, JSON.parse(JSON.stringify(value)));
        }
    }
}

const now = moment('2024-01-15T10:00:00');
const fireAt = moment('2024-01-15T11:00:00').unix();
const sequenceId = ntfySequenceId('vault', fireAt);

const config: NtfyConfig = {
    enabled: true,
    serverUrl: 'https://ntfy.example/',
    topic: 'my-topic',
    accessToken: 'tk_abc',
    includeTaskText: true,
    vaultName: 'vault',
    clickUrl: 'obsidian://upgraded-tasks-notifications?vault=vault',
};

function taskAt11(description = 'do it') {
    return new TaskBuilder().description(description).scheduledDate('2024-01-15').reminderTime('11:00').build();
}

function setup(status = 200) {
    const requests: RequestUrlParam[] = [];
    const request = jest.fn(async (param: RequestUrlParam) => {
        requests.push(param);
        return { status, text: '' } as RequestUrlResponse;
    });
    const sync = new NtfyReminderSync(new MemoryStorage(), request);
    return { sync, requests };
}

describe('NtfyReminderSync', () => {
    it('should schedule a new reminder with ntfy', async () => {
        const { sync, requests } = setup();
        await sync.sync([taskAt11()], now, config);

        expect(requests).toHaveLength(1);
        expect(requests[0].method).toEqual('POST');
        expect(requests[0].url).toEqual(`https://ntfy.example/my-topic/${sequenceId}`);
        expect(requests[0].body).toEqual('do it');
        expect(requests[0].headers).toMatchObject({
            'X-Delay': String(fireAt),
            'X-Title': 'Reminder',
            'X-Click': config.clickUrl,
            Authorization: 'Bearer tk_abc',
        });
    });

    it('should not re-publish on a later sync when nothing changed', async () => {
        const { sync, requests } = setup();
        await sync.sync([taskAt11()], now, config);
        await sync.sync([taskAt11()], moment(now).add(1, 'minute'), config);
        expect(requests).toHaveLength(1);
    });

    it('should cancel then re-publish when the reminder text changes', async () => {
        const { sync, requests } = setup();
        await sync.sync([taskAt11('old')], now, config);
        await sync.sync([taskAt11('new')], now, config);

        expect(requests.map((r) => r.method)).toEqual(['POST', 'DELETE', 'POST']);
        expect(requests[1].url).toEqual(`https://ntfy.example/my-topic/${sequenceId}`);
        expect(requests[2].body).toEqual('new');
    });

    it('should cancel a scheduled reminder once its task is done', async () => {
        const { sync, requests } = setup();
        await sync.sync([taskAt11()], now, config);
        const done = new TaskBuilder().status(Status.DONE).scheduledDate('2024-01-15').reminderTime('11:00').build();
        await sync.sync([done], now, config);

        expect(requests.map((r) => r.method)).toEqual(['POST', 'DELETE']);
    });

    it('should cancel everything pending when disabled', async () => {
        const { sync, requests } = setup();
        await sync.sync([taskAt11()], now, config);
        await sync.sync([taskAt11()], now, { ...config, enabled: false });
        await sync.sync([taskAt11()], now, { ...config, enabled: false });

        expect(requests.map((r) => r.method)).toEqual(['POST', 'DELETE']);
    });

    it('should move scheduled reminders when the topic changes', async () => {
        const { sync, requests } = setup();
        await sync.sync([taskAt11()], now, config);
        await sync.sync([taskAt11()], now, { ...config, topic: 'other' });

        expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
            `POST https://ntfy.example/my-topic/${sequenceId}`,
            `DELETE https://ntfy.example/my-topic/${sequenceId}`,
            `POST https://ntfy.example/other/${sequenceId}`,
        ]);
    });

    it('should back off after a failed request, then retry', async () => {
        const { sync, requests } = setup(429);
        await sync.sync([taskAt11()], now, config);
        await sync.sync([taskAt11()], moment(now).add(1, 'minute'), config);
        expect(requests).toHaveLength(1);

        await sync.sync([taskAt11()], moment(now).add(6, 'minutes'), config);
        expect(requests).toHaveLength(2);
    });

    it('should not send an Authorization header without a token', async () => {
        const { sync, requests } = setup();
        await sync.sync([taskAt11()], now, { ...config, accessToken: '' });
        expect(requests[0].headers).not.toHaveProperty('Authorization');
    });
});
