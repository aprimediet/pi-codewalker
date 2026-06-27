import { describe, it, expect } from 'vitest';
import { extractDocComment } from './docs.ts';

describe('extractDocComment', () => {
  it('extracts a JSDoc block comment above a given line', () => {
    const source = `/**
 * This is a doc comment for myFunc.
 * It has multiple lines.
 */
function myFunc() {}
`;
    const doc = extractDocComment(source, 4);
    expect(doc).toContain('This is a doc comment for myFunc');
    expect(doc).toContain('It has multiple lines');
  });

  it('extracts // line comment block above a given line', () => {
    const source = `// This is a line comment
// that spans two lines
function myFunc() {}
`;
    const doc = extractDocComment(source, 3);
    expect(doc).toContain('This is a line comment');
    expect(doc).toContain('that spans two lines');
  });

  it('extracts a Python docstring above a given line', () => {
    const source = `"""This is a Python docstring
for my function.
"""
def my_func():
    pass
`;
    const doc = extractDocComment(source, 4);
    expect(doc).toContain('This is a Python docstring');
    expect(doc).toContain('for my function.');
  });

  it('returns empty string when there is no doc comment', () => {
    const source = `const x = 1;
function myFunc() {}
`;
    const doc = extractDocComment(source, 2);
    expect(doc).toBe('');
  });

  it('returns empty string for a symbol on the first line with no preceding comments', () => {
    const source = `function first() {}`;
    const doc = extractDocComment(source, 1);
    expect(doc).toBe('');
  });

  it('extracts mixed // and /* */ comment lines', () => {
    const source = `// A brief explanation
/* Then a block comment */
function mixed() {}
`;
    const doc = extractDocComment(source, 3);
    expect(doc).toContain('A brief explanation');
    expect(doc).toContain('Then a block comment');
  });

  it('stops at blank lines when collecting adjacent comments', () => {
    const source = `// Not adjacent

// Directly above
function myFunc() {}
`;
    const doc = extractDocComment(source, 4);
    expect(doc).toContain('Directly above');
    expect(doc).not.toContain('Not adjacent');
  });

  it('handles single-line Python docstrings', () => {
    const source = `"""Single line docstring."""
def quick(): pass
`;
    const doc = extractDocComment(source, 2);
    expect(doc).toContain('Single line docstring.');
  });
});
