/**
 * @jest-environment jsdom
 */
import moment from 'moment';
import { getSettings, resetSettings, updateSettings } from '../../src/Config/Settings';
import { DEFAULT_MAX_GENERIC_SUGGESTIONS, makeDefaultSuggestionBuilder } from '../../src/Suggestor/Suggestor';
import { DEFAULT_SYMBOLS } from '../../src/TaskSerializer/DefaultTaskSerializer';
import { DATAVIEW_SYMBOLS } from '../../src/TaskSerializer/DataviewTaskSerializer';
import {
    type CustomFieldDefinition,
    assignCustomFieldAccessKeys,
    customFieldDefaultFromFrontmatter,
    customFieldValueForEditing,
    customFieldValueForStoring,
    setNoteLinkResolver,
    setNoteLinkTargetResolver,
} from '../../src/CustomFields/CustomFieldDefinition';
import { validateCustomFieldDefinition, validateCustomFieldValue } from '../../src/CustomFields/CustomFieldValidation';
import { taskFromLineWithInferredCustomFields } from '../../src/Commands/CreateOrEditTaskParser';
import { relativeLinkPath } from '../../src/CustomFields/ObsidianNoteLinks';
import { TaskLocation } from '../../src/Task/TaskLocation';
import { TaskLayoutOptions, parseTaskShowHideOptions } from '../../src/Layout/TaskLayoutOptions';
import { Query } from '../../src/Query/Query';
import { SearchInfo } from '../../src/Query/SearchInfo';
import { noteChoiceInputValue, noteChoicesFor } from '../../src/CustomFields/NoteChoices';
import { createTestTasksFile } from '../TestingTools/TasksFileHelpers';
import { CustomFieldField } from '../../src/Query/Filter/CustomFieldField';
import { parseFilter, parseGrouper, parseSorter } from '../../src/Query/FilterParser';
import { customFieldAttributeValue } from '../../src/Renderer/TaskLineRenderer';
import { Priority } from '../../src/Task/Priority';
import { Task } from '../../src/Task/Task';
import { EditableTask } from '../../src/ui/EditableTask';
import { fromLine } from '../TestingTools/TestHelpers';
import { testTaskFilter } from '../TestingTools/FilterTestHelpers';
import { expectTaskComparesBefore } from '../CustomMatchers/CustomMatchersForSorting';

window.moment = moment;

const project: CustomFieldDefinition = {
    key: 'project',
    label: 'Project',
    symbol: '📁',
    type: 'noteLink',
    defaultFromProperty: 'project',
};

const client: CustomFieldDefinition = {
    key: 'client',
    label: 'Client',
    symbol: '👤',
    type: 'text',
    defaultFromProperty: '',
};

function task(body: string) {
    return fromLine({ line: `- [ ] ${body}` });
}

beforeEach(() => {
    updateSettings({ customFields: [project, client] });
});

afterEach(() => {
    resetSettings();
});

