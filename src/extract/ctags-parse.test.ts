import { describe, it, expect } from 'vitest';
import { parseCtagsLine, parseCtagsOutput, mapCtagsKind, type CtagsTag } from './ctags-parse.ts';

describe('mapCtagsKind', () => {
  it('maps ctags kind to SymbolKind', () => {
    expect(mapCtagsKind('function')).toBe('function');
    expect(mapCtagsKind('variable')).toBe('const');
    expect(mapCtagsKind('class')).toBe('class');
    expect(mapCtagsKind('member')).toBe('method');
    expect(mapCtagsKind('enum')).toBe('enum');
    expect(mapCtagsKind('typedef')).toBe('type');
    expect(mapCtagsKind('interface')).toBe('interface');
    expect(mapCtagsKind('namespace')).toBe('namespace');
    expect(mapCtagsKind('module')).toBe('module');
  });

  it('returns the kind as-is for unknown kinds', () => {
    expect(mapCtagsKind('macro')).toBe('macro');
    expect(mapCtagsKind('unknown')).toBe('unknown');
  });
});

describe('parseCtagsLine', () => {
  it('parses a valid ctags JSON line into a CtagsTag', () => {
    const line = '{"_type":"tag","name":"myFunction","path":"src/file.ts","pattern":"/^export function myFunction()/","line":10,"kind":"function","signature":"(param: string)"}';
    const result = parseCtagsLine(line);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('myFunction');
    expect(result!.path).toBe('src/file.ts');
    expect(result!.line).toBe(10);
    expect(result!.kind).toBe('function');
    expect(result!.signature).toBe('(param: string)');
  });

  it('returns null for non-tag lines', () => {
    expect(parseCtagsLine('{"_type":"other","name":"foo"}')).toBeNull();
    expect(parseCtagsLine('not json')).toBeNull();
    expect(parseCtagsLine('')).toBeNull();
  });

  it('tolerates missing signature field', () => {
    const line = '{"_type":"tag","name":"foo","path":"a.ts","line":5,"kind":"function"}';
    const result = parseCtagsLine(line);
    expect(result).not.toBeNull();
    expect(result!.signature).toBe('');
  });

  it('tolerates missing kind field', () => {
    const line = '{"_type":"tag","name":"foo","path":"a.ts","line":5}';
    const result = parseCtagsLine(line);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('unknown');
  });

  it('handles numeric kind field (ctags numeric kind)', () => {
    const line = '{"_type":"tag","name":"Foo","path":"a.ts","line":10,"kind":"class"}';
    const result = parseCtagsLine(line);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('class');
  });
});

describe('parseCtagsOutput', () => {
  it('parses multi-line ctags JSON output into Symbol array', () => {
    const output = [
      '{"_type":"tag","name":"myFunc","path":"src/a.ts","line":5,"kind":"function","signature":"()"}',
      '{"_type":"tag","name":"MyClass","path":"src/a.ts","line":20,"kind":"class","signature":""}',
      '{"_type":"tag","name":"MY_CONST","path":"src/b.ts","line":1,"kind":"variable","signature":"42"}',
    ].join('\n');

    const symbols = parseCtagsOutput(output, '/root/project');
    expect(symbols).toHaveLength(3);

    expect(symbols[0]!.name).toBe('myFunc');
    expect(symbols[0]!.kind).toBe('function');
    expect(symbols[0]!.file_path).toBe('/root/project/src/a.ts');
    expect(symbols[0]!.line_start).toBe(5);

    expect(symbols[1]!.name).toBe('MyClass');
    expect(symbols[1]!.kind).toBe('class');

    expect(symbols[2]!.name).toBe('MY_CONST');
    expect(symbols[2]!.kind).toBe('const');
  });

  it('skips malformed and non-tag lines', () => {
    const output = [
      '{"_type":"tag","name":"valid","path":"a.ts","line":1,"kind":"function","signature":""}',
      'not json at all',
      '{"_type":"notag","name":"skip"}',
      '',
      '{"_type":"tag","name":"valid2","path":"a.ts","line":5,"kind":"class","signature":""}',
    ].join('\n');

    const symbols = parseCtagsOutput(output, '/root');
    expect(symbols).toHaveLength(2);
  });

  it('returns empty array for empty output', () => {
    expect(parseCtagsOutput('', '/root')).toEqual([]);
  });

  it('resolves relative paths against project root', () => {
    const output = '{"_type":"tag","name":"f","path":"src/lib/util.ts","line":3,"kind":"function","signature":""}';
    const symbols = parseCtagsOutput(output, '/home/user/project');
    expect(symbols[0]!.file_path).toBe('/home/user/project/src/lib/util.ts');
  });
});
