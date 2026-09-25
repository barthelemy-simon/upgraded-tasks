import type { Task } from '../Task/Task';
import { type CustomFieldDefinition, customFieldNoteTarget } from './CustomFieldDefinition';

/**
 * One note offered for a note-link custom field: listed once, however many ways other tasks link to it.
 */
export interface NoteChoice {
    /** The note's name, without folders: shown in bold. */
    name: string;
    /** The folder the note is in: '/' at the vault root, '' for a note that doesn't exist yet. */
    folder: string;
    /** What to link to: the note's path without '.md', or the name as written for a missing note. */
    linkpath: string;
}

function choiceFromLinkpath(linkpath: string, exists: boolean): NoteChoice {
    const parts = linkpath.split('/');
    const name = parts.pop() ?? linkpath;
    const folder = parts.length > 0 ? parts.join('/') : exists ? '/' : '';
    return { name, folder, linkpath };
}

/**
 * The notes to offer for a note-link field, one entry per note: first those other tasks already link to
 * (most used first), then every other note in the vault, by name. Only notes whose name or path contains
 * {@link typedText} are kept (ignoring case).
 *
 * @param notePaths - the paths of all the vault's notes, e.g. 'Projects/Website.md'
 * @param preferred - values to put before everything else, such as the note's default
 */
export function noteChoicesFor(
    definition: CustomFieldDefinition,
    allTasks: readonly Task[],
    notePaths: readonly string[],
    typedText: string,
    maxChoices: number,
    preferred: readonly string[] = [],
): NoteChoice[] {
    const counts = new Map<string, number>();
    const existing = new Set(notePaths.map((path) => path.replace(/\.md$/, '')));
    const add = (value: string, sourcePath: string, count: number) => {
        const target = customFieldNoteTarget(value, sourcePath);
        if (target.path !== null) {
            existing.add(target.linkpath);
        }
        counts.set(target.linkpath, (counts.get(target.linkpath) ?? 0) + count);
    };

    preferred.forEach((value) => add(value, '', Number.MAX_SAFE_INTEGER));
    for (const task of allTasks) {
        const value = task.customFields[definition.key];
        if (value !== undefined) {
            add(value, task.path, 1);
        }
    }

    const toChoice = (linkpath: string) => choiceFromLinkpath(linkpath, existing.has(linkpath));
    const used = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([linkpath]) => toChoice(linkpath));
    const others = notePaths
        .map((path) => path.replace(/\.md$/, ''))
        .filter((linkpath) => !counts.has(linkpath))
        .map(toChoice)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const typed = typedText.trim().toLowerCase();
    return [...used, ...others].filter((choice) => choice.linkpath.toLowerCase().includes(typed)).slice(0, maxChoices);
}

/**
 * What to put in the edit modal's input for a chosen note: its name, or its full path if other notes
 * share that name. The saved link then follows the user's link format either way.
 */
export function noteChoiceInputValue(choice: NoteChoice, notePaths: readonly string[]): string {
    const sameName = notePaths.filter((path) => path.replace(/\.md$/, '').split('/').pop() === choice.name);
    return sameName.length > 1 ? choice.linkpath : choice.name;
}