describe('custom fields - emoji format', () => {
    it('reads a note link and a text field', () => {
        const t = task('Write report 📁 [[Website redesign]] 👤 Acme Corp 📅 2026-10-01');

        expect(t.description).toEqual('Write report');
        expect(t.customFields).toEqual({ project: '[[Website redesign]]', client: 'Acme Corp' });
        expect(t.dueDate?.format('YYYY-MM-DD')).toEqual('2026-10-01');
    });

    it('reads fields in any order among the built-in fields and tags', () => {
        const t = task('Write report #work 👤 Acme 🔼 📅 2026-10-01 📁 [[Website]] #urgent');

        expect(t.customFields).toEqual({ project: '[[Website]]', client: 'Acme' });
        expect(t.priority).toEqual(Priority.Medium);
        expect(t.tags).toEqual(['#work', '#urgent']);
        expect(t.description).toEqual('Write report #work #urgent');
    });

    it('writes custom fields straight after the description, in settings order', () => {
        const t = task('Write report 📅 2026-10-01 👤 Acme 📁 [[Website]]');

        expect(t.toFileLineString()).toEqual('- [ ] Write report 📁 [[Website]] 👤 Acme 📅 2026-10-01');
    });

    it('round-trips a task line unchanged', () => {
        const line = '- [ ] Write report #work 📁 [[Website redesign]] 👤 Acme Corp 🔼 📅 2026-10-01';
        expect(fromLine({ line }).toFileLineString()).toEqual(line);
    });

    it('leaves a note-link field in the description if its value is not a link', () => {
        const t = task('Write report 📁 Website');

        expect(t.customFields).toEqual({});
        expect(t.description).toEqual('Write report 📁 Website');
    });

    it('leaves the text in the description when no field is defined for its symbol', () => {
        updateSettings({ customFields: [] });
        const t = task('Write report 📁 [[Website]]');

        expect(t.customFields).toEqual({});
        expect(t.description).toEqual('Write report 📁 [[Website]]');
    });

    it('keeps custom fields on the next occurrence of a recurring task', () => {
        const t = task('Weekly review 📁 [[Admin]] 🔁 every week 📅 2026-10-01');
        const [next] = t.toggle();

        expect(next.customFields).toEqual({ project: '[[Admin]]' });
    });

    it('treats tasks with different custom field values as not identical', () => {
        expect(task('A 📁 [[X]]').identicalTo(task('A 📁 [[X]]'))).toEqual(true);
        expect(task('A 📁 [[X]]').identicalTo(task('A 📁 [[Y]]'))).toEqual(false);
        expect(task('A 📁 [[X]]').identicalTo(task('A'))).toEqual(false);
    });
});

describe('custom fields - Dataview format', () => {
    beforeEach(() => {
        updateSettings({ taskFormat: 'dataview' });
    });

    it('reads fields as inline fields named by key', () => {
        const t = task('Write report [project:: [[Website]]] (client:: Acme Corp) [due:: 2026-10-01]');

        expect(t.description).toEqual('Write report');
        expect(t.customFields).toEqual({ project: '[[Website]]', client: 'Acme Corp' });
        expect(t.dueDate?.format('YYYY-MM-DD')).toEqual('2026-10-01');
    });

    it('writes fields as inline fields', () => {
        const t = task('Write report [client:: Acme] [project:: [[Website]]]');

        expect(t.toFileLineString()).toEqual('- [ ] Write report  [project:: [[Website]]]  [client:: Acme]');
    });
});

describe('custom field definitions', () => {
    it('accepts a valid definition', () => {
        expect(validateCustomFieldDefinition(project, [client])).toBeNull();
    });

    it.each([
        [{ ...project, key: '' }, 'The key cannot be empty.'],
        [{ ...project, key: '1st' }, 'The key must start with a letter'],
        [{ ...project, key: 'due' }, 'already used by a built-in Tasks field'],
        [{ ...project, key: 'Client' }, 'Another custom field already uses the key'],
        [{ ...project, label: ' ' }, 'The name cannot be empty.'],
        [{ ...project, symbol: '' }, 'The symbol cannot be empty.'],
        [{ ...project, symbol: '[p' }, 'cannot contain spaces, brackets'],
        [{ ...project, symbol: '📅' }, 'clashes with the built-in Tasks symbol 📅'],
        [{ ...project, symbol: '👤' }, 'clashes with the symbol of the custom field "Client"'],
    ])('rejects %j', (definition, message) => {
        expect(validateCustomFieldDefinition(definition, [client])).toContain(message);
    });
});

