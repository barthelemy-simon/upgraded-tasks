<script lang="ts">
    import { onDestroy } from 'svelte';
    import { Component, MarkdownRenderer, type App } from 'obsidian';
    import type { Task } from '../Task/Task';
    import {
        NOTIFICATION_BUCKET_LABELS,
        NOTIFICATION_BUCKET_ORDER,
        type NotificationBucket,
    } from '../Notifications/NotificationBuckets';
    import { ReminderMenu, onReminderPillClick } from './Menus/ReminderMenu';
    import { defaultTaskSaver, showMenu, type TaskSaver } from './Menus/TaskEditingMenu';

    // Passed in as props by NotificationsItemView.onOpen() / its onCacheUpdate handler ($set):
    export let groups: Record<NotificationBucket, Task[]>;
    export let onOpenTask: (task: Task) => void;
    export let taskSaver: TaskSaver = defaultTaskSaver;
    export let app: App;

    // A description can contain Markdown - wikilinks, tags, bold, etc. - but Svelte's plain {expr}
    // interpolation only ever inserts an escaped text node, so it never resolves e.g. [[wikilinks]] the way
    // the main task list view does (see TaskLineRenderer.obsidianMarkdownRenderer). Rendering it instead
    // needs a real Obsidian Component per node, for MarkdownRenderer.render to attach internal-link click
    // handlers to - same pattern QuickSearchTasksModal's suggestion rendering uses, tracked here and
    // unloaded on destroy rather than reusing this view's own lifecycle, since a row's Component needs to go
    // away when that row does, not only when the whole view closes.
    const renderComponents: Component[] = [];
    onDestroy(() => {
        renderComponents.forEach((component) => component.unload());
        renderComponents.length = 0;
    });

    function renderDescription(node: HTMLElement, task: Task) {
        const component = new Component();
        component.load();
        renderComponents.push(component);

        const render = (t: Task) => {
            node.empty();
            void MarkdownRenderer.render(app, t.descriptionWithoutTags, node, t.path, component).then(() => {
                // Unwrap the p-tag MarkdownRenderer wraps its output in - see TaskLineRenderer.renderDescription
                // for the same fix; left in place here it'd add unwanted paragraph margin inside this row.
                const pElement = node.querySelector('p');
                if (pElement !== null) {
                    while (pElement.firstChild) {
                        node.insertBefore(pElement.firstChild, pElement);
                    }
                    pElement.remove();
                }
            });
        };
        render(task);

        return {
            update: render,
            destroy() {
                component.unload();
                const index = renderComponents.indexOf(component);
                if (index !== -1) renderComponents.splice(index, 1);
            },
        };
    }

    $: isEmpty = NOTIFICATION_BUCKET_ORDER.every((bucket) => groups[bucket].length === 0);

    // Same right-click quick-pick menu the rendered reminder pill offers (see TaskLineRenderer.ts) - kept in
    // sync by construction, since both just build a ReminderMenu from the task.
    function onRowContextMenu(ev: MouseEvent, task: Task) {
        showMenu(ev, new ReminderMenu(task, taskSaver));
    }

    // The alarm-clock pill does exactly what a rendered reminder pill does on click (see onReminderPillClick):
    // the Schedule editor on desktop, the quick-pick menu on mobile.
    function onSchedulePillClick(ev: MouseEvent, task: Task) {
        onReminderPillClick(ev, ev.currentTarget as HTMLElement, task, taskSaver);
    }

    // Always two lines: a day/clock line ("today, 16:00" / "tomorrow, 16:00" / "yesterday, 16:00" / "26/10,
    // 16:00"), then the relative duration underneath (rendered with {@html} below for the <br/>) - a bare
    // "in 32 minutes"/"2 days ago" alone doesn't say which day, and a bare day/clock alone doesn't say how
    // soon, so both are always shown together rather than one or the other depending on the bucket.
    //
    // Not task.reminderDateTime?.fromNow() for the relative phrase - moment diffs against the actual current
    // instant, seconds and all, so a reminder at 13:00 checked at 12:28:35 reads as "31 minutes" (31.4,
    // rounded down) instead of the 32 a clock reading "28" to "60" actually promises. Flooring 'now' to the
    // minute first removes that elapsed-seconds fraction - the same fix already applied to the
    // reminder-suggestion labels, see ReminderSuggestions.ts's own doc comment on 'now' being floored before
    // diffing.
    function formatReminderTime(task: Task): string {
        const target = task.reminderDateTime;
        if (!target) {
            return '';
        }
        const now = window.moment();
        const clock = target.format('HH:mm');
        const relative = target.from(now.clone().startOf('minute'));
        let dayPrefix: string;
        if (target.isSame(now, 'day')) {
            dayPrefix = 'today';
        } else if (target.isSame(now.clone().add(1, 'day'), 'day')) {
            dayPrefix = 'tomorrow';
        } else if (target.isSame(now.clone().subtract(1, 'day'), 'day')) {
            dayPrefix = 'yesterday';
        } else {
            dayPrefix = target.format('DD/MM');
        }
        return `${dayPrefix}, ${clock}<br />${relative}`;
    }
</script>

<div class="tasks-notifications-view">
    {#if isEmpty}
        <p class="tasks-notifications-empty">No reminders set.</p>
    {:else}
        {#each NOTIFICATION_BUCKET_ORDER as bucket (bucket)}
            {#if groups[bucket].length > 0}
                <section>
                    <h3>{NOTIFICATION_BUCKET_LABELS[bucket]}</h3>
                    <ul>
                        {#each groups[bucket] as task (task.path + task.lineNumber)}
                            <li>
                                <div
                                    class="tasks-notifications-row"
                                    on:contextmenu={(ev) => onRowContextMenu(ev, task)}
                                    title="Right-click for options"
                                >
                                    <button
                                        type="button"
                                        class="tasks-notifications-open"
                                        on:click={() => onOpenTask(task)}
                                    >
                                        <span class="tasks-notifications-description" use:renderDescription={task} />
                                        <span class="tasks-notifications-time">{@html formatReminderTime(task)}</span>
                                    </button>
                                    <button
                                        type="button"
                                        class="tasks-notifications-schedule-pill"
                                        title="Open schedule"
                                        on:click={(ev) => onSchedulePillClick(ev, task)}
                                    >
                                        ⏰
                                    </button>
                                </div>
                            </li>
                        {/each}
                    </ul>
                </section>
            {/if}
        {/each}
    {/if}
</div>

<style>
</style>
