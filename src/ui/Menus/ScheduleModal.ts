import { type App, Modal, Platform } from 'obsidian';
import type { Task } from '../../Task/Task';
import { ScheduleForm } from './ScheduleForm';
import { type PopoverAnchor, SchedulePopover } from './SchedulePopover';
import { type TaskSaver, defaultTaskSaver } from './TaskEditingMenu';

/**
 * The mobile host for the standalone Schedule form ({@link ScheduleForm}): an Obsidian `Modal`, which Obsidian
 * mobile already lays out for a phone, rather than {@link SchedulePopover}'s small box floating next to the
 * tapped pill.
 *
 * Cancel, Apply, the close button and tapping outside all close it; only Apply (or one of the remove
 * buttons) saves - the usual meaning of dismissing a modal, unlike the popover, where a click outside
 * applies. The text input isn't focused on open, so the on-screen keyboard only comes up once it's tapped.
 */
export class ScheduleModal extends Modal {
    private form: ScheduleForm | undefined;

    constructor(app: App, private readonly task: Task, private readonly taskSaver: TaskSaver) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText('Schedule');
        this.modalEl.addClass('tasks-schedule-modal');
        this.form = new ScheduleForm(this.contentEl, this.task, this.taskSaver, () => this.close());
    }

    onClose(): void {
        this.form?.destroy();
        this.form = undefined;
        this.contentEl.empty();
    }
}

let app: App | undefined;

/** Gives {@link openScheduleEditor} the `App` a `Modal` needs - called once from `main.ts`, like
 *  {@link initializeFile}, so the menus and renderers that open the editor don't all need an `App` passed in. */
export function initializeScheduleEditor(newApp: App): void {
    app = newApp;
}

/**
 * Opens the standalone Schedule editor for {@link task}: {@link ScheduleModal} on mobile, otherwise
 * {@link SchedulePopover} next to {@link anchor}. The one way every caller opens it - the Reminder Time
 * pill ({@link TaskLineRenderer}), the Scheduled Date picker's and right-click menu's "Add a reminder…"
 * ({@link promptForDate}, {@link DateMenu}), and the Reminder Notifications view's reminder pill.
 */
export function openScheduleEditor(anchor: PopoverAnchor, task: Task, taskSaver: TaskSaver = defaultTaskSaver): void {
    if (Platform.isMobile && app !== undefined) {
        new ScheduleModal(app, task, taskSaver).open();
        return;
    }
    new SchedulePopover(anchor, task, taskSaver);
}
