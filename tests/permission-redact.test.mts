import assert from 'node:assert/strict'
import test from 'node:test'
import { redactSensitiveText } from '../electron/permission-redact.ts'

test('credential-shaped values are masked', () => {
  const samples = [
    'curl -H "Authorization: Bearer abcdefghijklmnop1234" https://x.test',
    'export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuv',
    'git clone https://bob:s3cret@github.com/a/b.git',
    'deploy --token ghp_abcdefghijklmnopqrstuvwxyz0123',
    'aws s3 ls AKIAABCDEFGHIJKLMNOP',
    'mysql --password hunter2',
    'password: "my secret"',
  ]
  for (const sample of samples) {
    const out = redactSensitiveText(sample)
    for (const leak of ['abcdefghijklmnop1234', 'sk-abcdef', 's3cret', 'ghp_abcdef', 'AKIAABCDEF', 'hunter2', 'my secret']) {
      assert.ok(!out.includes(leak), `${leak} leaked in: ${out}`)
    }
    assert.ok(out.includes('[redacted]'))
  }
})

test('home directories collapse to ~ on all platforms', () => {
  assert.equal(redactSensitiveText('cat /Users/alice/project/a.ts'), 'cat ~/project/a.ts')
  assert.equal(redactSensitiveText('ls /home/bob/x'), 'ls ~/x')
  assert.equal(redactSensitiveText('type C:\\Users\\carol\\a.txt'), 'type ~\\a.txt')
})

test('ordinary commands are left alone', () => {
  assert.equal(redactSensitiveText('git status --short'), 'git status --short')
  assert.equal(redactSensitiveText('rm -rf ./dist && npm run build'), 'rm -rf ./dist && npm run build')
})
