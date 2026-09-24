/**
 * @jest-environment jsdom
 */
import moment from 'moment';
import {
    NTFY_MAX_HORIZON_SECONDS,
    NTFY_MIN_LEAD_SECONDS,
    computeDesiredNtfyMessages,
    ntfySequenceId,
    planNtfySync,
} from '../../src/Notifications/NtfyScheduler';
import { Status } from '../../src/Statuses/Status';
import { TaskBuilder } from '../TestingTools/TaskBuilder';

window.moment = moment;

const now = moment('2024-01-15T10:00:00');

function taskAt(scheduledDate: string, reminderTime: string, description = 'do it') {
    return new TaskBuilder().description(description).scheduledDate(scheduledDate).reminderTime(reminderTime).build();
}

describe('ntfySequenceId', () => {
    it('should be deterministic and only use characters ntfy accepts in a path', () => {
        const id = ntfySequenceId('My Vault: 2', 1705312800);
        expect(id).toEqual(ntfySequenceId('My Vault: 2', 1705312800));
        expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should differ between vaults', () => {
        expect(ntfySequenceId('a', 1)).not.toEqual(ntfySequenceId('b', 1));
    });
});

describe('computeDesiredNtfyMessages', () => {
    it('should combine reminders on the same instant into one message', () => {
        const messages = computeDesiredNtfyMessages(
            [taskAt('2024-01-15', '11:00', 'one'), taskAt('2024-01-15', '11:00', 'two')],
            now,
            'vault',
            true,
        );
        expect(messages).toHaveLength(1);
        expect(messages[0].fireAt).toEqual(moment('2024-01-15T11:00:00').unix());
        expect(messages[0].title).toEqual('2 reminders due');
        expect(messages[0].body).toEqual('one\ntwo');
    });

    it('should produce one message per instant, soonest first', () => {
        const messages = computeDesiredNtfyMessages(
            [taskAt('2024-01-16', '09:00'), taskAt('2024-01-15', '11:00')],
            now,
            'vault',
            true,
        );
        expect(messages.map((m) => m.fireAt)).toEqual([
            moment('2024-01-15T11:00:00').unix(),
            moment('2024-01-16T09:00:00').unix(),
        ]);
    });

    it('should skip done tasks, past reminders, and reminders too soon or too far out', () => {
        const done = new TaskBuilder().status(Status.DONE).scheduledDate('2024-01-15').reminderTime('11:00').build();
        const tooSoon = moment(now).add(NTFY_MIN_LEAD_SECONDS - 1, 'seconds');
        const tooFar = moment(now).add(NTFY_MAX_HORIZON_SECONDS + 60, 'seconds');
        const messages = computeDesiredNtfyMessages(
            [
                done,
                taskAt('2024-01-15', '09:00'),
                taskAt(tooSoon.format('YYYY-MM-DD'), tooSoon.format('HH:mm')),
                taskAt(tooFar.format('YYYY-MM-DD'), tooFar.format('HH:mm')),
            ],
            now,
            'vault',
            true,
        );
        expect(messages).toEqual([]);
    });

    it('should leave task text out when asked to', () => {
        const [message] = computeDesiredNtfyMessages([taskAt('2024-01-15', '11:00', 'secret')], now, 'vault', false);
        expect(message.body).not.toContain('secret');
        expect(message.body).toEqual('A task reminder is due.');
    });
});

describe('planNtfySync', () => {
    const [message] = computeDesiredNtfyMessages([taskAt('2024-01-15', '11:00')], now, 'vault', true);

    it('should publish a message that is not yet scheduled', () => {
        expect(planNtfySync([message], {}, now)).toEqual({ toPublish: [message], toCancel: [], toForget: [] });
    });

    it('should do nothing for a message already scheduled with the same content', () => {
        const scheduled = { [message.sequenceId]: { fireAt: message.fireAt, contentHash: message.contentHash } };
        expect(planNtfySync([message], scheduled, now)).toEqual({ toPublish: [], toCancel: [], toForget: [] });
    });

    it('should cancel then re-publish a message whose content changed', () => {
        const scheduled = { [message.sequenceId]: { fireAt: message.fireAt, contentHash: 'stale' } };
        expect(planNtfySync([message], scheduled, now)).toEqual({
            toPublish: [message],
            toCancel: [message.sequenceId],
            toForget: [],
        });
    });

    it('should cancel a pending message that is no longer wanted', () => {
        const scheduled = { gone: { fireAt: now.unix() + 3600, contentHash: 'x' } };
        expect(planNtfySync([], scheduled, now)).toEqual({ toPublish: [], toCancel: ['gone'], toForget: [] });
    });

    it('should forget a message that has already been delivered', () => {
        const scheduled = { delivered: { fireAt: now.unix() - 1, contentHash: 'x' } };
        expect(planNtfySync([], scheduled, now)).toEqual({ toPublish: [], toCancel: [], toForget: ['delivered'] });
    });

    it('should leave alone a message about to be delivered', () => {
        const scheduled = { imminent: { fireAt: now.unix() + NTFY_MIN_LEAD_SECONDS - 1, contentHash: 'x' } };
        expect(planNtfySync([], scheduled, now)).toEqual({ toPublish: [], toCancel: [], toForget: [] });
    });
});
