import { assert, test } from 'orca/testing'
import { parseCsv, sniffDelimiter, stripJsonComments, toTree, xmlToValue } from './parse'

test('parseCsv handles quotes, escaped quotes, embedded newlines and CRLF', () => {
  const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\n2,"multi\nline",\n', ',')
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['1', 'x, y', 'say "hi"'],
    ['2', 'multi\nline', '']
  ])
})

test('parseCsv reads tab-separated text and a missing final newline', () => {
  assert.deepEqual(parseCsv('a\tb\n1\t2', '\t'), [
    ['a', 'b'],
    ['1', '2']
  ])
})

test('sniffDelimiter picks the separator that splits the first line most', () => {
  assert.equal(sniffDelimiter('a;b;c\n1;2;3'), ';')
  assert.equal(sniffDelimiter('a,b\n1,2'), ',')
  assert.equal(sniffDelimiter('a\tb\tc'), '\t')
})

test('stripJsonComments removes // and /* */ outside strings and trailing commas', () => {
  const src = '{\n  // note\n  "url": "http://x/*y*/", /* block */\n  "a": [1, 2,],\n}'
  assert.deepEqual(JSON.parse(stripJsonComments(src)), { url: 'http://x/*y*/', a: [1, 2] })
})

test('toTree describes nested values with paths, types and child counts', () => {
  const t = toTree({ name: 'x', list: [1, null, { ok: true }] })
  assert.equal(t.type, 'object')
  assert.equal(t.count, 2)
  const list = t.children![1]
  assert.deepEqual([list.key, list.type, list.count, list.path], ['list', 'array', 3, '$.list'])
  assert.deepEqual(list.children!.map((c) => [c.key, c.type, c.preview]), [
    ['0', 'number', '1'],
    ['1', 'null', 'null'],
    ['2', 'object', '{1}']
  ])
  assert.equal(list.children![2].children![0].path, '$.list[2].ok')
})

test('xmlToValue keeps attributes, repeated elements and text', () => {
  const v = xmlToValue('<root a="1"><item>x</item><item>y</item><empty/></root>')
  assert.deepEqual(v, { root: { '@a': '1', item: ['x', 'y'], empty: '' } })
})
