var hyperlog = require('../')
var tape = require('tape')
var memdb = require('memdb')
var collect = require('stream-collector')

tape('changes', function (t) {
  var hyper = hyperlog(memdb())

  hyper.add(null, 'a', function (err, a) {
    t.error(err)
    hyper.add(null, 'b', function (err, b) {
      t.error(err)
      hyper.add(null, 'c', function (err, c) {
        t.error(err)
        collect(hyper.createReadStream(), function (err, changes) {
          t.error(err)
          t.same(changes, [a, b, c], 'has 3 changes')
          t.end()
        })
      })
    })
  })
})

tape('changes since', function (t) {
  var hyper = hyperlog(memdb())

  hyper.add(null, 'a', function (err, a) {
    t.error(err)
    hyper.add(null, 'b', function (err, b) {
      t.error(err)
      hyper.add(null, 'c', function (err, c) {
        t.error(err)
        collect(hyper.createReadStream({since: 2}), function (err, changes) {
          t.error(err)
          t.same(changes, [c], 'has 1 change')
          t.end()
        })
      })
    })
  })
})

tape('live changes', function (t) {
  var hyper = hyperlog(memdb())
  var expects = ['a', 'b', 'c']

  hyper.createReadStream({live: true})
    .on('data', function (data) {
      var next = expects.shift()
      t.same(data.value.toString(), next, 'was expected value')
      if (!expects.length) t.end()
    })

  hyper.add(null, 'a', function () {
    hyper.add(null, 'b', function () {
      hyper.add(null, 'c')
    })
  })
})

tape('parallel add orders changes', function (t) {
  var hyper = hyperlog(memdb())

  var missing = 3
  var values = {}
  var done = function () {
    if (--missing) return
    collect(hyper.createReadStream(), function (err, changes) {
      t.error(err)
      changes.forEach(function (c, i) {
        t.same(c.change, i + 1, 'correct change number')
        values[c.value.toString()] = true
      })
      t.same(values, {a: true, b: true, c: true}, 'contains all values')
      t.end()
    })
  }

  hyper.add(null, 'a', done)
  hyper.add(null, 'b', done)
  hyper.add(null, 'c', done)
})
