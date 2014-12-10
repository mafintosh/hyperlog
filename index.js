var crypto = require('crypto')
var through = require('through2')
var pump = require('pump')
var mutexify = require('mutexify')
var collect = require('stream-collector')
var cuid = require('cuid')
var lexint = require('lexicographic-integer')
var util = require('util')
var events = require('events')
var logs = require('./lib/logs')
var replicate = require('./lib/replicate')
var resolve = require('./lib/resolve')
var keys = require('./lib/keys')

var noop = function() {}

var PEER = 'meta!peer'
var HEAD = 'head!'
var CHANGES = 'changes!'

var peekChanges = function(db, cb) {
  collect(db.createKeyStream({gt:CHANGES, lt:CHANGES+'\xff', limit:1, reverse:true}), function(err, keys) {
    if (err) return cb(err)
    if (!keys.length) return cb(null, 0)
    cb(null, lexint.unpack(keys[0].slice(keys[0].lastIndexOf('!')+1), 'hex'))
  })
}

var Hyperlog = function(db, opts) {
  if (!(this instanceof Hyperlog)) return new Hyperlog(db, opts)
  if (!opts) opts = {}

  events.EventEmitter.call(this)

  this.change = 0
  this.peer = opts.peer || null
  this.lock = mutexify()
  this.db = db
  this.deltas = logs('deltas', db)
  this.graph = logs('graph', db)

  var self = this

  this.lock(function(release) {
    var onpeer = function(peer) {
      peekChanges(db, function(err, changes) {
        if (err) return self.emit('error', err)
        if (!self.peer) self.peer = peer
        if (!self.change) self.change = changes
        release()
      })
    }

    db.get(PEER, {valueEncoding:'utf-8'}, function(err, peer) {
      if (err && !err.notFound) return self.emit('error', err)
      if (peer) return onpeer(peer)
      db.put(PEER, peer = opts.peer || cuid(), function(err) {
        if (err) self.emit('error', err)
        onpeer(peer)
      })
    })
  })
}

util.inherits(Hyperlog, events.EventEmitter)

var hash = function(node) {
  var h = crypto.createHash('sha1')
  var links = [node.peer, node.seq].concat(node.links)
  h.update(node.value)
  h.update(links.join('\n'))
  return h.digest('hex')
}

Hyperlog.prototype.replicate = function() {
  return replicate(this)
}

Hyperlog.prototype.resolve = function(cb) {
  return resolve(this, cb)
}

Hyperlog.prototype.heads = function(opts, cb) {
  if (typeof opts === 'function') return this.heads(null, opts)
  if (!opts) opts = {}

  var rs = this.db.createValueStream({
    gt: HEAD,
    lt: HEAD+'\xff',
    reverse: !!opts.reverse
  })

  return collect(rs, cb)
}

Hyperlog.prototype.get = function(key, cb) {
  var pair = keys.decode(key)

  this.graph.get(pair[0], pair[1], function(err, node) {
    if (err) return cb(err)
    if (key !== node.key) return cb(new Error('checksum mismatch'))
    cb(null, node)
  })
}

Hyperlog.prototype.changes = function(opts) {
  if (!opts) opts = {}

  var self = this

  var rs = this.db.createValueStream({
    gt: CHANGES+lexint.pack(opts.since || 0, 'hex'),
    lt: CHANGES+'\xff',
    reverse: !!opts.reverse
  })

  var get = function(key, enc, cb) {
    self.get(key, cb)
  }

  return pump(rs, through.obj(get))
}

Hyperlog.prototype.add = function(links, value, opts, cb) {
  if (typeof opts === 'function') return this.add(links, value, null, opts)
  if (!opts) opts = {}
  if (!links) links = []
  if (!Array.isArray(links)) links = [links]
  if (!Buffer.isBuffer(value)) value = new Buffer(value)
  if (!cb) cb = noop

  var self = this

  var node = {
    key: null,
    peer: opts.peer || null, // peer opt is only for testing
    seq: 0,
    links: links,
    value: value
  }

  var done = function(err) {
    if (err) return cb(err)
    cb(null, node)
  }

  var i = 0
  var loop = function() { // TODO: check in parallel
    if (i === node.links.length) return self.commit([], node, done)

    var lnk = node.links[i++]
    self.get(lnk, function(err, lnode) {
      if (err || lnode.key !== lnk) return cb(new Error('link '+lnk+' does not exist'))
      loop()
    })
  }

  loop()
}

// TODO: these move to submodule?
// right we just lock the world when doing writes since its easy
// this can easily be optimized later

Hyperlog.prototype.commit = function(batch, node, cb) {
  var self = this
  this.lock(function(release) {
    self.unsafeCommit(batch, node, function(err, node) {
      if (err) return release(cb, err)
      release(cb, null, node)
    })
  })
}

// unsafe since this assumes that is being applied in the right order etc

Hyperlog.prototype.unsafeCommit = function(batch, node, cb) {
  if (!cb) cb = noop

  var self = this

  if (!node.peer) node.peer = this.peer
  node.change = self.change+1

  var check = function() {
    self.get(node.key, function(err, node) {
      if (err) return done()
      cb(null, node)
    })
  }

  var done = function() {
    batch.push({
      type: 'put',
      key: HEAD+node.key,
      value: node.key
    })

    batch.push({
      type: 'put',
      key: CHANGES+lexint.pack(node.change, 'hex'),
      value: node.key
    })

    batch.push({
      type: 'put',
      key: self.graph.key(node.peer, node.seq),
      value: self.graph.value(node)
    })

    self.db.batch(batch, function(err) {
      if (err) return cb(err)
      self.change = node.change
      cb(null, node)
    })
  }

  for (var i = 0; i < node.links.length; i++) {
    var ln = node.links[i]
    batch.push({
      type: 'del',
      key: HEAD+ln
    })
  }

  if (node.seq) return check()

  this.graph.head(node.peer, function(err, seq) {
    if (err) return cb(err)
    node.seq = seq+1
    node.key = keys.encode(node.peer, node.seq, hash(node))
    check()
  })
}

module.exports = Hyperlog