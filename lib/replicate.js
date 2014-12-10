var through = require('through2')
var pump = require('pump')
var lexint = require('lexicographic-integer')
var protocol = require('./protocol')
var stack = require('./stack')

var noop = function() {}

var replicate = function(log) {
  var stream = protocol()

  var amFinalized = false
  var remoteFinalized = false
  var dones = 1

  var wanting = {} // TODO: implement log parallel want limit
  var want = function(peer, remote, cb) {
    if (wanting[peer]) return cb()
    wanting[peer] = true

    // TODO: check+walk deltas as well
    log.graph.head(peer, function(err, seq) {
      if (err) return cb(err)
      if (seq >= remote) return cb()

      dones++
      stream.want({peer:peer, seq:seq}, cb)
    })
  }

  stream.on('node', function(node, cb) {
    var done = function() {
      var key = log.deltas.key(node.peer, node.seq)
      var value = log.deltas.value(node)
      log.db.put(key, value, cb)
    }

    var i = 0
    var loop = function() {
      if (i >= node.links.length) return done()

      var ln = node.links[i++]
      var peer = ln.slice(0, ln.indexOf('!'))
      var seq = lexint.unpack(ln.slice(peer.length+1, ln.indexOf('!', peer.length+1)), 'hex')

      want(peer, seq, loop)
    }

    loop()
  })

  var finalize = function(cb) {
    if (!--finalizes) stream.end()
    cb()
  }

  stream.on('finalize', function(cb) {
    remoteFinalized = true
    if (amFinalized) stream.end()
    cb()
  })

  stream.on('done', function(cb) {
    if (--dones) return cb()
    amFinalized = true
    if (remoteFinalized) stream.end()
    stream.finalize(cb)
  })

  stream.on('have', function(have, cb) {
    want(have.peer, have.seq, cb)
  })

  stream.on('want', function(want, cb) {
    var nodes = log.graph.nodes(want.peer, {since:want.seq})

    nodes.on('end', function() {
      stream.done()
    })

    pump(nodes, through.obj(node))
    cb()
  })

  var node = function(node, enc, cb) {
    stream.node(node, cb)
  }

  var prev
  var have = function(head, enc, cb) {
    var peer = head.slice(0, head.indexOf('!'))
    var seq = lexint.unpack(head.slice(peer.length+1, head.indexOf('!', peer.length+1)), 'hex')

    if (prev === peer) return cb()
    prev = peer

    stream.have({peer:peer, seq:seq}, cb)
  }

  pump(log.heads({reverse:true}), through.obj(have), function() {
    stream.done()
  })

  return stream
}

module.exports = replicate
