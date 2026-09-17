import { Menu, type MenuItem } from 'obsidian';
import type { Task } from '../../Task/Task';
import { replaceTaskWithTasks } from '../../Obsidian/File';
import { DateFallback } from '../../DateTime/DateFallback';
import type { TaskEditingInstruction } from '../EditInstructions/TaskEditingInstruction';
import { SEPARATOR_INSTRUCTION_DISPLAY_NAME } from '../EditInstructions/MenuDividerInstruction';

/**
 * A function for replacing one task with zero or more new tasks.
 * @see {@link defaultTaskSaver}
 */
export type TaskSaver = (originalTask: Task, newTasks: Task | Task[]) => Promise<void>;

/**
 * A default implementation of {@link TaskSaver} that calls {@link replaceTaskWithTasks}
 * @param originalTask
 * @param newTasks
 */
export async function defaultTaskSaver(originalTask: Task, newTasks: Task | Task[]) {
    await replaceTaskWithTasks({
        originalTask,
        newTasks,
    });
}

/**
 * A helper function to ensure that menus behave correctly, not overlapping or being overlapped by other menus.
 * @param ev
 * @param menu
 */
export function showMenu(ev: MouseEvent, menu: Menu) {
    ev.preventDefault(); // suppress the default click behavior
    ev.stopPropagation(); // suppress further event propagation
    menu.showAtPosition({ x: ev.clientX, y: ev.clientY });
}

/**
 * Base class for Menus that offer editing one or more properties of a Task object.
 *
 * Once created, menus should be passed to {@link showMenu}.
 *
 * A {@link TaskSaver} function must be supplied, in order for any edits to be saved.
 * Derived classes should default to using {@link defaultTaskSaver}, but allow
 * alternative implementations to be used in tests.
 */
export class TaskEditingMenu extends Menu {
    protected readonly taskSaver: TaskSaver;

    /**
     * Constructor, which sets up the menu items.
     * @param taskSaver - a {@link TaskSaver} function, for saving any edits.
     */
    constructor(taskSaver: TaskSaver) {
        super();

        this.taskSaver = taskSaver;
    }

    protected addItemsForInstructions(instructions: TaskEditingInstruction[], task: Task) {
        for (const instruction of instructions) {
            this.addItemForInstruction(task, instruction);
        }
    }

    private addItemForInstruction(task: Task, instruction: TaskEditingInstruction) {
        if (instruction.instructionDisplayName() === SEPARATOR_INSTRUCTION_DISPLAY_NAME) {
            this.addSeparator();
        } else {
            this.addItem((item) => this.getMenuItemCallback(task, item, instruction));
        }
    }

    private getMenuItemCallback(task: Task, item: MenuItem, instruction: TaskEditingInstruction) {
        item.setTitle(instruction.instructionDisplayName())
            .setChecked(instruction.isCheckedForTask(task))
            .onClick(async () => {
                // Reconcile scheduledDateIsInferred here rather than in each instruction: an instruction
                // that shifts scheduledDate onto a different calendar day (e.g. SetReminderDateTime picking
                // a relative offset that crosses midnight) must not leave a filename-inferred date's flag
                // set to true afterwards - the serializer omits the field entirely while it's true (see
                // DefaultTaskSerializer), so the new date would never be written to the file, and re-parsing
                // would just re-infer the *original* day from the filename again, silently discarding the
                // edit. Same fix already applied to the main edit modal's save path (QueryRenderer.ts,
                // Commands/CreateOrEdit.ts) - this is the equivalent for every instruction routed through
                // this menu (reminder quick-picks, date pickers, etc).
                const newTask = DateFallback.removeInferredStatusIfNeeded(task, instruction.apply(task));
                const hasEdits = newTask.length !== 1 || !Object.is(newTask[0], task);
                if (hasEdits) {
                    await this.taskSaver(task, newTask);
                }
            });
    }
}
