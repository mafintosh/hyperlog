var hyperlog = require('../')
var tape = require('tape')
var memdb = require('memdb')
var collect = require('stream-collector')

tape('add node', function (t) {
  var hyper = hyperlog(memdb())

  hyper.add(null, 'hello world', function (err, node) {
    t.error(err)
    t.ok(node.key, 'has key')
    t.same(node.links, [])
    t.same(node.value, new Buffer('hello world'))
    t.end()
  })
})

tape('dedup', function (t) {
  var hyper = hyperlog(memdb())

  hyper.add(null, 'hello world', function (err, node) {
    t.error(err)
    hyper.add(null, 'hello world', function (err, node) {
      t.error(err)
      collect(hyper.createReadStream(), function (err, changes) {
        t.error(err)
        t.same(changes.length, 1, 'only one change')
        t.end()
      })
    })
  })
})
