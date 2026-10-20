const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Readable } = require('node:stream');
const PizZip = require('pizzip');
const { validateWordInput, runOffice, streamToBuffer } = require('./document-preview');

const docx = new PizZip().file('[Content_Types].xml', '<Types/>').file('word/document.xml', '<w:document/>').generate({ type: 'nodebuffer' });
const doc = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.from('ole')]);

test('Word preview validates extension and file signature', () => {
  assert.equal(validateWordInput('report.docx', docx), '.docx');
  assert.equal(validateWordInput('report.doc', doc), '.doc');
  assert.throws(() => validateWordInput('report.docx', doc), { code: 'PREVIEW_INVALID_INPUT' });
  assert.throws(() => validateWordInput('macro.docm', docx), { code: 'PREVIEW_UNSUPPORTED' });
  assert.throws(() => validateWordInput('../page.html', Buffer.from('<html>')), { code: 'PREVIEW_UNSUPPORTED' });
  const traversal = new PizZip().file('[Content_Types].xml', '<Types/>').file('word/document.xml', '<w:document/>').file('../evil.bin', 'x').generate({ type: 'nodebuffer' });
  assert.throws(() => validateWordInput('report.docx', traversal), { code: 'PREVIEW_INVALID_INPUT' });
});

test('stream reader enforces byte limit', async () => {
  assert.equal((await streamToBuffer(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), 4)).toString(), 'abcd');
  await assert.rejects(streamToBuffer(Readable.from([Buffer.from('abc'), Buffer.from('def')]), 5), { code: 'PREVIEW_INVALID_INPUT' });
});

test('LibreOffice runner uses argv without shell', async () => {
  let captured;
  const fakeSpawn = (bin, args, options) => {
    captured = { bin, args, options };
    const child = new EventEmitter(); child.stderr = new PassThrough(); child.pid = 123;
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };
  await runOffice('/tmp/input.docx', '/tmp/output', '/tmp/profile', { spawn: fakeSpawn, officeBin: 'soffice-test', timeoutMs: 100 });
  assert.equal(captured.bin, 'soffice-test');
  assert.equal(captured.options.shell, false);
  assert.deepEqual(captured.args.slice(-4), ['pdf:writer_pdf_Export', '--outdir', '/tmp/output', '/tmp/input.docx']);
  assert.match(captured.args.find(arg => arg.startsWith('-env:UserInstallation=')), /^-env:UserInstallation=file:/);
});

test('LibreOffice runner times out and kills process', async () => {
  let killed = false;
  const fakeSpawn = () => { const child = new EventEmitter(); child.stderr = new PassThrough(); child.pid = 123; return child; };
  await assert.rejects(runOffice('a.doc', 'out', 'profile', { spawn: fakeSpawn, killTree: () => { killed = true; }, timeoutMs: 5 }), { code: 'PREVIEW_TIMEOUT' });
  assert.equal(killed, true);
});
