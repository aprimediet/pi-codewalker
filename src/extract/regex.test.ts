import { describe, it, expect } from 'vitest';
import { extractRegex, extractTsJs, extractPython, extractGo } from './regex.ts';

describe('extractTsJs', () => {
  it('extracts function declarations', () => {
    const source = `
function hello() {
  return 1;
}

function greet(name: string) {
  return "hi";
}
`;
    const symbols = extractTsJs(source, 'src/test.ts');
    expect(symbols).toHaveLength(2);
    expect(symbols[0]!.name).toBe('hello');
    expect(symbols[0]!.kind).toBe('function');
    expect(symbols[0]!.line_start).toBe(2);
    expect(symbols[1]!.name).toBe('greet');
    expect(symbols[1]!.line_start).toBe(6);
  });

  it('extracts export const (not plain const)', () => {
    const source = `
export const PI = 3.14;
export const getName = () => "hello";
const local = "secret";
`;
    const symbols = extractTsJs(source, 'src/consts.ts');
    expect(symbols).toHaveLength(2);
    expect(symbols[0]!.name).toBe('PI');
    expect(symbols[0]!.kind).toBe('const');
    expect(symbols[1]!.name).toBe('getName');
    expect(symbols[1]!.kind).toBe('const');
  });

  it('extracts class declarations', () => {
    const source = `
class MyClass {
  method() {}
}

export class ExportedClass {
  foo() {}
}
`;
    const symbols = extractTsJs(source, 'src/classes.ts');
    expect(symbols).toHaveLength(2);
    expect(symbols[0]!.name).toBe('MyClass');
    expect(symbols[0]!.kind).toBe('class');
    expect(symbols[1]!.name).toBe('ExportedClass');
    expect(symbols[1]!.kind).toBe('class');
  });

  it('extracts type and interface declarations', () => {
    const source = `
type UserId = string;
interface User {
  name: string;
}
export type Status = "active" | "inactive";
`;
    const symbols = extractTsJs(source, 'src/types.ts');
    expect(symbols).toHaveLength(3);
    expect(symbols[0]!.name).toBe('UserId');
    expect(symbols[0]!.kind).toBe('type');
    expect(symbols[1]!.name).toBe('User');
    expect(symbols[1]!.kind).toBe('interface');
    expect(symbols[2]!.name).toBe('Status');
    expect(symbols[2]!.kind).toBe('type');
  });

  it('extracts async functions and generators', () => {
    const source = `
async function fetchData() {}
function* generate() {}
async function* stream() {}
`;
    const symbols = extractTsJs(source, 'src/async.ts');
    expect(symbols).toHaveLength(3);
    expect(symbols[0]!.name).toBe('fetchData');
    expect(symbols[1]!.name).toBe('generate');
    expect(symbols[2]!.name).toBe('stream');
  });

  it('extracts export function', () => {
    const source = 'export function doSomething(arg: string): void {}';
    const symbols = extractTsJs(source, 'src/exports.ts');
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.name).toBe('doSomething');
    expect(symbols[0]!.kind).toBe('function');
  });
});

describe('extractPython', () => {
  it('extracts function definitions', () => {
    const source = `
def hello():
    return 1

def greet(name):
    return "hi"
`;
    const symbols = extractPython(source, 'src/test.py');
    expect(symbols).toHaveLength(2);
    expect(symbols[0]!.name).toBe('hello');
    expect(symbols[0]!.kind).toBe('function');
    expect(symbols[0]!.line_start).toBe(2);
    expect(symbols[1]!.name).toBe('greet');
    expect(symbols[1]!.line_start).toBe(5);
  });

  it('extracts class definitions and methods', () => {
    const source = `
class MyClass:
    pass

class AnotherClass:
    def method(self):
        pass
`;
    const symbols = extractPython(source, 'src/classes.py');
    expect(symbols).toHaveLength(3);
    expect(symbols[0]!.name).toBe('MyClass');
    expect(symbols[0]!.kind).toBe('class');
    expect(symbols[1]!.name).toBe('AnotherClass');
    expect(symbols[1]!.kind).toBe('class');
    expect(symbols[2]!.name).toBe('method');
    expect(symbols[2]!.kind).toBe('function');
  });

  it('extracts async def', () => {
    const source = 'async def fetch_data(): pass';
    const symbols = extractPython(source, 'src/async.py');
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.name).toBe('fetch_data');
    expect(symbols[0]!.kind).toBe('function');
  });
});

describe('extractGo', () => {
  it('extracts function declarations', () => {
    const source = `
func hello() {}

func greet(name string) string {
  return name
}
`;
    const symbols = extractGo(source, 'src/main.go');
    expect(symbols).toHaveLength(2);
    expect(symbols[0]!.name).toBe('hello');
    expect(symbols[0]!.kind).toBe('function');
    expect(symbols[0]!.line_start).toBe(2);
    expect(symbols[1]!.name).toBe('greet');
    expect(symbols[1]!.line_start).toBe(4);
  });

  it('extracts methods with receivers', () => {
    const source = `
func (u *User) GetName() string {
  return u.name
}

func (s *Service) Serve() error {
  return nil
}
`;
    const symbols = extractGo(source, 'src/methods.go');
    expect(symbols).toHaveLength(2);
    expect(symbols[0]!.name).toBe('GetName');
    expect(symbols[0]!.kind).toBe('method');
    expect(symbols[1]!.name).toBe('Serve');
    expect(symbols[1]!.kind).toBe('method');
  });
});

describe('extractRegex', () => {
  it('dispatches to the correct language extractor for .ts', () => {
    const symbols = extractRegex('function foo() {}', 'src/test.ts');
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.name).toBe('foo');
  });

  it('dispatches to the correct language extractor for .py', () => {
    const symbols = extractRegex('def foo(): pass', 'src/test.py');
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.name).toBe('foo');
  });

  it('dispatches to the correct language extractor for .go', () => {
    const symbols = extractRegex('func foo() {}', 'src/test.go');
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.name).toBe('foo');
  });

  it('returns empty array for unsupported file extensions', () => {
    const symbols = extractRegex('fn foo() {}', 'src/test.rs');
    expect(symbols).toEqual([]);
  });
});
