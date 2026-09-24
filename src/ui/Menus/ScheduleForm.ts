import { ButtonComponent } from 'obsidian';
import { TASK_FORMATS } from '../../Config/Settings';
import type { Task } from '../../Task/Task';
import { DateFallback } from '../../DateTime/DateFallback';
import type { TaskEditingInstruction } from '../EditInstructions/TaskEditingInstruction';
import { RemoveReminderTime } from '../EditInstructions/ReminderInstructions';
import { RemoveScheduledDateAndReminder, SetSchedule } from '../EditInstructions/ScheduleInstructions';
import ScheduleEditor from '../ScheduleEditor.svelte';
import type { TaskSaver } from './TaskEditingMenu';

/**
 * The standalone Schedule form - text input, date picker, time picker and two remove buttons
 * ({@link ScheduleEditor}), plus Cancel/Apply - rendered into a container supplied by its host: the floating
 * {@link SchedulePopover} on desktop, or {@link ScheduleModal} on mobile (see {@link openScheduleEditor}).
 * The host decides how it's positioned and dismissed; this owns what's being edited and how it's saved.
 *
 * {@link onDone} is called once the form has finished - applied, removed something, or cancelled - so the
 * host can close itself. Enter applies, Escape cancels.
 */
export class ScheduleForm {
    private component: ScheduleEditor | undefined;
    private scheduledDate: string;
    private reminderTime: string;
    private isValid = true;

    constructor(
        private readonly containerEl: HTMLElement,
        private readonly task: Task,
        private readonly taskSaver: TaskSaver,
        private readonly onDone: () => void,
    ) {
        this.scheduledDate = task.scheduledDate?.format('YYYY-MM-DD') ?? '';
        this.reminderTime = task.reminderTime ?? '';
        this.render();
    }

    private render(): void {
        const { scheduledDateSymbol, reminderTimeSymbol } = TASK_FORMATS.tasksPluginEmoji.taskSerializer.symbols;

        // Same section class EditTask.svelte uses, so the pickers/inputs pick up the exact same styling and
        // grid layout (see ScheduleEditor.scss/EditTask.scss) as the embedded modal usage.
        const section = this.containerEl.createDiv({ cls: 'tasks-modal-dates-section' });

        this.component = new ScheduleEditor({
            target: section,
            props: {
                scheduledDate: this.scheduledDate,
                reminderTime: this.reminderTime,
                scheduledDateSymbol,
                reminderTimeSymbol,
                accesskey: null,
                originalScheduledDate: this.task.scheduledDate,
                onRemoveScheduledDate: () => this.applyAndFinish(new RemoveScheduledDateAndReminder(this.task)),
                onRemoveReminderTime: () => this.applyAndFinish(new RemoveReminderTime()),
                onScheduledDateChange: (value: string) => {
                    this.scheduledDate = value;
                },
                onReminderTimeChange: (value: string) => {
                    this.reminderTime = value;
                },
                onValidityChange: (value: boolean) => {
                    this.isValid = value;
                },
            },
        });

        const buttonRow = this.containerEl.createDiv({ cls: 'tasks-schedule-popover-buttons' });
        new ButtonComponent(buttonRow).setButtonText('Cancel').onClick(() => this.cancel());
        new ButtonComponent(buttonRow)
            .setButtonText('Apply')
            .setCta()
            .onClick(() => void this.apply());

        this.containerEl.addEventListener('keydown', (ev: KeyboardEvent) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                void this.apply();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                this.cancel();
            }
        });
    }

    public focusInput(): void {
        this.containerEl.querySelector<HTMLInputElement>('#schedule')?.focus();
    }

    /** Saves whatever is pending, if it's valid (otherwise just finishes, discarding it). */
    public async apply(): Promise<void> {
        if (!this.isValid) {
            this.onDone();
            return;
        }
        const scheduledDate = this.scheduledDate ? window.moment(this.scheduledDate) : null;
        const reminderTime = this.reminderTime || null;
        await this.applyAndFinish(new SetSchedule(scheduledDate, reminderTime));
    }

    public cancel(): void {
        this.onDone();
    }

    /** Called by the host as it closes, however it was closed. */
    public destroy(): void {
        this.component?.$destroy();
        this.component = undefined;
    }

    private async applyAndFinish(instruction: TaskEditingInstruction): Promise<void> {
        // See the equivalent fix-up in TaskEditingMenu.getMenuItemCallback for why this is needed: SetSchedule
        // can move scheduledDate onto a different day than a filename-inferred one, and without this the
        // stale scheduledDateIsInferred flag would make the new date silently vanish on save.
        const newTasks = DateFallback.removeInferredStatusIfNeeded(this.task, instruction.apply(this.task));
        await this.taskSaver(this.task, newTasks);
        this.onDone();
    }
}
