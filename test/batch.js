var hyperlog = require('../')
var tape = require('tape')
var memdb = require('memdb')

tape('batch', function (t) {
  t.plan(10)
  var log = hyperlog(memdb(), { valueEncoding: 'utf8' })
  log.add(null, 'A', function (err, node) {
    t.error(err)
    var ops = [
      { links: [node.key], value: 'B' },
      { links: [node.key], value: 'C' },
      { links: [node.key], value: 'D' }
    ]
    log.batch(ops, function (err, nodes) {
      t.error(err)
      log.get(node.key, function (err, doc) {
        t.error(err)
        t.equal(doc.value, 'A')
      })
      log.get(nodes[0].key, function (err, doc) {
        t.error(err)
        t.equal(doc.value, 'B')
      })
      log.get(nodes[1].key, function (err, doc) {
        t.error(err)
        t.equal(doc.value, 'C')
      })
      log.get(nodes[2].key, function (err, doc) {
        t.error(err)
        t.equal(doc.value, 'D')
      })
    })
  })
})

tape('batch dedupe', function (t) {
  t.plan(6)

  var doc1 = { links: [], value: 'hello world' }
  var doc2 = { links: [], value: 'hello world 2' }

  var hyper = hyperlog(memdb(), { valueEncoding: 'utf8' })

  hyper.batch([doc1], function (err) {
    t.error(err)
    hyper.batch([doc2], function (err) {
      t.error(err)
      hyper.batch([doc1], function (err, nodes) {
        t.error(err)
        t.equal(hyper.changes, 2)
        t.equal(nodes.length, 1)
        t.equal(nodes[0].change, 1)
      })
    })
  })
})

tape('batch dedupe 2', function (t) {
  t.plan(4)

  var doc1 = { links: [], value: 'hello world' }
  var doc2 = { links: [], value: 'hello world 2' }

  var hyper = hyperlog(memdb(), { valueEncoding: 'utf8' })

  hyper.batch([doc1], function (err) {
    t.error(err)
    hyper.batch([doc2], function (err) {
      t.error(err)
      hyper.batch([doc2, doc1, doc2], function (err) {
        t.error(err)
        t.equal(hyper.changes, 2)
      })
    })
  })
})
