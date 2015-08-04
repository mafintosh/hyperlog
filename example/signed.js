var hyperlog = require('../')
var memdb = require('memdb')
var sodium = require('sodium').api
var eq = require('buffer-equals')

var keys = sodium.crypto_sign_keypair()
var log = hyperlog(memdb(), {
  identity: keys.publicKey,
  sign: function (node, cb) {
    var bkey = Buffer(node.key, 'hex')
    cb(null, sodium.crypto_sign(bkey, keys.secretKey))
  }
})
var clone = hyperlog(memdb(), {
  verify: function (node, cb) {
    if (!node.signature) return cb(null, false)
    if (!eq(node.identity, keys.publicKey)) return cb(null, false)
    var bkey = Buffer(node.key, 'hex')
    var m = sodium.crypto_sign_open(node.signature, node.identity)
    cb(null, eq(m, bkey))
  }
})

var sync = function (a, b) {
  a = a.createReplicationStream({mode: 'push'})
  b = b.createReplicationStream({mode: 'pull'})

  a.on('push', function () {
    console.log('a pushed')
  })

  a.on('pull', function () {
    console.log('a pulled')
  })

  a.on('end', function () {
    console.log('a ended')
  })

  b.on('push', function () {
    console.log('b pushed')
  })

  b.on('pull', function () {
    console.log('b pulled')
  })

  b.on('end', function () {
    console.log('b ended')
  })

  a.pipe(b).pipe(a)
}

clone.createReadStream({live: true}).on('data', function (data) {
  console.log('change: (%d) %s', data.change, data.key)
})

log.add(null, 'hello', function (err, node) {
  if (err) throw err
  log.add(node, 'world', function (err, node) {
    if (err) throw err
    sync(log, clone)
    log.add(null, 'meh')
  })
})
