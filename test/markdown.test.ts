import test from 'node:test';
import assert from 'node:assert';
import { remarks, table, tableCell } from '../lib/markdown.js';

test('remarks', () => {
    assert.equal(remarks(['a', null, 'b']), 'a\nb');
    assert.equal(remarks([null]), '');
});

test('tableCell', () => {
    assert.equal(tableCell(null), '');
    assert.equal(tableCell(undefined), '');
    assert.equal(tableCell(''), '');
    assert.equal(tableCell('  a | b  '), 'a \\| b');
    assert.equal(tableCell('back\\slash'), 'back\\\\slash');
    assert.equal(tableCell('multi\nline\r\n  text'), 'multi line text');
});

test('table', () => {
    assert.equal(table(['A', 'B'], [['1 | one', null], ['2', 'two\nlines']]), [
        '| A | B |',
        '| --- | --- |',
        '| 1 \\| one |  |',
        '| 2 | two lines |'
    ].join('\n'));
});
