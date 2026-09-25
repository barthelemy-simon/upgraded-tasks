import type { App, TFile } from 'obsidian';
import type { NoteLinkResolver } from './CustomFieldDefinition';

/**
 * Obsidian's "Files and links > New link format" setting.
 */
type NewLinkFormat = 'shortest' | 'relative' | 'absolute';

/**
 * A {@link NoteLinkResolver} that writes a link the way Obsidian itself would for a new link, following
 * the "New link format" setting. A name that matches no note is kept as typed, since the note may not
 * exist yet.
 */
export function obsidianNoteLinkResolver(app: App): NoteLinkResolver {
    return (linkpath: string, sourcePath: string) => {
        const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
        if (file === null) {
            return linkpath;
        }
        return linkTextForFile(app, file, sourcePath, newLinkFormat(app));
    };
}

function newLinkFormat(app: App): NewLinkFormat {
    // Not in Obsidian's published API, but stable for years and used by many plugins.
    const vault = app.vault as unknown as { getConfig?: (name: string) => unknown };
    const format = vault.getConfig?.('newLinkFormat');
    return format === 'relative' || format === 'absolute' ? format : 'shortest';
}

function linkTextForFile(app: App, file: TFile, sourcePath: string, format: NewLinkFormat): string {
    const target = withoutMarkdownExtension(file.path);
    switch (format) {
        case 'absolute':
            return target;
        case 'relative':
            return relativeLinkPath(sourcePath, target);
        default:
            return app.metadataCache.fileToLinktext(file, sourcePath, true);
    }
}

function withoutMarkdownExtension(path: string) {
    return path.replace(/\.md$/, '');
}

/**
 * The path of {@link targetPath} relative to the folder of the note at {@link sourcePath}, as in
 * Obsidian's "Relative path to file" link format: 'Notes/a.md' to 'Projects/Website' gives
 * '../Projects/Website'.
 */
export function relativeLinkPath(sourcePath: string, targetPath: string): string {
    const sourceFolder = sourcePath.split('/').slice(0, -1);
    const target = targetPath.split('/');
    let common = 0;
    while (common < sourceFolder.length && common < target.length - 1 && sourceFolder[common] === target[common]) {
        common++;
    }
    const ups = sourceFolder.slice(common).map(() => '..');
    return [...ups, ...target.slice(common)].join('/');
}
