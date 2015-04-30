var after = require('after-all')
var lexint = require('lexicographic-integer')
var collect = require('stream-collector')
var through = require('through2')
var pump = require('pump')
var from = require('from2')
var mutexify = require('mutexify')
var cuid = require('cuid')
var logs = require('level-logs')
var events = require('events')
var util = require('util')
var enumerate = require('level-enumerate')
var replicate = require('./lib/replicate')
var messages = require('./lib/messages')
var hash = require('./lib/hash')

var ID = '!!id'
var CHANGES = '!changes!'
var NODES = '!nodes!'
var HEADS = '!heads!'

var CHECKSUM_MISMATCH = new Error('Checksum mismatch')
var INVALID_LOG = new Error('Invalid log sequence')

INVALID_LOG.notFound = true
INVALID_LOG.status = 404

var noop = function () {}

var Hyperlog = function (db, opts) {
  if (!(this instanceof Hyperlog)) return new Hyperlog(db, opts)
  if (!opts) opts = {}

  events.EventEmitter.call(this)

  this.id = opts.id || null
  this.enumerate = enumerate(db, {prefix: 'enum'})
  this.db = db
  this.logs = logs(db, {prefix: 'logs', valueEncoding: messages.Entry})
  this.lock = mutexify()
  this.changes = 0

  var self = this

  this.lock(function (release) {
    collect(db.createKeyStream({gt: CHANGES, lt: CHANGES + '~', reverse: true, limit: 1}), function (_, keys) {
      self.changes = keys && keys.length ? lexint.unpack(keys[0].split('!').pop(), 'hex') : 0
      if (self.id) return release()
      db.get(ID, {valueEncoding: 'utf-8'}, function (_, id) {
        self.id = id || cuid()
        if (id) return release()
        db.put(ID, self.id, function () {
          release()
        })
      })
    })
  })
}

util.inherits(Hyperlog, events.EventEmitter)

Hyperlog.prototype.ready = function (cb) {
  if (this.id) return cb()
  this.lock(function (release) {
    release()
    cb()
  })
}

Hyperlog.prototype.heads = function (cb) {
  var self = this

  var rs = this.db.createValueStream({
    gt: HEADS,
    lt: HEADS + '~',
    valueEncoding: 'utf-8'
  })

  var format = through.obj(function (key, enc, cb) {
    self.get(key, cb)
  })

  return collect(pump(rs, format), cb)
}

Hyperlog.prototype.get = function (key, cb) {
  this.db.get(NODES + key, {valueEncoding: 'binary'}, function (err, buf) {
    if (err) return cb(err)
    cb(null, messages.Node.decode(buf))
  })
}

var add = function (dag, links, value, opts, cb) {
  var logLinks = []
  var id = opts.log || dag.id

  var next = after(function (err) {
    if (err) return cb(err)

    dag.lock(function (release) {
      dag.logs.head(id, function (err, seq) {
        if (err) return release(cb, err)

        var node = {
          change: dag.changes + 1,
          log: id,
          seq: seq + 1,
          key: hash(links, value),
          value: value,
          links: links
        }

        if (opts.hash && node.key !== opts.hash) return release(cb, CHECKSUM_MISMATCH)
        if (opts.seq && node.seq !== opts.seq) return release(cb, INVALID_LOG)

        var log = {
          change: dag.changes + 1,
          node: node.key,
          links: logLinks
        }

        var onclone = function (clone) {
          if (!opts.log) return release(cb, null, clone)
          dag.db.put(dag.logs.key(node.log, node.seq), messages.Entry.encode(log), function (err) {
            if (err) return release(cb, err)
            release(cb, null, clone)
          })
        }

        dag.get(node.key, function (_, clone) {
          if (clone) return onclone(clone)

          var batch = []
          for (var i = 0; i < links.length; i++) batch.push({type: 'del', key: HEADS + links[i]})
          batch.push({type: 'put', key: CHANGES + lexint.pack(node.change, 'hex'), value: node.key})
          batch.push({type: 'put', key: NODES + node.key, value: messages.Node.encode(node)})
          batch.push({type: 'put', key: HEADS + node.key, value: node.key})
          batch.push({type: 'put', key: dag.logs.key(node.log, node.seq), value: messages.Entry.encode(log)})

          dag.db.batch(batch, function (err) {
            if (err) return release(cb, err)
            dag.changes = node.change
            dag.emit('add')
            release(cb, null, node)
          })
        })
      })
    })
  })

  var nextLink = function () {
    var cb = next()
    return function (err, link) {
      if (err) return cb(err)
      if (link.log !== id && logLinks.indexOf(link.log) === -1) logLinks.push(link.log)
      cb(null)
    }
  }

  for (var i = 0; i < links.length; i++) {
    if (typeof links[i] !== 'string') links[i] = links[i].key
    dag.get(links[i], nextLink())
  }
}

var createLiveStream = function (dag, opts) {
  var since = opts.since || 0
  var wait = null

  var read = function (size, cb) {
    if (dag.changes <= since) {
      wait = cb
      return
    }

    dag.db.get(CHANGES + lexint.pack(since + 1, 'hex'), function (err, hash) {
      if (err) return cb(err)
      dag.get(hash, function (err, node) {
        if (err) return cb(err)
        since = node.change
        cb(null, node)
      })
    })
  }

  var kick = function () {
    if (!wait) return
    var cb = wait
    wait = null
    read(0, cb)
  }

  if (dag.listeners('add') < 1) dag.on('add', kick)
  dag.ready(kick)

  var rs = from.obj(read)

  rs.once('close', function () {
    dag.removeListener('add', kick)
  })

  return rs
}

Hyperlog.prototype.createReadStream = function (opts) {
  if (!opts) opts = {}
  if (opts.live) return createLiveStream(this, opts)

  var self = this
  var since = opts.since || 0
  var until = opts.until || 0

  var keys = this.db.createValueStream({
    gt: CHANGES + lexint.pack(since, 'hex'),
    lt: CHANGES + (until ? lexint.pack(until, 'hex') : '~'),
    valueEncoding: 'utf-8',
    reverse: opts.reverse
  })

  var get = function (key, enc, cb) {
    self.get(key, cb)
  }

  return pump(keys, through.obj(get))
}

Hyperlog.prototype.replicate =
Hyperlog.prototype.createReplicationStream = function (opts) {
  return replicate(this, opts)
}

Hyperlog.prototype.get = function (key, cb) {
  this.db.get(NODES + key, {valueEncoding: messages.Node}, cb)
}

Hyperlog.prototype.add = function (links, value, opts, cb) {
  if (typeof opts === 'function') return this.add(links, value, null, opts)
  if (!cb) cb = noop
  if (!opts) opts = {}
  if (!links) links = []
  if (!Array.isArray(links)) links = [links]
  if (typeof value === 'string') value = new Buffer(value)

  var self = this
  this.ready(function () {
    add(self, links, value, opts, cb)
  })
}

module.exports = Hyperlog
