import { Platform } from 'obsidian';
import type { Task } from '../../Task/Task';
import { getSettings } from '../../Config/Settings';
import { type ReminderSuggestion, buildReminderSuggestions } from '../../DateTime/ReminderSuggestions';
import { MenuDividerInstruction } from '../EditInstructions/MenuDividerInstruction';
import { RemoveReminderTime, SetReminderDateTime, SetReminderTime } from '../EditInstructions/ReminderInstructions';
import type { TaskEditingInstruction } from '../EditInstructions/TaskEditingInstruction';
import { openScheduleEditor } from './ScheduleModal';
import { TaskEditingMenu, type TaskSaver, defaultTaskSaver, showMenu } from './TaskEditingMenu';

/**
 * The quick-pick menu for a task's reminder time: right-click on a Reminder Time pill, or a plain tap on
 * mobile (see {@link onReminderPillClick}). Its "Custom reminder…" item opens the full Schedule editor
 * ({@link openScheduleEditor}), the same form the edit modal's own "Schedule" section is built from.
 *
 * Built from {@link buildReminderSuggestions} - the same options {@link ScheduleEditor} offers as
 * autocomplete in the edit modal - so the list of quick options is user-configurable (via
 * `reminderPresetTimes`/`reminderRelativeOffsetsMinutes`/`reminderRoundingIncrementMinutes`/
 * `reminderRoundingMode`, see {@link Settings}) rather than a fixed set that may not suit everyone.
 */
export class ReminderMenu extends TaskEditingMenu {
    constructor(task: Task, taskSaver: TaskSaver = defaultTaskSaver) {
        super(taskSaver);

        const {
            reminderPresetTimes,
            reminderRelativeOffsetsMinutes,
            reminderRoundingIncrementMinutes,
            reminderRoundingMode,
        } = getSettings();
        const now = window.moment();
        const { presetTimes, relativeOffsets } = buildReminderSuggestions(
            reminderPresetTimes,
            reminderRelativeOffsetsMinutes,
            reminderRoundingIncrementMinutes,
            reminderRoundingMode,
            now,
        );

        const toInstruction = (suggestion: ReminderSuggestion): TaskEditingInstruction => {
            if (suggestion.resolvedDate) {
                // Apply the already-rounded date directly - re-parsing suggestion.value ('in 30 minutes')
                // here instead would resolve the exact, unrounded offset from 'now', silently ignoring the
                // rounding the label promised.
                // suggestion.label ('In 30 minutes (11:00)') already reads fine as a menu action.
                return new SetReminderDateTime(suggestion.resolvedDate, suggestion.label);
            }
            // For a plain preset, use SetReminderTime's own default title ('Set reminder: 09:00') rather
            // than suggestion.label (just '09:00') - that bare form is for the modal's autocomplete list,
            // where the field it's filling already makes "set reminder" implicit.
            return new SetReminderTime(suggestion.value);
        };

        this.addItemsForInstructions(
            [...relativeOffsets.map(toInstruction), new MenuDividerInstruction(), ...presetTimes.map(toInstruction)],
            task,
        );

        this.addSeparator();
        this.addItem((item) => {
            item.setTitle('Custom reminder…').onClick((evt: MouseEvent | KeyboardEvent) => {
                // Anchors the desktop popover at the click (a menu item has no lasting element of its own),
                // as DateMenu's "Add a reminder…" does. On mobile the editor is a modal, so it's unused.
                const anchor =
                    evt instanceof MouseEvent ? { x: evt.clientX, y: evt.clientY } : (evt.target as HTMLElement);
                openScheduleEditor(anchor, task, taskSaver);
            });
        });
        this.addItemsForInstructions([new RemoveReminderTime()], task);
    }
}

/**
 * What a plain click/tap on a Reminder Time pill does - in a rendered task ({@link TaskLineRenderer}) and in
 * the Reminder Notifications view alike. On desktop it opens the full Schedule editor next to the pill, with
 * the quick-pick {@link ReminderMenu} on right-click. On mobile it's the other way round: the tap opens
 * {@link ReminderMenu}, since a quick pick is what's usually wanted and a long-press is slow, and the full
 * editor is one more tap away, through the menu's "Custom reminder…".
 */
export function onReminderPillClick(ev: MouseEvent, pill: HTMLElement, task: Task, taskSaver: TaskSaver): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (Platform.isMobile) {
        showMenu(ev, new ReminderMenu(task, taskSaver));
        return;
    }
    openScheduleEditor(pill, task, taskSaver);
}
