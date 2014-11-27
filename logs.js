var crypto = require('crypto')
var lexint = require('lexicographic-integer')
var pump = require('pump')
var through = require('through2')
var from = require('from2')
var collect = require('stream-collector')

var LOGS = 'logs!'

// this could probably go into a new module ...

var Logs = function(db) {
  if (!(this instanceof Logs)) return new Logs(db)
  this.db = db
}

Logs.prototype.peers = function(cb) {
  var self = this
  var ptr = LOGS

  var rs = from.obj(function(size, cb) {
    var keys = self.db.createKeyStream({
      gt: ptr,
      lt: LOGS+'\xff',
      limit: 1
    })
    
    collect(keys, function(err, keys) {
      if (err) return cb(err)
      if (!keys.length) return cb(null, null)

      var peer = keys[0].slice(LOGS.length, keys[0].lastIndexOf('!'))
      ptr = LOGS+peer+'!\xff'
      cb(null, peer)
    })
  })

  return collect(rs, cb)
}

Logs.prototype.entries = function(peer, opts, cb) {
  if (typeof opts === 'function') return this.entries(peer, null, opts)
  if (!opts) opts = {}

  var rs = this.db.createReadStream({
    gt: LOGS+peer+'!'+lexint.pack(opts.since || 0, 'hex'),
    lt: LOGS+peer+'!\xff'
  })

  var format = through.obj(function(data, enc, cb) {
    var sep = data.key.lastIndexOf('!')
    var seq = lexint.unpack(data.key.slice(sep+1), 'hex')
    var peer = data.key.slice(LOGS.length, sep)

    cb(null, {
      peer: peer,
      seq: seq,
      entry: data.value
    })
  })

  return collect(pump(rs, format), cb)
}

Logs.prototype.head = function(peer, cb) {
  var rs = this.db.createKeyStream({
    gt: LOGS+peer+'!',
    lt: LOGS+peer+'!\xff',
    reverse: true,
    limit: 1
  })

  collect(rs, function(err, keys) {
    if (err) return cb(err)
    if (!keys.length) return cb(null, 0)
    cb(null, lexint.unpack(keys[0].slice(keys[0].lastIndexOf('!')+1), 'hex'))
  })
}

Logs.prototype.get = function(peer, seq, cb) {
  this.db.get(LOGS+peer+'!'+lexint.pack(seq, 'hex'), {valueEncoding:'binary'}, cb)
}

Logs.prototype.put = function(peer, seq, data, cb) {
  this.db.put(LOGS+peer+'!'+lexint.pack(seq, 'hex'), data, cb)
}

module.exports = Logs