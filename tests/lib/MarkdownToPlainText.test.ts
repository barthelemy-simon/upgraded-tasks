import { markdownToPlainText } from '../../src/lib/MarkdownToPlainText';

describe('markdownToPlainText', () => {
    describe('links', () => {
        it.each([
            ['[[Note]]', 'Note'],
            ['[[Note|Alias]]', 'Alias'],
            ['[[Folder/Note|Alias]]', 'Alias'],
            ['[[Note|]]', 'Note'],
            ['[[Note#Heading]]', 'Note > Heading'],
            ['[[Note#^block-id]]', 'Note > block-id'],
            ['[[#Heading]]', 'Heading'],
            ['[[Note#Heading|Alias]]', 'Alias'],
            ['![[Image.png]]', 'Image.png'],
            ['[Website](https://example.com)', 'Website'],
            ['![alt text](image.png)', 'alt text'],
            ['See [[A]] and [[B|b]] and [c](d)', 'See A and b and c'],
        ])('should turn %s into %s', (input, expected) => {
            expect(markdownToPlainText(input)).toEqual(expected);
        });
    });

    describe('formatting', () => {
        it.each([
            ['**bold**', 'bold'],
            ['__bold__', 'bold'],
            ['*italic*', 'italic'],
            ['_italic_', 'italic'],
            ['***bold italic***', 'bold italic'],
            ['~~struck~~', 'struck'],
            ['==highlighted==', 'highlighted'],
            ['`code`', 'code'],
            ['``code with ` tick``', 'code with ` tick'],
            ['**[[Note|Alias]]**', 'Alias'],
            ['Call **John** about *the* ==report==', 'Call John about the report'],
        ])('should turn %s into %s', (input, expected) => {
            expect(markdownToPlainText(input)).toEqual(expected);
        });

        it('should not treat formatting characters inside code as formatting', () => {
            expect(markdownToPlainText('Run `**not bold**` now')).toEqual('Run **not bold** now');
        });

        it('should leave underscores inside words alone', () => {
            expect(markdownToPlainText('rename snake_case_name')).toEqual('rename snake_case_name');
        });

        it('should leave a lone asterisk or arithmetic alone', () => {
            expect(markdownToPlainText('2 * 3 = 6')).toEqual('2 * 3 = 6');
        });

        it('should show backslash-escaped characters literally', () => {
            expect(markdownToPlainText('\\*not italic\\* and \\[[not a link]]')).toEqual(
                '*not italic* and [[not a link]]',
            );
        });
    });

    describe('things with no plain-text rendering', () => {
        it.each([
            ['Buy milk %%private note%%', 'Buy milk'],
            ['Buy <!-- hidden --> milk', 'Buy milk'],
            ['Claim[^1] needs checking', 'Claim needs checking'],
            ['<b>bold</b> and <span style="color:red">red</span>', 'bold and red'],
        ])('should turn %s into %s', (input, expected) => {
            expect(markdownToPlainText(input)).toEqual(expected);
        });

        it('should leave math as written', () => {
            expect(markdownToPlainText('Solve $x^2$')).toEqual('Solve $x^2$');
        });
    });

    it('should leave plain text unchanged', () => {
        expect(markdownToPlainText('Buy milk, eggs (12) & bread!')).toEqual('Buy milk, eggs (12) & bread!');
    });
});
