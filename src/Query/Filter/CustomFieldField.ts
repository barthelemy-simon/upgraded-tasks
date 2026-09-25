import {
    type CustomFieldDefinition,
    customFieldNoteTarget,
    findCustomFieldDefinition,
    getCustomFieldDefinitions,
} from '../../CustomFields/CustomFieldDefinition';
import type { Task } from '../../Task/Task';
import { Explanation } from '../Explain/Explanation';
import { Grouper, type GrouperFunction } from '../Group/Grouper';
import type { Comparator, Sorter } from '../Sort/Sorter';
import { Field } from './Field';
import { Filter } from './Filter';
import { FilterOrErrorMessage } from './FilterOrErrorMessage';
import { TextField } from './TextField';

/**
 * The search instructions for one custom field (fork roadmap item 5), named by its key.
 * Created by {@link CustomFieldField} once it has read the key from the instruction line.
 */
class SingleCustomFieldField extends TextField {
    constructor(private readonly definition: CustomFieldDefinition) {
        super();
    }

    public fieldName(): string {
        return `field ${this.definition.key}`;
    }

    /**
     * The text that filters match against. For a note link, that's the link as written followed by the
     * path of the note it points to, so that `includes Projects/Website` matches `[[Website]]` too.
     */
    public value(task: Task): string {
        const value = this.rawValue(task);
        if (value === '' || this.definition.type !== 'noteLink') {
            return value;
        }
        const target = customFieldNoteTarget(value, task.path);
        return target.path === null ? value : `${value}\n${target.path}`;
    }

    private rawValue(task: Task): string {
        return task.customFields[this.definition.key] ?? '';
    }

    public supportsSorting(): boolean {
        return true;
    }

    /**
     * Tasks with a value come first, as for the built-in date fields, then by value: for a note link, by
     * the name of the note it points to, then its path.
     */
    public comparator(): Comparator {
        return (a: Task, b: Task) => {
            const valueA = this.rawValue(a);
            const valueB = this.rawValue(b);
            if (valueA !== '' && valueB === '') {
                return -1;
            }
            if (valueA === '' && valueB !== '') {
                return 1;
            }
            if (this.definition.type === 'noteLink' && valueA !== '') {
                const targetA = customFieldNoteTarget(valueA, a.path);
                const targetB = customFieldNoteTarget(valueB, b.path);
                return compareText(targetA.name, targetB.name) || compareText(targetA.linkpath, targetB.linkpath);
            }
            return compareText(valueA, valueB);
        };
    }

    public supportsGrouping(): boolean {
        return true;
    }

    /**
     * One group per value. For a note link, one group per note it points to, however the link is written
     * (short or full path, with an alias or a heading); the heading is a link to that note, showing its
     * name. Tasks without a value go in a last group, 'No <field name>'.
     *
     * The hidden %%...%% prefix sorts the groups: note links by note name, and the empty group last.
     */
    public grouper(): GrouperFunction {
        return (task: Task) => {
            const value = this.rawValue(task);
            if (value === '') {
                return [`%%2%%No ${this.definition.label}`];
            }
            if (this.definition.type !== 'noteLink') {
                return [`%%1%%${value}`];
            }
            const { linkpath, name } = customFieldNoteTarget(value, task.path);
            const link = linkpath === name ? `[[${linkpath}]]` : `[[${linkpath}|${name}]]`;
            return [`%%1 ${name}%%${link}`];
        };
    }
}

function compareText(a: string, b: string) {
    return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * CustomFieldField supports these instructions for every user-defined field, where `<key>` is the field's
 * key (see Settings > Custom fields):
 *
 * - `has field <key>` / `no field <key>`
 * - `field <key> (includes|does not include|regex matches|regex does not match) <text>`
 * - `sort by field <key> (reverse)`
 * - `group by field <key> (reverse)`
 *
 * The key is part of the instruction, rather than each field being its own instruction name like
 * `project includes`, so a custom field can never clash with a built-in instruction such as `status` or
 * `path`.
 */
export class CustomFieldField extends Field {
    private static readonly keyPattern = '([A-Za-z][A-Za-z0-9_-]*)';

    private static readonly presenceRegExp = new RegExp(`^(has|no) field ${CustomFieldField.keyPattern}$`, 'i');
    private static readonly textFilterRegExp = new RegExp(`^field ${CustomFieldField.keyPattern} `, 'i');
    private static readonly sortRegExp = new RegExp(`^sort by field ${CustomFieldField.keyPattern}( reverse)?$`, 'i');
    private static readonly groupRegExp = new RegExp(`^group by field ${CustomFieldField.keyPattern}( reverse)?$`, 'i');

    public fieldName(): string {
        return 'field';
    }

    protected filterRegExp(): RegExp | null {
        return null;
    }

    public canCreateFilterForLine(line: string): boolean {
        return CustomFieldField.presenceRegExp.test(line) || CustomFieldField.textFilterRegExp.test(line);
    }

    public createFilterOrErrorMessage(line: string): FilterOrErrorMessage {
        const presenceMatch = line.match(CustomFieldField.presenceRegExp);
        const key = presenceMatch?.[2] ?? line.match(CustomFieldField.textFilterRegExp)?.[1] ?? '';
        const definition = findCustomFieldDefinition(key);
        if (definition === undefined) {
            return FilterOrErrorMessage.fromError(line, CustomFieldField.unknownKeyMessage(key));
        }

        if (presenceMatch) {
            const wantsValue = presenceMatch[1].toLowerCase() === 'has';
            const explanation = new Explanation(
                `${definition.label} (field ${definition.key}) ${wantsValue ? 'is set' : 'is not set'}`,
            );
            const filterFunction = (task: Task) => (task.customFields[definition.key] !== undefined) === wantsValue;
            return FilterOrErrorMessage.fromFilter(new Filter(line, filterFunction, explanation));
        }

        const field = new SingleCustomFieldField(definition);
        if (!field.canCreateFilterForLine(line)) {
            return FilterOrErrorMessage.fromError(
                line,
                `do not understand query filter (field ${definition.key}): use 'includes', 'does not include', ` +
                    "'regex matches' or 'regex does not match'",
            );
        }
        return field.createFilterOrErrorMessage(line);
    }

    public supportsSorting(): boolean {
        return true;
    }

    public createSorterFromLine(line: string): Sorter | null {
        const match = line.match(CustomFieldField.sortRegExp);
        if (match === null) {
            return null;
        }
        const definition = findCustomFieldDefinition(match[1]);
        if (definition === undefined) {
            // Gives the usual 'do not understand query' error.
            return null;
        }
        return new SingleCustomFieldField(definition).createSorter(!!match[2]);
    }

    public supportsGrouping(): boolean {
        return true;
    }

    public createGrouperFromLine(line: string): Grouper | null {
        const match = line.match(CustomFieldField.groupRegExp);
        if (match === null) {
            return null;
        }
        const definition = findCustomFieldDefinition(match[1]);
        if (definition === undefined) {
            // A single group whose heading explains the problem, which says more than the usual
            // 'do not understand query' error would.
            const heading = CustomFieldField.unknownKeyMessage(match[1]);
            return new Grouper(line, 'field', () => [heading], !!match[2]);
        }
        return new SingleCustomFieldField(definition).createGrouper(!!match[2]);
    }

    private static unknownKeyMessage(key: string) {
        const keys = getCustomFieldDefinitions().map((definition) => definition.key);
        const known =
            keys.length === 0 ? 'No custom fields are defined yet' : `The custom fields are: ${keys.join(', ')}`;
        return `There is no custom field with the key '${key}'. ${known} (see Settings > Custom fields).`;
    }
}