describe('custom field values', () => {
    it('stores a typed note name as a link, and shows it without brackets', () => {
        expect(customFieldValueForStoring(project, ' Website ')).toEqual('[[Website]]');
        expect(customFieldValueForStoring(project, '[[Website]]')).toEqual('[[Website]]');
        expect(customFieldValueForStoring(project, '  ')).toBeNull();
        expect(customFieldValueForEditing(project, '[[Website]]')).toEqual('Website');
        expect(customFieldValueForStoring(client, ' Acme ')).toEqual('Acme');
    });

    it('rejects values that would not read back unchanged', () => {
        const all = [project, client];
        expect(validateCustomFieldValue(client, 'Acme', all, false)).toBeNull();
        expect(validateCustomFieldValue(client, 'Acme 📅 soon', all, false)).toContain('📅');
        expect(validateCustomFieldValue(client, 'Acme 📁', all, false)).toContain('📁');
        expect(validateCustomFieldValue(client, 'Acme #corp', all, false)).toContain('tag');
        expect(validateCustomFieldValue(client, 'Acme (UK)', all, true)).toContain('Dataview');
        expect(validateCustomFieldValue(project, '[[A]] [[B]]', all, false)).not.toBeNull();
    });

    it('makes a data attribute value from a value', () => {
        expect(customFieldAttributeValue('[[Website Redesign]]')).toEqual('website-redesign');
        expect(customFieldAttributeValue('Réunion, Paris')).toEqual('réunion-paris');
    });
});

describe('custom field defaults', () => {
    it('reads the default from a frontmatter property', () => {
        expect(customFieldDefaultFromFrontmatter(project, { project: 'Website' })).toEqual('[[Website]]');
        expect(customFieldDefaultFromFrontmatter(project, { Project: '[[Website]]' })).toEqual('[[Website]]');
        expect(customFieldDefaultFromFrontmatter(project, { project: ['[[A]]', '[[B]]'] })).toEqual('[[A]]');
        expect(customFieldDefaultFromFrontmatter(project, { project: '' })).toBeNull();
        expect(customFieldDefaultFromFrontmatter(project, { other: 'x' })).toBeNull();
        expect(customFieldDefaultFromFrontmatter(project, undefined)).toBeNull();
        expect(customFieldDefaultFromFrontmatter(client, { client: 'Acme' })).toBeNull();
    });

    const frontmatter = { project: '[[Website]]' };

    function taskInNote(body: string) {
        // The Obsidian mock only reads frontmatter from recorded sample files, so stub it here.
        const tasksFile = createTestTasksFile('Notes/a.md');
        Object.defineProperty(tasksFile, 'frontmatter', { value: frontmatter });
        return Task.fromLine({
            line: `- [ ] ${body}`,
            taskLocation: new TaskLocation(tasksFile, 0, 0, 0, null),
            fallbackDate: null,
        })!;
    }

    it("makes a task inherit the note's value, without writing it", () => {
        const t = taskInNote('Buy milk');

        expect(t.customFields).toEqual({ project: '[[Website]]' });
        expect(t.inferredCustomFieldKeys).toEqual(['project']);
        expect(t.toFileLineString()).toEqual('- [ ] Buy milk');
    });

    it('lets a value on the task line win over the note', () => {
        const t = taskInNote('Buy milk 📁 [[Other]]');

        expect(t.customFields).toEqual({ project: '[[Other]]' });
        expect(t.inferredCustomFieldKeys).toEqual([]);
        expect(t.toFileLineString()).toEqual('- [ ] Buy milk 📁 [[Other]]');
    });

    it('counts an inherited value in queries', () => {
        testTaskFilter(parseFilter('field project includes Website')!, taskInNote('Buy milk'), true);
    });

    it('treats a task whose inherited value became explicit as changed', () => {
        expect(taskInNote('A').identicalTo(taskInNote('A 📁 [[Website]]'))).toEqual(false);
    });

    it('infers values for the modal command, which has no metadata of its own', () => {
        const t = taskFromLineWithInferredCustomFields({ line: '- [ ] Buy milk', path: 'a.md', frontmatter });
        expect(t.customFields).toEqual({ project: '[[Website]]' });
        expect(t.inferredCustomFieldKeys).toEqual(['project']);
    });

    it('keeps an inherited value when the modal leaves the field empty', async () => {
        const t = taskInNote('Buy milk');
        const editable = EditableTask.fromTask(t, [t]);
        expect(editable.customFields.project).toEqual('');

        const [edited] = await editable.applyEdits(t, [t]);
        expect(edited.inferredCustomFieldKeys).toEqual(['project']);
        expect(edited.toFileLineString()).toEqual('- [ ] Buy milk');
    });

    it('makes a value typed in the modal explicit', async () => {
        const t = taskInNote('Buy milk');
        const editable = EditableTask.fromTask(t, [t]);
        editable.customFields.project = 'Intranet';

        const [edited] = await editable.applyEdits(t, [t]);
        expect(edited.inferredCustomFieldKeys).toEqual([]);
        expect(edited.toFileLineString()).toEqual('- [ ] Buy milk 📁 [[Intranet]]');
    });
});

