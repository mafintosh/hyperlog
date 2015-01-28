var tape = require('tape')
var hyperlog = require('hyperlog')
var memdb = require('memdb')
var collect = require('stream-collector')

tape('add node', function(t) {
  var hyper = hyperlog(memdb())

  hyper.add(null, 'hello world', function(err, node) {
    t.ok(!err, 'no err')
    t.ok(node.hash, 'has hash')
    t.same(node.links, [])
    t.same(node.value, new Buffer('hello world'))
    t.end()
  })
})

tape('dedup', function(t) {
  var hyper = hyperlog(memdb())

  hyper.add(null, 'hello world', function(err, node) {
    hyper.add(null, 'hello world', function(err, node) {
      collect(hyper.createChangesStream(), function(err, changes) {
        t.same(changes.length, 1, 'only one change')
        t.end()
      })
    })
  })
})