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
var encoder = require('./lib/encode')
var defined = require('defined')

var ID = '!!id'
var CHANGES = '!changes!'
var NODES = '!nodes!'
var HEADS = '!heads!'

var INVALID_SIGNATURE = new Error('Invalid signature')
var CHECKSUM_MISMATCH = new Error('Checksum mismatch')
var INVALID_LOG = new Error('Invalid log sequence')

INVALID_LOG.notFound = true
INVALID_LOG.status = 404

var noop = function () {}

var Hyperlog = function (db, opts) {
  if (!(this instanceof Hyperlog)) return new Hyperlog(db, opts)
  if (!opts) opts = {}

  events.EventEmitter.call(this)

  this.id = defined(opts.id, null)
  this.enumerate = enumerate(db, {prefix: 'enum'})
  this.db = db
  this.logs = logs(db, {prefix: 'logs', valueEncoding: messages.Entry})
  this.lock = defined(opts.lock, mutexify())
  this.changes = 0
  this.setMaxListeners(0)
  this.valueEncoding = defined(opts.valueEncoding, opts.encoding, 'binary')
  this.identity = defined(opts.identity, null)
  this.verify = defined(opts.verify, null)
  this.sign = defined(opts.sign, null)
  this.hash = defined(opts.hash, hash)
  this.asyncHash = defined(opts.asyncHash, null)

  var self = this
  var getId = defined(opts.getId, function (cb) {
    db.get(ID, {valueEncoding: 'utf-8'}, function (_, id) {
      if (id) return cb(null, id)
      id = cuid()
      db.put(ID, id, function () {
        cb(null, id)
      })
    })
  })

  this.lock(function (release) {
    collect(db.createKeyStream({gt: CHANGES, lt: CHANGES + '~', reverse: true, limit: 1}), function (_, keys) {
      self.changes = Math.max(self.changes, keys && keys.length ? lexint.unpack(keys[0].split('!').pop(), 'hex') : 0)
      if (self.id) return release()
      getId(function (_, id) {
        self.id = id || cuid()
        release()
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

Hyperlog.prototype.heads = function (opts, cb) {
  var self = this
  if (!opts) opts = {}
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  var rs = this.db.createValueStream({
    gt: HEADS,
    lt: HEADS + '~',
    valueEncoding: 'utf-8'
  })

  var format = through.obj(function (key, enc, cb) {
    self.get(key, opts, cb)
  })

  return collect(pump(rs, format), cb)
}

Hyperlog.prototype.get = function (key, opts, cb) {
  if (!opts) opts = {}
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  var self = this
  this.db.get(NODES + key, {valueEncoding: 'binary'}, function (err, buf) {
    if (err) return cb(err)
    var node = messages.Node.decode(buf)
    node.value = encoder.decode(node.value, opts.valueEncoding || self.valueEncoding)
    cb(null, node)
  })
}

var toKey = function (link) {
  return typeof link !== 'string' ? link.key : link
}

var addBatch = function (dag, node, logLinks, batch, opts, cb) {
  if (opts.hash && node.key !== opts.hash) return cb(CHECKSUM_MISMATCH)
  if (opts.seq && node.seq !== opts.seq) return cb(INVALID_LOG)

  var log = {
    change: node.change,
    node: node.key,
    links: logLinks
  }

  var onclone = function (clone) {
    if (!opts.log) return cb(null, clone, [])
    batch.push({type: 'put', key: dag.logs.key(node.log, node.seq), value: messages.Entry.encode(log)})
    cb(null, clone)
  }

  var done = function () {
    dag.get(node.key, { valueEncoding: 'binary' }, function (_, clone) {
      if (clone) return onclone(clone)

      var links = node.links
      for (var i = 0; i < links.length; i++) batch.push({type: 'del', key: HEADS + links[i]})
      batch.push({type: 'put', key: CHANGES + lexint.pack(node.change, 'hex'), value: node.key})
      batch.push({type: 'put', key: NODES + node.key, value: messages.Node.encode(node)})
      batch.push({type: 'put', key: HEADS + node.key, value: node.key})
      batch.push({type: 'put', key: dag.logs.key(node.log, node.seq), value: messages.Entry.encode(log)})

      cb(null, node)
    })
  }

  if (node.log === dag.id) { // we own this node
    if (!dag.sign || node.signature) return done()
    dag.sign(node, function (err, sig) {
      if (err) return cb(err)
      node.identity = dag.identity
      node.signature = sig
      done()
    })
  } else {
    if (!dag.verify) return done()
    dag.verify(node, function (err, valid) {
      if (err) return cb(err)
      if (!valid) return cb(INVALID_SIGNATURE)
      done()
    })
  }
}

var getLinks = function (dag, id, links, cb) {
  var logLinks = []
  var nextLink = function () {
    var cb = next()
    return function (err, link) {
      if (err) return cb(err)
      if (link.log !== id && logLinks.indexOf(link.log) === -1) logLinks.push(link.log)
      cb(null)
    }
  }
  var next = after(function (err) {
    if (err) cb(err)
    else cb(null, logLinks)
  })

  for (var i = 0; i < links.length; i++) {
    dag.get(links[i], nextLink())
  }
}

var createLiveStream = function (dag, opts) {
  var since = opts.since || 0
  var limit = opts.limit || -1
  var wait = null

  var read = function (size, cb) {
    if (dag.changes <= since) {
      wait = cb
      return
    }

    if (!limit) return cb(null, null)

    dag.db.get(CHANGES + lexint.pack(since + 1, 'hex'), function (err, hash) {
      if (err) return cb(err)
      dag.get(hash, opts, function (err, node) {
        if (err) return cb(err)
        since = node.change
        if (limit !== -1) limit--
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

  dag.on('add', kick)
  dag.ready(kick)

  var rs = from.obj(read)

  rs.once('close', function () {
    dag.removeListener('add', kick)
  })

  return rs
}

Hyperlog.prototype.createReadStream = function (opts) {
  if (!opts) opts = {}
  if (opts.tail) {
    opts.since = this.changes
  }
  if (opts.live) return createLiveStream(this, opts)

  var self = this
  var since = opts.since || 0
  var until = opts.until || 0

  var keys = this.db.createValueStream({
    gt: CHANGES + lexint.pack(since, 'hex'),
    lt: CHANGES + (until ? lexint.pack(until, 'hex') : '~'),
    valueEncoding: 'utf-8',
    reverse: opts.reverse,
    limit: opts.limit
  })

  var get = function (key, enc, cb) {
    self.get(key, opts, cb)
  }

  return pump(keys, through.obj(get))
}

Hyperlog.prototype.replicate =
Hyperlog.prototype.createReplicationStream = function (opts) {
  return replicate(this, opts)
}

Hyperlog.prototype.add = function (links, value, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!cb) cb = noop
  this.batch([{links: links, value: value}], opts, function (err, nodes) {
    if (err) cb(err)
    else cb(null, nodes[0])
  })
}

Hyperlog.prototype.batch = function (docs, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!cb) cb = noop
  if (!opts) opts = {}

  if (docs.length === 0) return process.nextTick(function () { cb(null, []) })

  var self = this
  var id = opts.log || self.id
  var nodes = new Array(docs.length)
  var logLinks = new Array(docs.length)
  var batch = [] // dynamic length

  var onlocked = function (release) {
    self.ready(function () {
      self.logs.head(id, function (err, seq) {
        if (err) return release(cb, err)
        else batchAndRelease(release, seq)
      })
    })
  }

  var batchAndRelease = function (release, seq) {
    var next = after(function (err) {
      if (err) return release(cb, err)

      self.db.batch(batch, function (err) {
        if (err) return release(cb, err)

        self.changes = getMaxNodeChangeValue(nodes, self.changes)

        for (var i = 0; i < nodes.length; i++) self.emit('add', nodes[i])

        release(cb, null, nodes)
      })
    })

    var added = nodes.length > 1 ? {} : null

    nodes.forEach(function (node, index) {
      if (added && added[node.key]) {
        node.seq = added[node.key].seq
        node.change = added[node.key].change
        if (!node.log) node.log = self.id
        return
      }

      var done = next()
      var lns = logLinks[index]

      if (added) added[node.key] = node

      node.seq = seq + 1 + index
      node.change = self.changes + 1 + index
      if (!node.log) node.log = self.id

      addBatch(self, node, lns, batch, opts, function (err, node) {
        if (err) {
          self.emit('reject', node)
          return done(err)
        }
        node.value = encoder.decode(node.value, opts.valueEncoding || self.valueEncoding)
        nodes[index] = node
        done()
      })
    })
  }

  var next = after(function (err) {
    if (err) return cb(err)
    if (opts.release) onlocked(opts.release)
    else self.lock(onlocked)
  })

  docs.forEach(function (doc, index) {
    var done = next()
    var postHashing = function (err, key) {
      if (err) return done(err)

      node.key = key
      getLinks(self, id, links, function (err, lns) {
        if (err) return done(err)
        logLinks[index] = lns
        done()
      })
    }

    var links = doc.links || []
    if (!Array.isArray(links)) links = [links]
    links = links.map(toKey)

    var encodedValue = encoder.encode(doc.value, opts.valueEncoding || self.valueEncoding)
    var node = {
      log: opts.log || self.id,
      key: null,
      identity: opts.identity || null,
      signature: opts.signature || null,
      value: encodedValue,
      links: links
    }

    nodes[index] = node

    if (self.asyncHash) {
      self.emit('preadd', node)
      self.asyncHash(links, encodedValue, postHashing)
    } else {
      node.key = self.hash(links, encodedValue)
      self.emit('preadd', node)
      postHashing(null, node.key)
    }
  })
}

Hyperlog.prototype.append = function (value, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!cb) cb = noop
  if (!opts) opts = {}
  var self = this

  this.lock(function (release) {
    self.heads(function (err, heads) {
      if (err) return release(cb, err)
      opts.release = release
      self.add(heads, value, opts, cb)
    })
  })
}

// Returns the highest change #, given an array of nodes and a current change
// #.
function getMaxNodeChangeValue (nodes, highest) {
  return nodes.reduce(function (max, cur) {
    return Math.max(max, cur.change)
  }, highest)
}

module.exports = Hyperlog
