/**
 * User-defined task fields (fork roadmap item 5).
 *
 * This module deliberately imports nothing: the task serializers read the current definitions from
 * {@link getCustomFieldDefinitions}, and `Settings.ts` pushes them in via {@link setCustomFieldDefinitions}.
 * Having the serializers import `Settings.ts` directly would create an import cycle, since `Settings.ts`
 * constructs the serializers at module load time.
 */

/**
 * - `text`: any single-line text.
 * - `noteLink`: a wikilink to another note, written `[[Note name]]` on the task line.
 */
export type CustomFieldType = 'text' | 'noteLink';

export interface CustomFieldDefinition {
    /**
     * Identifies the field: in queries (`group by field project`), in the Dataview format
     * (`[project:: [[Note]]]`), and in scripting (`task.customFields.project`).
     */
    key: string;
    /** Human-readable name, shown in the edit modal, auto-suggest and group headings. */
    label: string;
    /** The signifier written before the value in the Tasks emoji format, e.g. '📁'. */
    symbol: string;
    type: CustomFieldType;
    /**
     * Name of a property in the note's frontmatter whose value becomes this field's default when a new task
     * is created in that note, or '' for no default.
     */
    defaultFromProperty: string;
}

/**
 * A task's custom field values, keyed by {@link CustomFieldDefinition.key}. A field with no value is absent,
 * never an empty string. Values are stored exactly as written in the note, so a note link includes its
 * brackets: `{ project: '[[Website redesign]]' }`.
 */
export type CustomFieldValues = Readonly<Record<string, string>>;

let definitions: readonly CustomFieldDefinition[] = [];

/**
 * Called by `Settings.ts` whenever settings change, so that the definitions seen here always match
 * `getSettings().customFields`. Anything else should change the settings instead.
 */
export function setCustomFieldDefinitions(newDefinitions: readonly CustomFieldDefinition[] | undefined) {
    definitions = newDefinitions ?? [];
}

/**
 * The fields the user has defined, in the order they are written to a task line.
 */
export function getCustomFieldDefinitions(): readonly CustomFieldDefinition[] {
    return definitions;
}

export function findCustomFieldDefinition(key: string): CustomFieldDefinition | undefined {
    const lowerKey = key.toLowerCase();
    return definitions.find((definition) => definition.key.toLowerCase() === lowerKey);
}

const wikilinkRegex = /^\[\[([^[\]]+)\]\]$/;

/**
 * Turns a note name or path typed by the user into the link text to write inside `[[...]]`, following
 * Obsidian's "New link format" setting. See `ObsidianNoteLinks.ts`, which `main.ts` installs here via
 * {@link setNoteLinkResolver}. Until then (and in tests) the typed text is kept as it is.
 */
export type NoteLinkResolver = (linkpath: string, sourcePath: string) => string;

let noteLinkResolver: NoteLinkResolver = (linkpath) => linkpath;

export function setNoteLinkResolver(resolver: NoteLinkResolver) {
    noteLinkResolver = resolver;
}

/**
 * Finds the path of the note a link points to (e.g. 'Projects/Website.md'), or null if it matches no note,
 * as Obsidian would when the link is clicked. `main.ts` installs the real one via
 * {@link setNoteLinkTargetResolver}; until then (and in tests) no link resolves.
 */
export type NoteLinkTargetResolver = (linkpath: string, sourcePath: string) => string | null;

let noteLinkTargetResolver: NoteLinkTargetResolver = () => null;

export function setNoteLinkTargetResolver(resolver: NoteLinkTargetResolver) {
    noteLinkTargetResolver = resolver;
}

/**
 * The note a note-link value points to, so that different ways of writing a link to the same note
 * (`[[Website]]`, `[[Projects/Website]]`, `[[Projects/Website|the site]]`, `[[Website#Plan]]`) compare
 * as equal in queries.
 *
 * @returns
 *  - `linkpath`: what to link to, the same for every link to the same note: the note's path without
 *    '.md', or, for a note that doesn't exist, the note name as written, without heading or alias.
 *  - `name`: the note's name, without folders.
 *  - `path`: the note's path, or null if no note matches.
 */
