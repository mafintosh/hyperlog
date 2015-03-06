var through = require('through2')
var pump = require('pump')
var bitfield = require('bitfield')
var protocol = require('./protocol')
var sortedQueue = require('./sorted-queue')

var noop = function () {}
var noarr = []

var MAX_BITFIELD = 10 * 1024 * 1024 // arbitrary high number

module.exports = function (dag, opts) {
  if (!opts) opts = {}

  var stream = protocol()
  var mode = opts.mode || 'sync'

  var pushing = bitfield(1024, {grow: MAX_BITFIELD})

  var changes = 0
  var missing = 0

  var ended = false
  var remoteSentWants = false
  var remoteSentHeads = false
  var localSentWants = false
  var localSentHeads = false

  var outgoing = sortedQueue()
  var incoming = sortedQueue()

  outgoing.pull(function loop (entry) {
    dag.get(entry.node, function (err, node) {
      if (err) return stream.destroy(err)
      stream.emit('push')
      stream.node(node, function (err) {
        if (err) return stream.destroy(err)
        sendNode(node.log, node.seq + 1, function (err) {
          if (err) return stream.destroy(err)
          outgoing.pull(loop)
        })
      })
    })
  })

  var update = function (cb) {
    if (ended) return cb()
    if (!localSentWants || !localSentHeads || !remoteSentWants || !remoteSentHeads) return cb()
    ended = true
    stream.end(cb)
  }

  var sentWants = function (cb) {
    localSentWants = true
    stream.sentWants()
    update(cb)
  }

  var sentHeads = function (cb) {
    localSentHeads = true
    stream.sentHeads()
    update(cb)
  }

  var sendNode = function (log, seq, cb) {
    dag.logs.get(log, seq, function (err, entry) {
      if (err && err.notFound) return cb()
      if (err) return cb(err)
      if (entry.change > changes) return cb() // ensure snapshot

      var i = 0
      var loop = function () {
        if (i < entry.links.length) return sendHave(entry.links[i++], loop)
        entry.links = noarr // premature opt: less mem yo
        outgoing.push(entry, cb)
      }

      loop()
    })
  }

  var receiveNode = function (node, cb) {
    dag.add(node.links, node.value, {hash: node.key, log: node.log}, function (err) {
      if (!err) return afterAdd(cb)
      if (!err.notFound) return cb(err)
      incoming.push(node, cb)
    })
  }

  var afterAdd = function (cb) {
    stream.emit('pull')
    if (!--missing) return sentWants(cb)
    if (!incoming.length) return cb()
    incoming.pull(function (node) {
      receiveNode(node, cb)
    })
  }

  var sendHave = function (log, cb) {
    dag.enumerate(log, function (err, idx) {
      if (err) return cb(err)

      if (pushing.get(idx)) return cb()
      pushing.set(idx, true)

      dag.logs.head(log, function (err, seq) {
        if (err) return cb(err)
        dag.logs.get(log, seq, function loop (err, entry) { // ensure snapshot
          if (err && err.notFound) return cb()
          if (err) return cb(err)
          if (entry.change > changes) return dag.logs.get(log, seq - 1, loop)
          stream.have({log: log, seq: seq}, cb)
        })
      })
    })
  }

  stream.once('sentHeads', function (cb) {
    if (!missing) sentWants(noop)
    remoteSentHeads = true
    update(cb)
  })

  stream.once('sentWants', function (cb) {
    remoteSentWants = true
    update(cb)
  })

  stream.on('want', function (head, cb) {
    sendNode(head.log, head.seq + 1, cb)
  })

  stream.on('have', function (head, cb) {
    dag.logs.head(head.log, function (err, seq) {
      if (err) return cb(err)
      if (seq >= head.seq) return cb()
      missing += (head.seq - seq)
      stream.want({log: head.log, seq: seq}, cb)
    })
  })

  stream.on('node', receiveNode)

  // start the handshake

  stream.on('handshake', function (handshake, cb) {
    var remoteMode = handshake.mode

    if (remoteMode !== 'pull' && remoteMode !== 'push' && remoteMode !== 'sync') return cb(new Error('Remote uses invalid mode: ' + remoteMode))
    if (remoteMode === 'pull' && mode === 'pull') return cb(new Error('Remote and local are both pulling'))
    if (remoteMode === 'push' && mode === 'push') return cb(new Error('Remote and local are both pushing'))

    remoteSentWants = remoteMode === 'push'
    remoteSentHeads = remoteMode === 'pull'
    localSentWants = mode === 'push' || remoteMode === 'pull'
    localSentHeads = mode === 'pull' || remoteMode === 'push'

    if (localSentHeads) return cb()

    var write = function (node, enc, cb) {
      sendHave(node.log, cb)
    }

    dag.lock(function (release) { // TODO: don't lock here. figure out how to snapshot the heads to a change instead
      changes = dag.changes

      var free = function () {
        stream.removeListener('close', free)
        stream.removeListener('finish', free)
        free = noop
        release()
      }

      stream.on('close', free)
      stream.on('finish', free)

      pump(dag.heads(), through.obj(write), function (err) {
        free()
        if (err) return cb(err)
        sentHeads(cb)
      })
    })
  })

  stream.handshake({version: 1, mode: opts.mode, metadata: opts.metadata})

  return stream
}
