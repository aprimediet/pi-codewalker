import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// We test the contract of the extension factory: it must register a tool and a command.
// We create a minimal pi API stub to verify the shape.

interface ToolRegistration {
  name: string;
  description: string;
  parameters: unknown;
  execute: Function;
}

interface CommandRegistration {
  name: string;
  description: string;
  handler: Function;
}

function createPiStub(): {
  tools: ToolRegistration[];
  commands: CommandRegistration[];
  api: Record<string, Function>;
} {
  const tools: ToolRegistration[] = [];
  const commands: CommandRegistration[] = [];
  const api: Record<string, Function> = {};

  return {
    tools,
    commands,
    api: {
      registerTool: (t: ToolRegistration) => { tools.push(t); },
      registerCommand: (name: string, cmd: { description: string; handler: Function }) => {
        commands.push({ name, description: cmd.description, handler: cmd.handler });
      },
    },
  };
}

describe('index.ts contract', () => {
  it('the default export is a factory function', async () => {
    const mod = await import('./index.ts');
    expect(typeof mod.default).toBe('function');
  });

  it('calling the factory registers a tool named codewalker_query and a command named codewalker', async () => {
    const mod = await import('./index.ts');
    const stub = createPiStub();

    // Call the factory with the stub API
    mod.default(stub.api as any);

    // Check tool registered
    const queryTool = stub.tools.find(t => t.name === 'codewalker_query');
    expect(queryTool).toBeDefined();
    expect(queryTool!.description).toContain('code index');

    // Check tool has a source parameter
    const toolParams = (queryTool!.parameters as any);
    expect(toolParams.properties).toHaveProperty('source');

    // Check command registered
    const cmd = stub.commands.find(c => c.name === 'codewalker');
    expect(cmd).toBeDefined();
    expect(cmd!.description).toContain('libs');
    expect(cmd!.description).toContain('lib');
  });

  it('tool.execute returns { content, details } with compact text content', async () => {
    // Create a temporary project dir so the DB path exists
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-contract-'));
    const piDir = path.join(tmpDir, '.pi');
    fs.mkdirSync(piDir, { recursive: true });
    const markerId = 'test-project-contract-' + Math.random().toString(36).slice(2, 8);
    fs.writeFileSync(path.join(piDir, markerId + '.md'), `---\npi-project: true\nid: ${markerId}\n---\n`);

    // Pre-create the codewalker global dir so the DB can be opened
    const homePi = path.join(os.homedir(), '.pi', 'projects', markerId, 'codewalker');
    fs.mkdirSync(homePi, { recursive: true });

    const mod = await import('./index.ts');
    const stub = createPiStub();

    mod.default(stub.api as any);

    const tool = stub.tools.find(t => t.name === 'codewalker_query')!;
    const result = await tool.execute(
      'test-id',
      { query: 'test' },
      new AbortController().signal,
      () => {},
      { cwd: tmpDir },
    );

    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('details');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]!.type).toBe('text');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tool.execute with source="libs" returns valid result even with no lib data', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-contract-libs-'));
    const piDir = path.join(tmpDir, '.pi');
    fs.mkdirSync(piDir, { recursive: true });
    const markerId = 'test-project-libs-' + Math.random().toString(36).slice(2, 8);
    fs.writeFileSync(path.join(piDir, markerId + '.md'), `---\npi-project: true\nid: ${markerId}\n---\n`);

    const homePi = path.join(os.homedir(), '.pi', 'projects', markerId, 'codewalker');
    fs.mkdirSync(homePi, { recursive: true });

    const mod = await import('./index.ts');
    const stub = createPiStub();
    mod.default(stub.api as any);

    const tool = stub.tools.find(t => t.name === 'codewalker_query')!;
    const result = await tool.execute(
      'test-id',
      { query: 'test', source: 'libs' },
      new AbortController().signal,
      () => {},
      { cwd: tmpDir },
    );

    expect(result).toHaveProperty('content');
    expect(result.content[0]!.text).toContain('No matches');
    expect(result.details.rows).toEqual([]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('command description mentions libs and lib subcommands', async () => {
    const mod = await import('./index.ts');
    const stub = createPiStub();
    mod.default(stub.api as any);

    const cmd = stub.commands.find(c => c.name === 'codewalker')!;
    expect(cmd.description).toContain('libs [--dev]');
    expect(cmd.description).toContain('lib <pkg>');
  });
});