describe('note link format', () => {
    afterEach(() => {
        setNoteLinkResolver((linkpath) => linkpath);
    });

    it('writes a typed note name through the link resolver, keeping any heading or alias', () => {
        setNoteLinkResolver((linkpath, sourcePath) => `${sourcePath}>${linkpath}`);

        expect(customFieldValueForStoring(project, 'Website', 'a.md')).toEqual('[[a.md>Website]]');
        expect(customFieldValueForStoring(project, '[[Website#Plan|the plan]]', 'a.md')).toEqual(
            '[[a.md>Website#Plan|the plan]]',
        );
        // A path gets the note's name as its alias, unless it already has one.
        setNoteLinkResolver((linkpath) => `Projects/${linkpath}`);
        expect(customFieldValueForStoring(project, 'Website', 'a.md')).toEqual('[[Projects/Website|Website]]');
        expect(customFieldValueForStoring(project, 'Website#Plan', 'a.md')).toEqual(
            '[[Projects/Website#Plan|Website]]',
        );
        expect(customFieldValueForStoring(project, 'Website|site', 'a.md')).toEqual('[[Projects/Website|site]]');

        // No source path: kept as typed, as for a note's property value.
        expect(customFieldValueForStoring(project, 'Website')).toEqual('[[Website]]');
    });

    it('hides an alias that is just the note name in the modal', () => {
        expect(customFieldValueForEditing(project, '[[Projects/Website|Website]]')).toEqual('Projects/Website');
        expect(customFieldValueForEditing(project, '[[Projects/Website#Plan|Website]]')).toEqual(
            'Projects/Website#Plan',
        );
        expect(customFieldValueForEditing(project, '[[Projects/Website|the site]]')).toEqual(
            'Projects/Website|the site',
        );
    });

    it.each([
        ['a.md', 'Projects/Website', 'Projects/Website'],
        ['Notes/a.md', 'Projects/Website', '../Projects/Website'],
        ['Notes/a.md', 'Notes/Website', 'Website'],
        ['Notes/Deep/a.md', 'Notes/Website', '../Website'],
        ['Notes/a.md', 'Website', '../Website'],
    ])('relative link from %s to %s is %s', (source, target, expected) => {
        expect(relativeLinkPath(source, target)).toEqual(expected);
    });
});

describe('custom field access keys', () => {
    it('gives each field a free key, preferring letters of its name', () => {
        const keys = assignCustomFieldAccessKeys([
            { ...project, label: 'Project' },
            { ...client, label: 'Client' },
            { ...client, key: 'phase', label: 'Phase' },
        ]);
        // Project gets its 'p'. Client's letters are all used by built-in fields, so it gets the first free
        // letter, 'g'. Phase's letters are all taken by then, so it gets the next free one, 'j'.
        expect(keys).toEqual({ project: 'p', client: 'g', phase: 'j' });
    });

    it('runs out of keys gracefully', () => {
        const many = Array.from({ length: 40 }, (_, i) => ({ ...client, key: `f${i}`, label: `F${i}` }));
        const keys = Object.values(assignCustomFieldAccessKeys(many));
        const given = keys.filter((k) => k !== null);
        expect(new Set(given).size).toEqual(given.length);
        expect(given).not.toContain('f');
        expect(keys).toContain(null);
    });
});

