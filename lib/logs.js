var lexint = require('lexicographic-integer')
var through = require('through2')
var from = require('from2')
var collect = require('stream-collector')
var pump = require('pump')
var messages = require('./messages')

var Logs = function(prefix, db) {
  if (!(this instanceof Logs)) return new Logs(prefix, db)
  this.prefix = prefix+'!'
  this.db = db
}

Logs.prototype.peers = function(cb) {
  var self = this
  var prev = null

  var rs = from.obj(function(size, cb) {
    var keys = self.db.createKeyStream({
      gt: self.prefix+(prev ? prev+'!\xff' : ''),
      lt: self.prefix+'\xff',
      limit: 1
    })

    collect(keys, function(err, list) {
      if (err) return cb(err)
      if (!list.length) return cb(null, null)
      prev = list[0].slice(self.prefix.length, list[0].indexOf('!', self.prefix.length))
      cb(null, prev)
    })
  })

  return collect(rs, cb)
}

var peek = function(self, peer, reverse, cb) {
  var rs = self.db.createKeyStream({
    gt: self.prefix+peer+'!',
    lt: self.prefix+peer+'!\xff',
    limit: 1,
    reverse: reverse
  })

  collect(rs, function(err, keys) {
    if (err) return cb(err)
    if (!keys.length) return cb(null, 0)
    cb(null, lexint.unpack(keys[0].slice(keys[0].lastIndexOf('!')+1), 'hex'))
  })  
}

Logs.prototype.tail = function(peer, cb) {
  peek(this, peer, false, cb)
}

Logs.prototype.head = function(peer, cb) {
  peek(this, peer, true, cb)
}

Logs.prototype.get = function(peer, seq, cb) {
  this.db.get(this.key(peer, seq), {valueEncoding:'binary'}, function(err, node) {
    if (err) return cb(err)
    cb(null, messages.Node.decode(node))
  }) 
}

Logs.prototype.nodes = function(peer, opts, cb) {
  if (typeof opts === 'function') return this.nodes(peer, null, opts)
  if (!opts) opts = {}

  var self = this
  var values = opts.values !== false
  var gt = this.prefix+peer+'!'+(opts.since ? lexint.pack(opts.since, 'hex') : '')
  var lt = this.prefix+peer+'!'+(opts.until ? lexint.pack(opts.until, 'hex') : '\xff')

  var rs = values ? 
    this.db.createValueStream({gt:gt, lt:lt, valueEncoding:'binary'}) :
    this.db.createKeyStream({gt:gt, lt:lt})

  var format = values ? 
    function(data, enc, cb) {
      cb(null, messages.Node.decode(data))
    } : 
    function(data, enc, cb) {
      var key = data.slice(self.prefix.length)
      var peer = key.slice(0, key.indexOf('!'))
      var seq = lexint.unpack(key.slice(peer.length+1), 'hex')

      cb(null, {peer:peer, seq:seq})
    }

  return collect(pump(rs, through.obj(format)), cb)  
}

Logs.prototype.value = function(node) {
  return messages.Node.encode(node)
}

Logs.prototype.key = function(peer, seq) {
  return this.prefix+peer+'!'+lexint.pack(seq, 'hex')
}

module.exports = Logs
