import { TaskRegularExpressions } from '../Task/TaskRegularExpressions';
import { DEFAULT_SYMBOLS, allTaskPluginEmojis } from '../TaskSerializer/DefaultTaskSerializer';
import type { CustomFieldDefinition } from './CustomFieldDefinition';

/**
 * Field names the Dataview format already uses for Tasks' built-in fields, so a custom field can't take
 * them as its key.
 */
const reservedKeys = [
    'priority',
    'start',
    'created',
    'scheduled',
    'due',
    'completion',
    'cancelled',
    'reminder',
    'repeat',
    'oncompletion',
    'id',
    'dependson',
];

/**
 * Every signifier the emoji format reads for a built-in field, including the alternative spellings its
 * parser accepts but never writes.
 */
export function builtInFieldSymbols(): string[] {
    const alternatives = ['⌛', '📆', '🗓'];
    return [...allTaskPluginEmojis(), ...alternatives].filter(
        (symbol) => symbol !== DEFAULT_SYMBOLS.prioritySymbols.None,
    );
}

const keyRegex = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Check a field definition against the rules the serializers rely on.
 *
 * @param definition - the definition being added or edited
 * @param others - every other existing definition (not including the one being edited)
 * @returns an error message to show the user, or null if the definition is valid
 */
export function validateCustomFieldDefinition(
    definition: CustomFieldDefinition,
    others: readonly CustomFieldDefinition[],
): string | null {
    const key = definition.key.trim();
    if (key === '') {
        return 'The key cannot be empty.';
    }
    if (!keyRegex.test(key)) {
        return 'The key must start with a letter, and contain only letters, digits, "-" and "_".';
    }
    if (reservedKeys.includes(key.toLowerCase())) {
        return `"${key}" is already used by a built-in Tasks field. Please choose another key.`;
    }
    if (others.some((other) => other.key.toLowerCase() === key.toLowerCase())) {
        return `Another custom field already uses the key "${key}".`;
    }

    if (definition.label.trim() === '') {
        return 'The name cannot be empty.';
    }

    const symbol = definition.symbol.trim();
    if (symbol === '') {
        return 'The symbol cannot be empty.';
    }
    if (/[\s[\]()#^]/.test(symbol)) {
        return 'The symbol cannot contain spaces, brackets, "#" or "^".';
    }
    const clashes = (a: string, b: string) => a.includes(b) || b.includes(a);
    const builtInClash = builtInFieldSymbols().find((builtIn) => clashes(symbol, builtIn));
    if (builtInClash !== undefined) {
        return `The symbol clashes with the built-in Tasks symbol ${builtInClash}.`;
    }
    const customClash = others.find((other) => other.symbol !== '' && clashes(symbol, other.symbol));
    if (customClash !== undefined) {
        return `The symbol clashes with the symbol of the custom field "${customClash.label}".`;
    }

    return null;
}

/**
 * Check a value, in the form stored on the task line (see `customFieldValueForStoring()`), can be written
 * to a task and read back unchanged in the given task format.
 *
 * @param definition - the field the value is for
 * @param value - the value to check
 * @param allDefinitions - all the custom field definitions, whose symbols a text value must not contain
 * @param dataviewFormat - true if the vault uses the Dataview task format
 * @returns an error message to show the user, or null if the value is valid
 */
export function validateCustomFieldValue(
    definition: CustomFieldDefinition,
    value: string,
    allDefinitions: readonly CustomFieldDefinition[],
    dataviewFormat: boolean,
): string | null {
    if (/[\r\n]/.test(value)) {
        return 'The value cannot contain a line break.';
    }

    if (definition.type === 'noteLink') {
        if (!/^\[\[[^[\]]+\]\]$/.test(value)) {
            return 'The note name cannot contain "[" or "]".';
        }
        return null;
    }

    if (dataviewFormat) {
        if (/[[\]()]/.test(value)) {
            return 'In the Dataview format, the value cannot contain brackets or parentheses.';
        }
        return null;
    }

    const symbols = [...builtInFieldSymbols(), ...allDefinitions.map((other) => other.symbol)];
    const symbol = symbols.find((s) => s !== '' && value.includes(s));
    if (symbol !== undefined) {
        return `The value cannot contain the field symbol ${symbol}.`;
    }
    if (TaskRegularExpressions.hashTagsFromEnd.test(value)) {
        return 'The value cannot end with a tag: it would be read as a tag of the task.';
    }
    return null;
}