describe('custom fields in the edit modal', () => {
    it('edits values, adding brackets to a note name', async () => {
        const t = task('Write report 📁 [[Website]]');
        const editable = EditableTask.fromTask(t, [t]);
        expect(editable.customFields).toEqual({ project: 'Website', client: '' });

        editable.customFields.project = 'Intranet';
        editable.customFields.client = 'Acme';
        const [edited] = await editable.applyEdits(t, [t]);

        expect(edited.customFields).toEqual({ project: '[[Intranet]]', client: 'Acme' });
        expect(edited.toFileLineString()).toEqual('- [ ] Write report 📁 [[Intranet]] 👤 Acme');
    });

    it('removes a field whose value is emptied', async () => {
        const t = task('Write report 📁 [[Website]]');
        const editable = EditableTask.fromTask(t, [t]);
        editable.customFields.project = '';
        const [edited] = await editable.applyEdits(t, [t]);

        expect(edited.toFileLineString()).toEqual('- [ ] Write report');
    });
});

describe('custom field queries', () => {
    // Built in beforeEach, once the fields are defined: a describe() body runs before any beforeEach().
    let website: Task;
    let intranet: Task;
    let none: Task;
    beforeEach(() => {
        website = task('A 📁 [[Website]] 👤 Acme');
        intranet = task('B 📁 [[Intranet]]');
        none = task('C');
    });

    it('filters by presence', () => {
        const has = parseFilter('has field project')!;
        testTaskFilter(has, website, true);
        testTaskFilter(has, none, false);

        const no = parseFilter('no field client')!;
        testTaskFilter(no, intranet, true);
        testTaskFilter(no, website, false);
    });

    it('filters by text', () => {
        const includes = parseFilter('field project includes web')!;
        testTaskFilter(includes, website, true);
        testTaskFilter(includes, intranet, false);
        testTaskFilter(includes, none, false);

        testTaskFilter(parseFilter('field project does not include web')!, none, true);
        testTaskFilter(parseFilter('field Project regex matches /^\\[\\[Intra/')!, intranet, true);
    });

    it('works inside boolean combinations', () => {
        const filter = parseFilter('(field project includes Website) OR (field project includes Intranet)')!;
        testTaskFilter(filter, website, true);
        testTaskFilter(filter, intranet, true);
        testTaskFilter(filter, none, false);
    });

    it('explains a presence filter', () => {
        expect(parseFilter('has field project')).toHaveExplanation('Project (field project) is set');
    });

    it('reports an unknown key', () => {
        const filter = parseFilter('field wibble includes x')!;
        expect(filter.error).toContain("There is no custom field with the key 'wibble'");
        expect(filter.error).toContain('project, client');
    });

    it('reports an unknown operator', () => {
        expect(parseFilter('field project is x')!.error).toContain("use 'includes'");
    });

    it('does not claim other instructions', () => {
        expect(new CustomFieldField().canCreateFilterForLine('description includes field')).toEqual(false);
    });

    it('sorts tasks with a value first, then by value', () => {
        const sorter = parseSorter('sort by field project')!;
        expectTaskComparesBefore(sorter, intranet, website);
        expectTaskComparesBefore(sorter, website, none);
        expect(parseSorter('sort by field wibble')).toBeNull();
    });

    it('groups by value, with tasks without one last', () => {
        const grouper = parseGrouper('group by field project')!;
        expect({ grouper, tasks: [website, none, intranet] }).groupHeadingsToBe([
            '%%1 Intranet%%[[Intranet]]',
            '%%1 Website%%[[Website]]',
            '%%2%%No Project',
        ]);
    });

    it('exposes values to scripting', () => {
        const filter = parseFilter("filter by function task.customFields.project === '[[Website]]'")!;
        testTaskFilter(filter, website, true);
        testTaskFilter(filter, intranet, false);
    });
});

describe('Task construction', () => {
    it('defaults to no custom fields', () => {
        const t = new Task({ ...task('A'), customFields: undefined });
        expect(t.customFields).toEqual({});
    });
});

