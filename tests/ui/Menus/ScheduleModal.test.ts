/**
 * @jest-environment jsdom
 */
import { Platform } from 'obsidian';
import moment from 'moment';
import { SchedulePopover } from '../../../src/ui/Menus/SchedulePopover';
import { ScheduleModal, initializeScheduleEditor, openScheduleEditor } from '../../../src/ui/Menus/ScheduleModal';
import { TaskBuilder } from '../../TestingTools/TaskBuilder';

const mockOpenedModals: unknown[] = [];

jest.mock('obsidian', () => ({
    Modal: class {
        open() {
            mockOpenedModals.push(this);
        }
    },
    Platform: { isMobile: false },
}));
jest.mock('../../../src/ui/Menus/SchedulePopover', () => ({ SchedulePopover: jest.fn() }));
jest.mock('../../../src/ui/Menus/ScheduleForm', () => ({ ScheduleForm: jest.fn() }));
jest.mock('../../../src/ui/Menus/TaskEditingMenu', () => ({ defaultTaskSaver: jest.fn() }));

window.moment = moment;

const MockedSchedulePopover = jest.mocked(SchedulePopover);
const task = new TaskBuilder().description('Call John').build();
const anchor = { x: 10, y: 20 };
const taskSaver = jest.fn();

describe('openScheduleEditor', () => {
    beforeEach(() => {
        MockedSchedulePopover.mockClear();
        mockOpenedModals.length = 0;
        initializeScheduleEditor({} as any);
    });

    it('should open the popover next to the anchor on desktop', () => {
        Platform.isMobile = false;

        openScheduleEditor(anchor, task, taskSaver);

        expect(MockedSchedulePopover).toHaveBeenCalledWith(anchor, task, taskSaver);
        expect(mockOpenedModals).toHaveLength(0);
    });

    it('should open a modal instead of the popover on mobile', () => {
        Platform.isMobile = true;

        openScheduleEditor(anchor, task, taskSaver);

        expect(mockOpenedModals).toHaveLength(1);
        expect(mockOpenedModals[0]).toBeInstanceOf(ScheduleModal);
        expect(MockedSchedulePopover).not.toHaveBeenCalled();
    });
});
