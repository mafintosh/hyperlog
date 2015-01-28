var after = require('after-all')
var through = require('through2')
var pump = require('pump')
var lexint = require('lexicographic-integer')
var mutexify = require('mutexify')
var collect = require('stream-collector')
var crypto = require('crypto')
var cuid = require('cuid')
var events = require('events')
var util = require('util')
var from = require('from2')
var logs = require('./lib/logs')
var replicator = require('./lib/replicator')

var ID = 'id!'
var CHANGES = 'changes!'
var NODE = 'node!'
var HEAD = 'head!'

var noop = function() {}

var Hyperlog = function(db, opts) {
  if (!(this instanceof Hyperlog)) return new Hyperlog(db, opts)
  if (!opts) opts = {}

  events.EventEmitter.call(this)

  this.id = opts.id
  this.db = db
  this.change = -1
  this.logs = logs('logs', db)
  this.tmp = logs('tmp', db)
  this.lock = mutexify()
  this.setMaxListeners(0)

  var self = this
  this.lock(function(release) {
    var onid = function(err) {
      if (err) return self.emit('error', err)
      collect(db.createKeyStream({gt:CHANGES, lt:CHANGES+'\xff', limit:1, reverse:true}), function(err, keys) {
        if (err) return self.emit('error', err)
        self.change = keys.length ? lexint.unpack(keys[0].slice(CHANGES.length), 'hex') : 0
        self.emit('ready')
        release()
      })
    }

    db.get(ID, {valueEncoding:'utf-8'}, function(err, id) {
      if (err && !err.notFound) return onid(err)
      self.id = id || opts.id || cuid()
      if (self.id === id) return onid()
      db.put(ID, self.id, onid)
    })
  })
}

util.inherits(Hyperlog, events.EventEmitter)

var getRef = function(self, ref, cb) {
  var i = ref.indexOf('!')
  self.logs.get(ref.slice(0, i), lexint.unpack(ref.slice(i+1), 'hex'), cb)
}

Hyperlog.prototype.ready = function(cb) {
  if (this.change >= 0) return cb()
  this.once('ready', cb)
}

Hyperlog.prototype.createChangesStream = function(opts) {
  if (!opts) opts = {}

  var self = this
  var since = opts.since || 0
  var live = !!opts.live
  var tail = !!opts.tail

  var wait
  var notify = function() {
    if (!wait) return
    var cb = wait
    wait = null
    read(0, cb)
  }

  var read = function(size, cb) {
    if (tail) {
      tail = false
      self.lock(function(release) {
        read(size, cb)
        release()
      })
      return
    }

    self.db.get(CHANGES+lexint.pack(since+1, 'hex'), function(err, ref) {
      if (err && !err.notFound) return cb(err)

      if (err) {
        if (self.change > since) return read(size, cb)
        wait = cb
        return
      }

      since++
      cb(null, ref)
    })
  }

  var rs

  if (live) {
    rs = from.obj(read)
    if (tail) {
      self.lock(function(release) {
        since = self.change
        release()
      })
    }
    self.on('add', notify)
    rs.on('close', function() {
      self.removeListener('add', notify)
    })
  } else {
    rs = self.db.createValueStream({
      gt:CHANGES+lexint.pack(since, 'hex'),
      lt:CHANGES+'\xff',
      reverse: opts.reverse
    })
  }

  var format = through.obj(function(ref, enc, cb) {
    getRef(self, ref, cb)
  })

  return pump(rs, format)
}

Hyperlog.prototype.heads = function(opts, cb) {
  if (typeof opts === 'function') return this.heads(null, opts)
  if (!opts) opts = {}

  var self = this
  var values = opts.values !== false
  var rs = this.db.createValueStream({
    reverse: opts.reverse,
    gt: HEAD,
    lt: HEAD+'\xff',
    valueEncoding: 'utf-8'
  })

  var format = function(ref, enc, cb) {
    var i = ref.indexOf('!')
    var log = ref.slice(0, i)
    var seq = lexint.unpack(ref.slice(i+1), 'hex')
    if (values) self.logs.get(log, seq, cb)
    else cb(null, {log:log, seq:seq})
  }

  return collect(pump(rs, through.obj(format)), cb)
}

Hyperlog.prototype.createReplicationStream = function(opts) {
  return replicator(this, opts)
}

Hyperlog.prototype.get = function(hash, cb) {
  var self = this
  this.db.get(NODE+hash, {valueEncoding:'utf-8'}, function(err, ref) {
    if (err) return cb(err)
    getRef(self, ref, cb)
  })
}

var hash = function(value, links) {
  var sha = crypto.createHash('sha1')

  sha.update(''+value.length+'\n')
  sha.update(value)
  for (var i = 0; i < links.length; i++) sha.update(links[i].hash+'\n')

  return sha.digest('hex')
}

var add = function(self, log, cksum, links, value, cb) {
  var self = self

  var node = {
    change: 0,
    hash: null,
    log: log,
    seq: 0,
    sort: 0,
    links: links,
    value: value
  }

  var next = after(function(err) {
    if (err) return cb(err)

    node.hash = hash(value, links)
    if (cksum && node.hash !== cksum) return cb(new Error('checksum failed'))

    node.change = self.change+1

    var batch = []
    var ref = node.log+'!'+lexint.pack(node.seq, 'hex')

    batch.push({
      type: 'put',
      key: self.logs.key(log, node.seq),
      value: self.logs.value(node)
    })

    batch.push({
      type: 'put',
      key: CHANGES+lexint.pack(node.change, 'hex'),
      value: ref
    })

    batch.push({
      type: 'put',
      key: HEAD+ref,
      value: ref
    })

    batch.push({
      type: 'put',
      key: NODE+node.hash,
      value: ref
    })

    for (var i = 0; i < links.length; i++) batch.push({type:'del', key:HEAD+links[i].log+'!'+lexint.pack(links[i].seq, 'hex')})

    self.get(node.hash, function(err, oldNode) {
      if (!err) return cb(err, oldNode)
      self.db.batch(batch, function(err) {
        if (err) return cb(err)

        self.change++
        self.emit('add', node)
        cb(null, node)
      })
    })
  })

  links.forEach(function(link, i) {
    var n = next()

    self.get(typeof link === 'string' ? link : link.hash, function(err, resolved) {
      if (err) return n(err)
      node.sort = Math.max(node.sort, resolved.sort+1)
      links[i] = resolved
      n()
    })
  })

  var n = next()
  self.logs.tail(log, function(err, seq) {
    if (err) return n(err)
    node.seq = 1+seq

    if (!seq) {
      node.sort = Math.max(node.sort, 1)
      return n()
    }

    self.logs.get(log, seq, function(err, prev) {
      if (err) return n(err)
      node.sort = Math.max(node.sort, prev.sort+1)
      n()
    })
  })
}

Hyperlog.prototype.add = function(links, value, opts, cb) {
  if (typeof opts === 'function') return this.add(links, value, null, opts)
  if (!links) links = []
  if (!Array.isArray(links)) links = [links]
  if (!Buffer.isBuffer(value)) value = new Buffer(value)
  if (!cb) cb = noop
  if (!opts) opts = {}

  var self = this

  this.lock(function(release) {
    add(self, opts.log || self.id, opts.hash || null, links, value, function(err, node) {
      if (err) return release(cb, err)
      release(cb, null, node)
    })
  })
}

module.exports = Hyperlog