describe('custom field auto-suggest', () => {
    function suggest(line: string, allTasks: Task[], frontmatter?: Record<string, unknown>, dataview = false) {
        const symbols = dataview ? DATAVIEW_SYMBOLS : DEFAULT_SYMBOLS;
        const builder = makeDefaultSuggestionBuilder(symbols, DEFAULT_MAX_GENERIC_SUGGESTIONS, dataview);
        return builder(line, line.length, getSettings(), allTasks, true, undefined, { path: 'a.md', frontmatter });
    }

    it('suggests the fields themselves', () => {
        const suggestions = suggest('- [ ] Write report proj', []);
        expect(suggestions.map((s) => s.displayText)).toContain('📁 Project');
    });

    it('does not suggest a field already on the line', () => {
        const suggestions = suggest('- [ ] Write report 📁 [[Website]] ', []);
        expect(suggestions.map((s) => s.displayText)).not.toContain('📁 Project');
    });

    it("suggests the note's default first, then values used on other tasks", () => {
        const others = [task('A 📁 [[Intranet]]'), task('B 📁 [[Intranet]]'), task('C 📁 [[Archive]]')];
        const suggestions = suggest('- [ ] Write report 📁 ', others, { project: 'Website' });

        expect(suggestions.slice(0, 3).map((s) => s.displayText)).toEqual(['Website', 'Intranet', 'Archive']);
        expect(suggestions[0].appendText).toEqual('📁 [[Website]] ');
    });

    it('filters values by the text typed so far', () => {
        const others = [task('A 👤 Acme'), task('B 👤 Globex')];
        const suggestions = suggest('- [ ] Call 👤 glo', others);

        expect(suggestions.filter((s) => s.suggestionType === 'match').map((s) => s.displayText)).toEqual(['Globex']);
    });

    it("leaves a note link being typed to Obsidian's own link suggestions", () => {
        const others = [task('A 📁 [[Intranet]]')];
        const suggestions = suggest('- [ ] Write report 📁 [[Int', others);
        expect(suggestions.map((s) => s.displayText)).not.toContain('[[Intranet]]');
    });

    it('suggests values in the Dataview format', () => {
        updateSettings({ taskFormat: 'dataview' });
        const others = [task('A [client:: Acme]')];
        const suggestions = suggest('- [ ] Call [client:: ', others, undefined, true);

        expect(suggestions[0].displayText).toEqual('Acme');
        expect(suggestions[0].appendText).toEqual('client:: Acme] ');
    });
});

describe('hiding one custom field', () => {
    it("understands 'hide field <key>' and 'show field <key>'", () => {
        const options = new TaskLayoutOptions();
        expect(parseTaskShowHideOptions(options, 'field project', false)).toEqual(true);
        expect(options.isCustomFieldShown('project')).toEqual(false);
        expect(options.isCustomFieldShown('Project')).toEqual(false);
        expect(options.isCustomFieldShown('client')).toEqual(true);

        parseTaskShowHideOptions(options, 'field project', true);
        expect(options.isCustomFieldShown('project')).toEqual(true);
    });

    it('is accepted in a query', () => {
        const query = new Query('hide field project', createTestTasksFile('a.md'));
        expect(query.error).toBeUndefined();
        expect(query.taskLayoutOptions.isCustomFieldShown('project')).toEqual(false);
    });
});

