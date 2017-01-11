var hyperlog = require('../')
var tape = require('tape')
var memdb = require('memdb')

tape('sign', function (t) {
  t.plan(4)

  var log = hyperlog(memdb(), {
    identity: new Buffer('i-am-a-public-key'),
    sign: function (node, cb) {
      t.same(node.value, new Buffer('hello'), 'sign is called')
      cb(null, new Buffer('i-am-a-signature'))
    }
  })

  log.add(null, 'hello', function (err, node) {
    t.error(err, 'no err')
    t.same(node.signature, new Buffer('i-am-a-signature'), 'has signature')
    t.same(node.identity, new Buffer('i-am-a-public-key'), 'has public key')
    t.end()
  })
})

tape('sign fails', function (t) {
  t.plan(2)

  var log = hyperlog(memdb(), {
    identity: new Buffer('i-am-a-public-key'),
    sign: function (node, cb) {
      cb(new Error('lol'))
    }
  })

  log.on('reject', function (node) {
    t.ok(node)
  })

  log.add(null, 'hello', function (err) {
    t.same(err && err.message, 'lol', 'had error')
  })
})

tape('verify', function (t) {
  t.plan(3)

  var log1 = hyperlog(memdb(), {
    identity: new Buffer('i-am-a-public-key'),
    sign: function (node, cb) {
      cb(null, new Buffer('i-am-a-signature'))
    }
  })

  var log2 = hyperlog(memdb(), {
    verify: function (node, cb) {
      t.same(node.signature, new Buffer('i-am-a-signature'), 'verify called with signature')
      t.same(node.identity, new Buffer('i-am-a-public-key'), 'verify called with public key')
      cb(null, true)
    }
  })

  log1.add(null, 'hello', function (err, node) {
    t.error(err, 'no err')
    var stream = log2.replicate()
    stream.pipe(log1.replicate()).pipe(stream)
  })
})

tape('verify fails', function (t) {
  t.plan(2)

  var log1 = hyperlog(memdb(), {
    identity: new Buffer('i-am-a-public-key'),
    sign: function (node, cb) {
      cb(null, new Buffer('i-am-a-signature'))
    }
  })

  var log2 = hyperlog(memdb(), {
    verify: function (node, cb) {
      cb(null, false)
    }
  })

  log1.add(null, 'hello', function (err, node) {
    t.error(err, 'no err')

    var stream = log2.replicate()

    stream.on('error', function (err) {
      t.same(err.message, 'Invalid signature', 'stream had error')
      t.end()
    })
    stream.pipe(log1.replicate()).pipe(stream)
  })
})

tape('per-document identity (add)', function (t) {
  t.plan(3)

  var log1 = hyperlog(memdb(), {
    sign: function (node, cb) {
      cb(null, new Buffer('i-am-a-signature'))
    }
  })

  var log2 = hyperlog(memdb(), {
    verify: function (node, cb) {
      t.same(node.signature, new Buffer('i-am-a-signature'), 'verify called with signature')
      t.same(node.identity, new Buffer('i-am-a-public-key'), 'verify called with public key')
      cb(null, true)
    }
  })

  var opts = { identity: new Buffer('i-am-a-public-key') }
  log1.add(null, 'hello', opts, function (err, node) {
    t.error(err, 'no err')
    var stream = log2.replicate()
    stream.pipe(log1.replicate()).pipe(stream)
  })
})

tape('per-document identity (batch)', function (t) {
  t.plan(5)

  var log1 = hyperlog(memdb(), {
    sign: function (node, cb) {
      cb(null, new Buffer('i-am-a-signature'))
    }
  })

  var expectedpk = [ Buffer('hello id'), Buffer('whatever id') ]
  var log2 = hyperlog(memdb(), {
    verify: function (node, cb) {
      t.same(node.signature, new Buffer('i-am-a-signature'), 'verify called with signature')
      t.same(node.identity, expectedpk.shift(), 'verify called with public key')
      cb(null, true)
    }
  })

  log1.batch([
    {
      value: 'hello',
      identity: Buffer('hello id')
    },
    {
      value: 'whatever',
      identity: Buffer('whatever id')
    }
  ], function (err, nodes) {
    t.error(err, 'no err')
    var stream = log2.replicate()
    stream.pipe(log1.replicate()).pipe(stream)
  })
})
