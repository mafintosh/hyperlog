var protocol = require('./protocol')
var resolver = require('./resolver')
var through = require('through2')
var pump = require('pump')
var after = require('after-all')

var heads = function(hyper, each, cb) {
  var prev = null
  var filter = function(head, enc, cb) {
    if (prev === head.log) return cb()
    prev = head.log
    each(head, cb)
  }

  return pump(hyper.heads({reverse:true}), through.obj(filter), cb)
}

module.exports = function(hyper, opts) {
  if (!opts) opts = {}

  // TODO: use the resolver to send remote nodes instead of creating
  // a stream for each log. This makes sure dependent nodes arrive
  // faster.

  var mode = opts.mode || 'sync'
  var localPulling = mode === 'sync' || mode === 'pull'
  var localPushing = mode === 'sync' || mode === 'push'
  var remotePulling = true
  var remotePushing = true

  var stream = protocol()
  var rcvd = resolver(hyper.tmp) // TODO: remove tmp

  var addMissing = function(hyper, node, cb) {
    var next = after(cb)

    node.links.forEach(function(link) {
      var cb = next()
      hyper.logs.tail(link.log, function(err, seq) {
        if (err) return cb(err)

        if (seq >= link.seq || link.log === node.log) return cb()
        rcvd.want(link.log, seq+1, link.seq, function(err, inserted) {
          if (err) return cb(err)

          if (inserted) stream.want({log:link.log, seq:seq}, cb)
          else cb()
        })
      })
    })
  }

  var sendNode = function(node, enc, cb) {
    stream.node(node, cb)
  }

  var sendHave = function(head, cb) {
    stream.have(head, cb)
  }

  var onhaveend = function(cb) {
    rcvd.shift(function loop(err, node) {
      if (err) return stream.destroy(err)

      if (!node) {
        stream.want(null)
        localPulling = false
        if (!remotePulling) stream.end()
        return
      }

      hyper.add(node.links, node.value, {log:node.log}, function(err) {
        if (err) return stream.destroy(err)
        rcvd.shift(loop)
      })
    })

    cb()
  }

  stream.on('have', function(have, cb) {
    if (!localPulling) return cb(new Error('Remote not respecting push'))
    if (!have) return onhaveend(cb)

    hyper.logs.tail(have.log, function(err, seq) {
      if (err) return cb(err)
      if (seq >= have.seq) return cb()

      rcvd.want(have.log, seq+1, have.seq, function(err, inserted) {
        if (err) return cb(err)

        if (inserted) stream.want({log:have.log, seq:seq}, cb)
        else cb()
      })
    })
  })

  stream.on('node', function(node, cb) {
    if (!localPulling) return cb(new Error('Remote not respecting push'))

    addMissing(hyper, node, function(err) {
      if (err) return cb(err)
      rcvd.push(node, cb)
    })
  })

  var onwantend = function(cb) {
    remotePulling = false
    if (!localPulling) stream.end()
    cb()
  }

  stream.on('want', function(want, cb) {
    if (!localPushing) return cb(new Error('Remote not respecting pull'))
    if (!want) return onwantend(cb)

    pump(hyper.logs.createReadStream(want.log, {since:want.seq}), through.obj(sendNode))
    cb()
  })

  stream.once('handshake', function(handshake, cb) {
    if (handshake.version !== 1) return cb(new Error('Protocol version not supported'))

    remotePushing = handshake.mode === 'sync' || handshake.mode === 'push'
    remotePulling = handshake.mode === 'sync' || handshake.mode === 'pull'
    localPulling = localPulling && remotePushing

    if (!localPushing && !remotePushing) return cb(new Error('Remote is not pushing'))
    if (!localPulling && !remotePulling) return cb(new Error('Remote is not pulling'))

    if (remotePulling && localPushing) {
      heads(hyper, sendHave, function(err) {
        if (err) return stream.destroy(err)
        stream.have(null)
      })
    }

    cb()
  })

  hyper.ready(function() {
    stream.handshake({version:1, changes:hyper.change, mode:mode})
  })

  return stream
}