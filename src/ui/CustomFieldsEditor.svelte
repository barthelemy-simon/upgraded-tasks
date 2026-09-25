<script lang="ts">
    import { getSettings } from '../Config/Settings';
    import {
        type CustomFieldDefinition,
        assignCustomFieldAccessKeys,
        customFieldNoteTarget,
        customFieldValueForEditing,
        customFieldValueForStoring,
        getCustomFieldDefinitions,
    } from '../CustomFields/CustomFieldDefinition';
    import { validateCustomFieldValue } from '../CustomFields/CustomFieldValidation';
    import type { Task } from '../Task/Task';
    import type { EditableTask } from './EditableTask';
    import { labelContentWithAccessKey } from './EditTaskHelpers';
    import NoteLinkInput from './NoteLinkInput.svelte';
    import { type NoteChoice, noteChoiceInputValue, noteChoicesFor } from '../CustomFields/NoteChoices';

    /**
     * One text input per custom field (fork roadmap item 5), in the edit modal. A note-link field is typed
     * without its brackets, and offers the vault's notes (NoteLinkInput.svelte); a text field offers the
     * values already used on other tasks. A value the task inherits from its note is shown as the placeholder, and stays
     * inherited while the input is left empty.
     *
     * Each field gets a free access key (Alt+key), unless access keys are turned off.
     */
    export let task: Task;
    export let editableTask: EditableTask;
    export let allTasks: Task[];
    export let getNotePaths: () => string[];
    export let isCustomFieldsValid: boolean;
    export let withAccessKeys: boolean;

    const definitions = getCustomFieldDefinitions();
    const dataviewFormat = getSettings().taskFormat === 'dataview';
    const accessKeys = assignCustomFieldAccessKeys(definitions);
    $: accesskey = (key: string) => (withAccessKeys ? accessKeys[key] : null);

    function placeholderFor(definition: CustomFieldDefinition) {
        if (task.inferredCustomFieldKeys.includes(definition.key)) {
            const value = task.customFields[definition.key];
            const inherited =
                definition.type === 'noteLink'
                    ? customFieldNoteTarget(value, task.path).name
                    : customFieldValueForEditing(definition, value);
            return `${inherited} (from note)`;
        }
        return definition.type === 'noteLink' ? 'Note name' : '';
    }

    /**
     * The label, with its access key underlined. The name is the user's own text, so a name with HTML
     * characters is escaped, and the key shown after it rather than inside it.
     */
    function labelHtml(definition: CustomFieldDefinition, key: string | null) {
        if (!/[&<>"]/.test(definition.label)) {
            return labelContentWithAccessKey(definition.label, key);
        }
        const escaped = definition.label
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        return key === null ? escaped : `${escaped} (<span class="accesskey">${key}</span>)`;
    }

    // A text field's suggestions: the values used on other tasks, built once when the modal opens.
    const textSuggestions: Record<string, string[]> = {};
    for (const definition of definitions.filter((d) => d.type === 'text')) {
        const usedValues = allTasks
            .map((task) => task.customFields[definition.key])
            .filter((value): value is string => value !== undefined);
        textSuggestions[definition.key] = [...new Set(usedValues)];
    }

    // A note-link field's suggestions: each note once, the note it inherits first - see NoteChoices.ts.
    const notePaths = definitions.some((d) => d.type === 'noteLink') ? getNotePaths() : [];
    function noteChoices(definition: CustomFieldDefinition) {
        const inherited = task.inferredCustomFieldKeys.includes(definition.key)
            ? [task.customFields[definition.key]]
            : [];
        return (typedText: string) => noteChoicesFor(definition, allTasks, notePaths, typedText, 20, inherited);
    }
    const inputValueFor = (choice: NoteChoice) => noteChoiceInputValue(choice, notePaths);

    function errorFor(definition: CustomFieldDefinition, typedValue: string): string | null {
        const value = customFieldValueForStoring(definition, typedValue);
        return value === null ? null : validateCustomFieldValue(definition, value, definitions, dataviewFormat);
    }

    $: errors = Object.fromEntries(
        definitions.map((definition) => [
            definition.key,
            errorFor(definition, editableTask.customFields[definition.key] ?? ''),
        ]),
    );
    $: isCustomFieldsValid = Object.values(errors).every((error) => error === null);
</script>

{#each definitions as definition (definition.key)}
    {@const id = `custom-field-${definition.key}`}
    <label for={id}>{@html labelHtml(definition, accesskey(definition.key))}</label>
    {#if definition.type === 'noteLink'}
        <NoteLinkInput
            {id}
            bind:value={editableTask.customFields[definition.key]}
            placeholder={placeholderFor(definition)}
            accesskey={accesskey(definition.key)}
            hasError={errors[definition.key] !== null}
            choicesFor={noteChoices(definition)}
            {inputValueFor}
        />
    {:else}
        <!-- svelte-ignore a11y-accesskey -->
        <input
            bind:value={editableTask.customFields[definition.key]}
            {id}
            type="text"
            class:tasks-modal-error={errors[definition.key] !== null}
            class="tasks-modal-date-input"
            placeholder={placeholderFor(definition)}
            accesskey={accesskey(definition.key)}
            list={`${id}-suggestions`}
            autocomplete="off"
        />
        <datalist id={`${id}-suggestions`}>
            {#each textSuggestions[definition.key] as suggestion}
                <option value={suggestion} />
            {/each}
        </datalist>
    {/if}
    <code class="tasks-modal-parsed-date">
        {definition.symbol}
        {#if errors[definition.key] !== null}
            <i>{errors[definition.key]}</i>
        {/if}
    </code>
{/each}
