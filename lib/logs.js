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

Logs.prototype.names = function(cb) {
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

Logs.prototype.tail = function(name, cb) {
  var rs = this.db.createKeyStream({
    gt: this.prefix+name+'!',
    lt: this.prefix+name+'!\xff',
    limit: 1,
    reverse: true
  })

  collect(rs, function(err, keys) {
    if (err) return cb(err)
    if (!keys.length) return cb(null, 0)
    cb(null, lexint.unpack(keys[0].slice(keys[0].lastIndexOf('!')+1), 'hex'))
  })
}

Logs.prototype.get = function(name, seq, cb) {
  this.db.get(this.key(name, seq), {valueEncoding:'binary'}, function(err, node) {
    if (err) return cb(err)
    cb(null, messages.Node.decode(node))
  })
}

Logs.prototype.createReadStream = function(name, opts, cb) {
  if (typeof opts === 'function') return this.nodes(name, null, opts)
  if (!opts) opts = {}

  var self = this
  var values = opts.values !== false
  var gt = this.prefix+name+'!'+(opts.since ? lexint.pack(opts.since, 'hex') : '')
  var lt = this.prefix+name+'!'+(opts.until ? lexint.pack(opts.until, 'hex') : '\xff')

  var rs = values ?
    this.db.createValueStream({gt:gt, lt:lt, valueEncoding:'binary'}) :
    this.db.createKeyStream({gt:gt, lt:lt})

  var format = values ?
    function(data, enc, cb) {
      cb(null, messages.Node.decode(data))
    } :
    function(data, enc, cb) {
      var key = data.slice(self.prefix.length)
      var name = key.slice(0, key.indexOf('!'))
      var seq = lexint.unpack(key.slice(name.length+1), 'hex')

      cb(null, {log:name, seq:seq})
    }

  return collect(pump(rs, through.obj(format)), cb)
}

Logs.prototype.value = function(node) {
  return messages.Node.encode(node)
}

Logs.prototype.key = function(name, seq) {
  return this.prefix+name+'!'+lexint.pack(seq, 'hex')
}

module.exports = Logs
