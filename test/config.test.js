import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { resolveDataDir, config } from '../server/config.js';

const DEFAULT = path.join(os.homedir(), '.ctrl-centre');

describe('resolveDataDir', () => {
  test('falls back to ~/.ctrl-centre when unset', () => {
    assert.equal(resolveDataDir(undefined), DEFAULT);
  });

  test('falls back when the value is blank or whitespace', () => {
    assert.equal(resolveDataDir(''), DEFAULT);
    assert.equal(resolveDataDir('   '), DEFAULT);
  });

  test('expands a leading ~ to the home directory', () => {
    assert.equal(resolveDataDir('~/notes/ctrl'), path.join(os.homedir(), 'notes', 'ctrl'));
  });

  test('leaves an absolute path alone', () => {
    assert.equal(resolveDataDir('/srv/ctrl-centre'), '/srv/ctrl-centre');
  });

  test('resolves a relative path to an absolute one', () => {
    const resolved = resolveDataDir('./data');
    assert.ok(path.isAbsolute(resolved), `expected an absolute path, got ${resolved}`);
    assert.equal(resolved, path.resolve('./data'));
  });

  test('trims surrounding whitespace', () => {
    assert.equal(resolveDataDir('  /srv/ctrl-centre  '), '/srv/ctrl-centre');
  });

  test('does not expand a bare ~ inside the path', () => {
    assert.equal(resolveDataDir('/srv/~backup'), '/srv/~backup');
  });
});

describe('config', () => {
  test('exposes the data directory', () => {
    assert.ok(path.isAbsolute(config.dir), 'config.dir should be absolute');
  });

  test('puts the todo file inside the data directory', () => {
    assert.equal(config.todoFile, path.join(config.dir, 'todos.md'));
  });

  test('ignores the retired CTRL_CENTRE_TODO_FILE variable', () => {
    // The clean break in ADR 0007: only CTRL_CENTRE_DIR is read. This asserts
    // the old name is not quietly still wired up.
    const source = process.env.CTRL_CENTRE_DIR;
    assert.equal(
      config.dir,
      source && source.trim() ? resolveDataDir(source) : DEFAULT,
    );
  });
});
