/**
 * Join remark lines, dropping the ones with nothing to say
 */
export function remarks(lines: Array<string | null>): string {
    return lines.filter((line) => line !== null).join('\n');
}

/**
 * Escape a value for a single markdown table cell
 */
export function tableCell(text: string | null | undefined): string {
    if (!text) return '';

    return text
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Render a markdown table - cells are escaped here so a stray pipe or newline
 * cannot break the layout
 */
export function table(columns: string[], rows: Array<Array<string | null | undefined>>): string {
    return [
        `| ${columns.map(tableCell).join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...rows.map((cells) => `| ${cells.map(tableCell).join(' | ')} |`)
    ].join('\n');
}
