var hyperlog = require('../')
var tape = require('tape')
var memdb = require('memdb')

tape('add and preadd events', function (t) {
  t.plan(12)
  var hyper = hyperlog(memdb())
  var expected = [ 'hello', 'world' ]
  var expectedPre = [ 'hello', 'world' ]
  var order = []

  hyper.add(null, 'hello', function (err, node) {
    t.error(err)
    hyper.add(node, 'world', function (err, node2) {
      t.error(err)
      t.ok(node2.key, 'has key')
      t.same(node2.links, [node.key], 'has links')
      t.same(node2.value, new Buffer('world'))
      t.deepEqual(order, [
        'preadd hello',
        'add hello',
        'preadd world',
        'add world'
      ], 'order')
    })
  })
  hyper.on('add', function (node) {
    // at this point, the event has already been added
    t.equal(node.value.toString(), expected.shift())
    order.push('add ' + node.value)
  })
  hyper.on('preadd', function (node) {
    t.equal(node.value.toString(), expectedPre.shift())
    order.push('preadd ' + node.value)
    hyper.get(node.key, function (err) {
      t.ok(err.notFound)
    })
  })
})
