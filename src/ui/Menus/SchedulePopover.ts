import type { Task } from '../../Task/Task';
import { ScheduleForm } from './ScheduleForm';
import type { TaskSaver } from './TaskEditingMenu';
import { defaultTaskSaver } from './TaskEditingMenu';

/** Where a {@link SchedulePopover} appears: next to an existing element (its own bounding rect), or at a
 *  fixed point (e.g. the mouse position from the context-menu click that opened it, when there's no single
 *  persistent element to anchor to - see {@link DateMenu}'s "Add a reminder…" item). */
export type PopoverAnchor = HTMLElement | { x: number; y: number };

/**
 * The desktop host for the standalone Schedule form ({@link ScheduleForm}), positioned next to whatever
 * element or point opened it, like the Scheduled Date pill's own flatpickr popover ({@link promptForDate}) -
 * rather than Obsidian's `Modal` (centred on the page, dimmed background, focus-trapped), which is far more
 * "present" than a single field warrants on a desktop screen. On mobile, {@link openScheduleEditor} opens
 * {@link ScheduleModal} instead: a floating box anchored to a small pill doesn't suit a phone, where the
 * on-screen keyboard resizes and scrolls the viewport under it.
 *
 * Closed by Escape, the Cancel/Apply buttons, or a click outside the popover - a click outside applies
 * whatever is currently pending (if valid), the same auto-apply-on-close behaviour {@link promptForDate}'s
 * flatpickr calendar already has, so dismissing it isn't itself a silent way to lose an edit. Escape/Cancel
 * discard instead. Scrolling (outside the popover) or resizing the window also closes it, since the anchor
 * it's positioned against has moved.
 */
export class SchedulePopover {
    private readonly containerEl: HTMLDivElement;
    private readonly form: ScheduleForm;
    private closed = false;

    constructor(anchor: PopoverAnchor, task: Task, taskSaver: TaskSaver = defaultTaskSaver) {
        this.containerEl = activeDocument.body.createDiv({ cls: 'tasks-schedule-popover' });
        this.position(anchor);
        this.form = new ScheduleForm(this.containerEl, task, taskSaver, () => this.close());
        this.clampToViewport();
        this.form.focusInput();

        // Deferred so the very click that opened this popover (still bubbling up to `document`) doesn't
        // immediately close it again.
        window.setTimeout(() => {
            if (this.closed) {
                return;
            }
            activeDocument.addEventListener('mousedown', this.onOutsideMouseDown, true);
            window.addEventListener('scroll', this.onScroll, true);
            window.addEventListener('resize', this.onResize);
        }, 0);
    }

    private position(anchor: PopoverAnchor): void {
        const el = this.containerEl;
        if (anchor instanceof HTMLElement) {
            const rect = anchor.getBoundingClientRect();
            el.style.top = `${rect.bottom + 4}px`;
            el.style.left = `${rect.left}px`;
        } else {
            el.style.top = `${anchor.y + 4}px`;
            el.style.left = `${anchor.x}px`;
        }
    }

    /** Nudges the popover back on-screen once its real size is known (only possible after rendering) - flips
     *  above the anchor if there's no room below, and pulls it left if it would overhang the right edge. */
    private clampToViewport(): void {
        const rect = this.containerEl.getBoundingClientRect();
        const overflowRight = rect.right - window.innerWidth;
        if (overflowRight > 0) {
            this.containerEl.style.left = `${Math.max(4, rect.left - overflowRight - 4)}px`;
        }
        const overflowBottom = rect.bottom - window.innerHeight;
        if (overflowBottom > 0) {
            this.containerEl.style.top = `${Math.max(4, rect.top - rect.height - 8)}px`;
        }
    }

    private onOutsideMouseDown = (ev: MouseEvent): void => {
        if (!this.containerEl.contains(ev.target as Node)) {
            void this.form.apply();
        }
    };

    private onScroll = (ev: Event): void => {
        // Scrolling inside the popover itself (e.g. a long suggestion list) doesn't move its anchor.
        if (this.containerEl.contains(ev.target as Node)) {
            return;
        }
        this.close();
    };

    private onResize = (): void => {
        this.close();
    };

    private close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        activeDocument.removeEventListener('mousedown', this.onOutsideMouseDown, true);
        window.removeEventListener('scroll', this.onScroll, true);
        window.removeEventListener('resize', this.onResize);
        this.form.destroy();
        this.containerEl.remove();
    }
}
