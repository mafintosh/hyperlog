var crypto = require('crypto')
var lexint = require('lexicographic-integer')
var collect = require('stream-collector')
var pump = require('pump')
var through = require('through2')
var from = require('from2')

var PEERS = 'peers!'
var HEADS = 'heads!'

var noop = function() {}

var encode = JSON.stringify
var decode = JSON.parse

var Graph = function(db, opts) {
  if (!(this instanceof Graph)) return new Graph(db, opts)
  if (!opts) opts = {}
  this.db = db
}

Graph.prototype.validate = function(node, cb) {
  var self = this

  var loop = function(i) {
    if (i >= node.links.length) return cb()
    var link = node.links[i]
    self.db.get(PEERS+link, function(err) {
      if (err) return cb(err)
      loop(++i)
    })
  }

  loop(0)
}

Graph.prototype.peers = function() {
  var self = this
  var prev = null
  var len = PEERS.length

  return from.obj(function(size, cb) {
    var rs = self.db.createKeyStream({
      limit: 1,
      gt: PEERS+(prev ? prev+'!\xff' : ''),
      lt: PEERS+'\xff'
    })

    collect(rs, function(err, keys) {
      if (err) return cb(err)
      if (!keys.length) return cb(null, null)

      prev = keys[0].slice(len, keys[0].indexOf('!', len))
      cb(null, prev)
    })
  })
}

Graph.prototype.nodes = function(peer, since) {
  var format = function(data, enc, cb) {
    cb(null, decode(data))
  }

  return pump(this.db.createValueStream({gt:PEERS+(since || peer+'!'), lt:PEERS+peer+'!\xff'}), through.obj(format))
}

Graph.prototype.get = function(key, cb) {
  this.db.get(PEERS+key, function(err, value) {
    if (err) return cb(err)
    cb(null, decode(value))
  })
}

Graph.prototype.head = function(peer, cb) { // TODO: cache!!
  var rs = this.db.createKeyStream({limit:1, gt:PEERS+peer+'!', lt:PEERS+peer+'!\xff'})
  collect(rs, function(err, keys) {
    if (err) return cb(err)
    cb(null, keys.length ? keys[0].slice(PEERS.length) : null)
  })
}

Graph.prototype.heads = function() {
  return this.db.createValueStream({gt:HEADS, lt:'heads!\xff'})
}

Graph.prototype.put = function(node, cb) {
  if (!cb) cb = noop
  if (!node.links) node.links = []

  var self = this
  var info = (node.links || []).concat(node.peer, node.seq).join('\n')
  var hash = crypto.createHash('sha1')
  
  hash.update(node.value)
  hash.update(info)

  node.key = node.peer+'!'+lexint.pack(node.seq, 'hex')+'!'+hash.digest('hex')

  this.head(node.peer, function(err, head) {
    if (err) return cb(err)

    var batch = []
    if (head) batch.push({type:'del', key:HEADS+head})
    for (var i = 0; i < node.links.length; i++) batch.push({type:'del', key:HEADS+node.links[i]})
    batch.push({type:'put', key:PEERS+node.key, value:encode(node)})
    batch.push({type:'put', key:HEADS+node.key, value:node.key})

    self.db.batch(batch, function(err) {
      if (err) return cb(err)
      cb(null, node)
    })    
  })

}

module.exports = Graph