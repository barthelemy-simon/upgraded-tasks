/** Characters Markdown lets you backslash-escape. */
const ESCAPABLE = '\\`*_{}[]()#+-.!~=|%<>$^';

// Private Use Area characters (never present in real text) stand in for things that must not be read as
// formatting while the regexes below run. Built with fromCharCode rather than written as escapes in a string
// or regex literal: the lint auto-fix rewrites those escapes into invisible literal characters.

/** Where a backslash-escaped character is parked, so e.g. `\*` is never read as the start of italics. */
const ESCAPE_BASE = 0xe000;
/** Wrap a code span's index, so nothing inside code is read as formatting. */
const CODE_OPEN = String.fromCharCode(0xe100);
const CODE_CLOSE = String.fromCharCode(0xe101);
const CODE_PLACEHOLDER = new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, 'g');

function parkEscapes(text: string): string {
    return text.replace(/\\(.)/g, (match, char: string) =>
        ESCAPABLE.includes(char) ? String.fromCharCode(ESCAPE_BASE + char.charCodeAt(0)) : match,
    );
}

function restoreEscapes(text: string): string {
    return Array.from(text, (char) => {
        const code = char.charCodeAt(0);
        return code >= ESCAPE_BASE && code < ESCAPE_BASE + 0x80 ? String.fromCharCode(code - ESCAPE_BASE) : char;
    }).join('');
}

/** `[[Note|Alias]]` → `Alias`; `[[Note]]` → `Note`; `[[Note#Heading]]` → `Note > Heading`, which is how
 *  Obsidian renders a heading link. Embeds (`![[...]]`) are treated the same. */
function wikilinkDisplayText(_match: string, target: string, alias: string | undefined): string {
    if (alias !== undefined && alias.trim() !== '') {
        return alias;
    }
    return target
        .split(/#\^?/)
        .filter((part) => part !== '')
        .join(' > ');
}

/**
 * Reduces inline Markdown in {@link text} to the text Obsidian would display for it, for places that can
 * only show plain text - reminder notifications (OS-level, in-app, and ntfy push), where raw syntax like
 * `[[People/John|John]]` or `**urgent**` is just noise.
 *
 * Handles what reasonably appears in a single task line:
 * - comments (`%%...%%`, `<!-- ... -->`) are dropped entirely
 * - wikilinks and embeds show their alias or target (see {@link wikilinkDisplayText})
 * - Markdown links and images (`[text](url)`, `![alt](url)`) show their text
 * - footnote references (`[^1]`) are dropped
 * - bold, italic, strikethrough, highlight and inline code keep their content, without the markers
 * - HTML tags are removed, keeping their content
 * - backslash escapes (`\*`) show the escaped character
 *
 * Math (`$...$`) is left as written: it has no plain-text rendering. Tags aren't handled here - callers use
 * {@link Task.descriptionWithoutTags} for that.
 */
export function markdownToPlainText(text: string): string {
    let result = parkEscapes(text);

    const codeSpans: string[] = [];
    result = result.replace(/(`+)(.+?)\1/g, (_match, _ticks: string, code: string) => {
        codeSpans.push(code.trim());
        return `${CODE_OPEN}${codeSpans.length - 1}${CODE_CLOSE}`;
    });

    result = result
        .replace(/%%.*?%%/g, '')
        .replace(/<!--.*?-->/g, '')
        .replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, wikilinkDisplayText)
        .replace(/\[\^[^\]]*\]/g, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<\/?[a-zA-Z][^>]*>/g, '')
        .replace(/\*\*(?=\S)(.+?)\*\*/g, '$1')
        .replace(/(^|[^\w])__(?=\S)(.+?)__(?=[^\w]|$)/g, '$1$2')
        .replace(/\*(?=\S)([^*]*?\S)\*/g, '$1')
        .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?=[^\w]|$)/g, '$1$2')
        .replace(/~~(?=\S)(.+?)~~/g, '$1')
        .replace(/==(?=\S)(.+?)==/g, '$1');

    result = result.replace(CODE_PLACEHOLDER, (_match, index: string) => codeSpans[Number(index)]);

    return restoreEscapes(result)
        .replace(/\s{2,}/g, ' ')
        .trim();
}
