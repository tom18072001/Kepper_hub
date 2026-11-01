import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../../../scripts/scan-real-data.mjs';

test('empty demo directory cannot pass', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scan-demo-'));
  const result = await scan(root, ['fixtures']);
  assert.equal(result.scanned, 0);
});

test('reads fixtures and reports suspicious identifiers without exposing values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scan-demo-'));
  await mkdir(join(root, 'fixtures'));
  await writeFile(join(root, 'fixtures', 'demo.txt'), 'contact: user@' + 'company.vn');
  const result = await scan(root, ['fixtures']);
  assert.equal(result.scanned, 1);
  assert.deepEqual(result.findings, [{ file: join('fixtures', 'demo.txt'), line: 1, rule: 'email' }]);
});
