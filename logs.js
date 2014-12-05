var lexint = require('lexicographic-integer')
var through = require('through2')
var from = require('from2')
var collect = require('stream-collector')
var pump = require('pump')

var encode = JSON.stringify
var decode = JSON.parse

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

Logs.prototype.head = function(peer, cb) {
  var rs = this.db.createKeyStream({
    gt: this.prefix+peer+'!',
    lt: this.prefix+peer+'!\xff',
    limit: 1,
    reverse: true
  })

  collect(rs, function(err, keys) {
    if (err) return cb(err)
    if (!keys.length) return cb(null, 0)
    cb(null, lexint.unpack(keys[0].slice(keys[0].lastIndexOf('!')+1), 'hex'))
  })
}

Logs.prototype.entries = function(peer, cb) {
  var self = this

  var rs = this.db.createReadStream({
    gt: this.prefix+peer+'!',
    lt: this.prefix+peer+'!\xff',
    valueEncoding: 'binary'
  })

  var format = function(data, enc, cb) {
    cb(null, {
      peer: data.key.slice(this.prefix.length, data.key.indexOf('!', this.prefix.length)),
      seq: lexint.unpack(data.key.slice(data.key.lastIndexOf('!')+1), 'hex'),
      value: data.value
    })
  }

  return collect(pump(rs, through.obj(format)), cb)
}

Logs.prototype.put = function(peer, seq, value, cb) {
  var key = this.prefix+peer+'!'+lexint.pack(seq, 'hex')
  this.db.put(key, value, cb)
}

Logs.prototype.get = function(peer, seq, cb) {
  var key = this.prefix+peer+'!'+lexint.pack(seq, 'hex')
  this.db.get(key, {valueEncoding:'binary'}, cb)  
}

module.exports = Logs

if (require.main !== module) return

var d = Logs('deltas', require('memdb')())

d.put('hi', 1, new Buffer('lolz'), function() {
  d.put('hello', 1, new Buffer('sup'), function() {
    //d.get('hello', 1, console.log)
    // d.entries('hello').on('data', console.log)
    //d.head('hello', console.log)
    d.peers(console.log)
  })
})