export function customFieldNoteTarget(
    value: string,
    sourcePath: string,
): { linkpath: string; name: string; path: string | null } {
    const linkText = value.match(wikilinkRegex)?.[1] ?? value;
    const writtenLinkpath = linkText.split(/[#|]/)[0].trim();
    const path = writtenLinkpath === '' ? null : noteLinkTargetResolver(writtenLinkpath, sourcePath);
    const linkpath = path === null ? writtenLinkpath : path.replace(/\.md$/, '');
    const name = linkpath.split('/').pop() ?? linkpath;
    return { linkpath, name, path };
}

/**
 * The note's name at the end of a link path: 'Projects/Website' gives 'Website'.
 */
function noteNameOf(linkpath: string) {
    return linkpath.split('/').pop() ?? linkpath;
}

/**
 * What the edit modal shows for a stored value: a note link without its brackets, and without an alias
 * that is just the note's name (see {@link customFieldValueForStoring}, which adds it back). Text is
 * unchanged.
 */
export function customFieldValueForEditing(definition: CustomFieldDefinition, storedValue: string): string {
    if (definition.type === 'noteLink') {
        const match = storedValue.match(wikilinkRegex);
        if (match) {
            const [linkpathAndHeading, alias] = match[1].split('|');
            const linkpath = linkpathAndHeading.split('#')[0].trim();
            return alias !== undefined && alias.trim() === noteNameOf(linkpath) ? linkpathAndHeading : match[1];
        }
    }
    return storedValue;
}

/**
 * Turn a value typed by the user (or read from a property) into the form stored on the task line.
 * Returns null for an empty value. The result still needs checking with `validateCustomFieldValue()`.
 *
 * @param sourcePath - the path of the note the task is in. If given, a note link is rewritten in the
 *                     user's "New link format" (see {@link NoteLinkResolver}), keeping any `#heading` or
 *                     `|alias` after the note name. When that gives a path, and there is no alias, the
 *                     note's name is added as the alias, as Obsidian does for a new link:
 *                     `[[Projects/Website|Website]]`. If omitted, the link text is kept as typed.
 */
export function customFieldValueForStoring(
    definition: CustomFieldDefinition,
    typedValue: string,
    sourcePath?: string,
): string | null {
    const value = typedValue.trim();
    if (value === '') {
        return null;
    }
    if (definition.type !== 'noteLink') {
        return value;
    }

    const linkText = value.match(wikilinkRegex)?.[1] ?? value;
    if (sourcePath === undefined) {
        return `[[${linkText}]]`;
    }
    const [, linkpath, rest] = linkText.match(/^([^#|]*)(.*)$/) ?? ['', linkText, ''];
    const resolved = linkpath.trim() === '' ? linkpath : noteLinkResolver(linkpath.trim(), sourcePath);
    const alias = resolved.includes('/') && !rest.includes('|') ? `|${noteNameOf(resolved)}` : '';
    return `[[${resolved}${rest}${alias}]]`;
}

/**
 * The value for {@link CustomFieldDefinition.defaultFromProperty} in a note's frontmatter, as stored,
 * or null if the field has no default, the note lacks the property, or the property is empty.
 *
 * A list property contributes its first item. The property name is matched case-insensitively, as
 * Obsidian does for property names. A note link is kept as the property writes it.
 */
export function customFieldDefaultFromFrontmatter(
    definition: CustomFieldDefinition,
    frontmatter: Readonly<Record<string, unknown>> | undefined | null,
): string | null {
    const propertyName = definition.defaultFromProperty.trim();
    if (propertyName === '' || !frontmatter) {
        return null;
    }

    const lowerName = propertyName.toLowerCase();
    const actualName = Object.keys(frontmatter).find((name) => name.toLowerCase() === lowerName);
    if (actualName === undefined) {
        return null;
    }

    let rawValue = frontmatter[actualName];
    if (Array.isArray(rawValue)) {
        rawValue = rawValue[0];
    }
    if (rawValue === null || rawValue === undefined || typeof rawValue === 'object') {
        return null;
    }

    // Single-line values only, as for a value on a task line.
    const text = String(rawValue).replace(/[\r\n]+/g, ' ');
    return customFieldValueForStoring(definition, text);
}

/**
 * Add the fields a task inherits from its note (fork roadmap item 5): every field with a
 * {@link CustomFieldDefinition.defaultFromProperty} that the task doesn't set itself takes that property's
 * value from {@link frontmatter}.
 *
 * Like a scheduled date taken from the file name (see `Task.scheduledDateIsInferred`), an inherited value
 * counts everywhere - queries, grouping, display - but is never written to the task line, so changing the
 * note's property changes all its tasks at once.
 *
 * @param explicitValues - the values written on the task line
 * @returns all the values, and the keys of the inherited ones
 */
export function inferCustomFieldValues(
    explicitValues: CustomFieldValues,
    frontmatter: Readonly<Record<string, unknown>> | undefined | null,
): { customFields: CustomFieldValues; inferredCustomFieldKeys: string[] } {
    const customFields: Record<string, string> = { ...explicitValues };
    const inferredCustomFieldKeys: string[] = [];
    for (const definition of definitions) {
        if (customFields[definition.key] !== undefined) {
            continue;
        }
        const defaultValue = customFieldDefaultFromFrontmatter(definition, frontmatter);
        if (defaultValue !== null) {
            customFields[definition.key] = defaultValue;
            inferredCustomFieldKeys.push(definition.key);
        }
    }
    return { customFields, inferredCustomFieldKeys };
}

/**
 * The only values of {@link values} written on the task line: those not in {@link inferredKeys}.
 */
export function explicitCustomFieldValues(
    values: CustomFieldValues,
    inferredKeys: readonly string[],
): CustomFieldValues {
    return Object.fromEntries(Object.entries(values).filter(([key]) => !inferredKeys.includes(key)));
}

/**
 * The access keys (Alt+key) the edit modal's own fields use. Keep in step with the table in
 * `EditTask.svelte`, and with `PriorityEditor.svelte`.
 */
export const builtInEditModalAccessKeys = [
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
    'h',
    'i',
    'l',
    'm',
    'n',
    'o',
    'r',
    's',
    't',
    'u',
    'x',
    '-',
];

/**
 * Give each custom field an access key for the edit modal, in settings order, never one already taken:
 * the first free letter of its name, else of its key, else any free letter, else a digit. A field gets
 * null once none is left.
 */
export function assignCustomFieldAccessKeys(
    fieldDefinitions: readonly CustomFieldDefinition[],
    takenKeys: readonly string[] = builtInEditModalAccessKeys,
): Record<string, string | null> {
    const taken = new Set(takenKeys);
    const fallback = [...'abcdefghijklmnopqrstuvwxyz', ...'123456789'];
    const result: Record<string, string | null> = {};
    for (const definition of fieldDefinitions) {
        const candidates = [...definition.label.toLowerCase(), ...definition.key.toLowerCase(), ...fallback];
        const accessKey = candidates.find((c) => /^[a-z0-9]$/.test(c) && !taken.has(c)) ?? null;
        if (accessKey !== null) {
            taken.add(accessKey);
        }
        result[definition.key] = accessKey;
    }
    return result;
}

export function customFieldValuesIdentical(a: CustomFieldValues, b: CustomFieldValues): boolean {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) {
        return false;
    }
    return aKeys.every((key) => a[key] === b[key]);
}
