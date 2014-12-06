var crypto = require('crypto')
var through = require('through2')
var pump = require('pump')
var collect = require('stream-collector')
var logs = require('./logs')
var replicate = require('./replicate')
var resolve = require('./resolve')
var encoding = require('./encoding')

var noop = function() {}

var HEAD = 'head!'

var Vector = function(db, opts) {
  if (!(this instanceof Vector)) return new Vector(db, opts)
  if (!opts) opts = {}

  if (!opts.id) throw new Error('id is currently required')

  this.id = opts.id
  this.db = db
  this.deltas = logs('deltas', db)
  this.graph = logs('graph', db)
}

var hash = function(node) {
  var h = crypto.createHash('sha1')
  var links = [node.peer, node.seq].concat(node.links)
  h.update(node.value)
  h.update(links.join('\n'))
  return h.digest('hex')
}

Vector.prototype.replicate = function() {
  return replicate(this)
}

Vector.prototype.resolve = function(cb) {
  return resolve(this, cb)
}

Vector.prototype.heads = function(cb) {
  var rs = this.db.createReadStream({
    gt: HEAD,
    lt: HEAD+'\xff'
  })

  var format = function(data, enc, cb) {
    cb(null, {
      peer: data.key.slice(HEAD.length),
      seq: parseInt(data.value, 10)
    })
  }

  return collect(pump(rs, through.obj(format)), cb)
}

Vector.prototype.get = function(key, cb) {
  var peer = key.slice(0, key.indexOf('!'))
  var seq = parseInt(key.slice(peer.length+1, key.indexOf('!', peer.length+1)), 16)

  this.graph.get(peer, seq, function(err, node) {
    if (err) return cb(err)
    cb(null, encoding.node.decode(node))
  })
}

Vector.prototype.add = function(links, value, opts, cb) {
  if (typeof opts === 'function') return this.add(links, value, null, opts)
  if (!opts) opts = {}
  if (!links) links = []
  if (!Array.isArray(links)) links = [links]
  if (!cb) cb = noop

  var self = this

  var node = {
    key: null,
    peer: opts.peer || this.id, // peer opt is only for testing
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

// move to submodule?
// assumes that is being applied in the right order etc
Vector.prototype.commit = function(batch, node, cb) {
  if (!cb) cb = noop

  var self = this

  var done = function() {
    batch.push({
      type: 'put',
      key: HEAD+node.peer,
      value: ''+node.seq
    })

    batch.push({
      type: 'put',
      key: self.graph.key(node.peer, node.seq),
      value: encoding.node.encode(node)
    })

    self.db.batch(batch, function(err) {
      if (err) return cb(err)
      cb(null, node)
    })
  }

  var i = 0
  var loop = function() {
    if (i >= node.links.length) return done()

    var ln = node.links[i++]
    var peer = ln.slice(0, ln.indexOf('!'))
    var seq = parseInt(ln.slice(peer.length+1, ln.indexOf('!', peer.length+1)), 10)

    self.db.get(HEAD+peer, function(_, head) {
      head = head ? parseInt(head, 10) : 0
      if (head === seq) batch.push({type: 'del', key: HEAD+peer})
      loop(i+1)
    })
  }

  if (node.seq) return loop()

  this.graph.head(node.peer, function(err, seq) {
    if (err) return cb(err)
    node.seq = seq+1
    node.key = node.peer+'!'+node.seq.toString(16)+'!'+hash(node)
    loop()
  })
}

module.exports = Vector