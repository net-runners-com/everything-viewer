import { assert, test } from 'orca/testing'
import { stripJsonComments, toTree, xmlToValue } from './parse'

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
