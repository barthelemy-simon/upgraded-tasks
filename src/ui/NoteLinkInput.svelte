<script lang="ts">
    import { computePosition, flip, offset, shift, size } from '@floating-ui/dom';
    import type { NoteChoice } from '../CustomFields/NoteChoices';

    /**
     * A text input for a note-link custom field, with a dropdown of matching notes: each note once, its
     * name in bold with its folder below. Positioned like Dependency.svelte's dropdown.
     */
    export let id: string;
    export let value: string;
    export let placeholder: string;
    export let accesskey: string | null;
    export let hasError: boolean;
    export let choicesFor: (typedText: string) => NoteChoice[];
    export let inputValueFor: (choice: NoteChoice) => string;

    let input: HTMLInputElement;
    let dropdown: HTMLElement;
    let inputWidth: number;
    let focused = false;
    let selectedIndex: number | null = null;

    $: choices = focused ? choicesFor(value ?? '') : [];
    $: positionDropdown(input, dropdown, choices);

    function choose(choice: NoteChoice) {
        value = inputValueFor(choice);
        focused = false;
        selectedIndex = null;
    }

    function onKeydown(e: KeyboardEvent) {
        if (choices.length === 0) {
            return;
        }
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedIndex = selectedIndex === null || selectedIndex >= choices.length - 1 ? 0 : selectedIndex + 1;
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectedIndex = selectedIndex === null || selectedIndex <= 0 ? choices.length - 1 : selectedIndex - 1;
                break;
            case 'Enter':
                // Only when a note is highlighted: otherwise Enter submits the modal, as in the other inputs.
                if (selectedIndex !== null && !e.isComposing) {
                    e.preventDefault();
                    choose(choices[selectedIndex]);
                }
                return;
            default:
                selectedIndex = null;
                return;
        }
        dropdown?.getElementsByTagName('li')[selectedIndex ?? 0]?.scrollIntoView({ block: 'nearest' });
    }

    function positionDropdown(input: HTMLElement, dropdown: HTMLElement, _choices: NoteChoice[]) {
        if (!input || !dropdown) return;

        computePosition(input, dropdown, {
            middleware: [
                offset(6),
                shift(),
                flip(),
                size({
                    apply() {
                        dropdown && Object.assign(dropdown.style, { width: `${inputWidth}px` });
                    },
                }),
            ],
        }).then(({ x, y }) => {
            dropdown.style.left = `${x}px`;
            dropdown.style.top = `${y}px`;
        });
    }
</script>

<span bind:clientWidth={inputWidth}>
    <!-- svelte-ignore a11y-accesskey -->
    <input
        bind:this={input}
        bind:value
        {id}
        type="text"
        class:tasks-modal-error={hasError}
        class="tasks-modal-date-input"
        {placeholder}
        {accesskey}
        autocomplete="off"
        on:focus={() => (focused = true)}
        on:blur={() => (focused = false)}
        on:keydown={onKeydown}
    />
</span>
{#if choices.length > 0}
    <ul class="task-dependency-dropdown tasks-note-choice-dropdown" bind:this={dropdown}>
        {#each choices as choice, index}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <li
                class:selected={index === selectedIndex}
                on:mousedown|preventDefault={() => choose(choice)}
                on:mouseenter={() => (selectedIndex = index)}
            >
                <div class="tasks-note-choice-name">{choice.name}</div>
                {#if choice.folder !== ''}
                    <div class="tasks-note-choice-folder">{choice.folder}</div>
                {/if}
            </li>
        {/each}
    </ul>
{/if}