describe('note links in queries compare by the note they point to', () => {
    const notePath = 'Projets/Macro-projet B/Macro-projet B - Sous-projet B.A.md';

    beforeEach(() => {
        // Like Obsidian: a short name, or a full path without '.md', both find the note.
        setNoteLinkTargetResolver((linkpath) =>
            [notePath.replace(/\.md$/, ''), 'Macro-projet B - Sous-projet B.A'].includes(linkpath) ? notePath : null,
        );
    });

    afterEach(() => {
        setNoteLinkTargetResolver(() => null);
    });

    function tasks() {
        return [
            task('Test 🗂️ 📁 [[Projets/Macro-projet B/Macro-projet B - Sous-projet B.A]]'),
            task(
                'Test task B.A.1.2 📁 [[Projets/Macro-projet B/Macro-projet B - Sous-projet B.A|Macro-projet B - Sous-projet B.A]]',
            ),
            task('Short 📁 [[Macro-projet B - Sous-projet B.A]]'),
            task('Heading 📁 [[Macro-projet B - Sous-projet B.A#Plan]]'),
        ];
    }

    it('puts every way of linking to the same note in one group, headed by a link to it', () => {
        const grouper = parseGrouper('group by field project')!;
        expect({ grouper, tasks: tasks() }).groupHeadingsToBe([
            '%%1 Macro-projet B - Sous-projet B.A%%[[Projets/Macro-projet B/Macro-projet B - Sous-projet B.A|Macro-projet B - Sous-projet B.A]]',
        ]);
    });

    it('groups links to a missing note by name, ignoring alias and heading', () => {
        const grouper = parseGrouper('group by field project')!;
        const missing = [task('A 📁 [[Nowhere|x]]'), task('B 📁 [[Nowhere#h]]'), task('C 📁 [[Nowhere]]')];
        expect({ grouper, tasks: missing }).groupHeadingsToBe(['%%1 Nowhere%%[[Nowhere]]']);
    });

    it('sorts links to the same note as equal', () => {
        const [full, aliased] = tasks();
        expect(parseSorter('sort by field project')!.comparator(full, aliased, SearchInfo.fromAllTasks([]))).toEqual(0);
    });

    it("matches filters against the note's path as well as the link text", () => {
        const [, , short] = tasks();
        testTaskFilter(parseFilter('field project includes Projets/Macro-projet B')!, short, true);
        testTaskFilter(parseFilter('field project includes Sous-projet B.A')!, short, true);
    });
});

describe('note choices', () => {
    const notePaths = ['Projects/Website.md', 'Archive/Website.md', 'Projects/Intranet.md', 'Inbox.md'];

    it('lists each note once, used notes first, however they are linked', () => {
        setNoteLinkTargetResolver((linkpath) =>
            ['Intranet', 'Projects/Intranet'].includes(linkpath) ? 'Projects/Intranet.md' : null,
        );
        try {
            const others = [task('A 📁 [[Intranet]]'), task('B 📁 [[Projects/Intranet|Intranet]]')];
            const choices = noteChoicesFor(project, others, notePaths, '', 10);

            expect(choices).toEqual([
                { name: 'Intranet', folder: 'Projects', linkpath: 'Projects/Intranet' },
                { name: 'Inbox', folder: '/', linkpath: 'Inbox' },
                { name: 'Website', folder: 'Projects', linkpath: 'Projects/Website' },
                { name: 'Website', folder: 'Archive', linkpath: 'Archive/Website' },
            ]);
        } finally {
            setNoteLinkTargetResolver(() => null);
        }
    });

    it("shows no folder for a note that doesn't exist yet", () => {
        const choices = noteChoicesFor(project, [task('A 📁 [[Someday]]')], notePaths, 'some', 10);
        expect(choices).toEqual([{ name: 'Someday', folder: '', linkpath: 'Someday' }]);
    });

    it('filters by name or folder', () => {
        const names = (typed: string) => noteChoicesFor(project, [], notePaths, typed, 10).map((c) => c.linkpath);
        expect(names('web')).toEqual(['Projects/Website', 'Archive/Website']);
        expect(names('archive')).toEqual(['Archive/Website']);
    });

    it('fills the input with the name, or the path when the name is shared', () => {
        const [intranet] = noteChoicesFor(project, [], notePaths, 'intra', 1);
        const [website] = noteChoicesFor(project, [], notePaths, 'web', 1);
        expect(noteChoiceInputValue(intranet, notePaths)).toEqual('Intranet');
        expect(noteChoiceInputValue(website, notePaths)).toEqual('Projects/Website');
    });
});
