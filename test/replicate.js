var hyperlog = require('../')
var tape = require('tape')
var memdb = require('memdb')
var pump = require('pump')
var through = require('through2')

var sync = function (a, b, cb) {
  var stream = a.replicate()
  pump(stream, b.replicate(), stream, cb)
}

var toJSON = function (log, cb) {
  var map = {}
  log.createReadStream()
    .on('data', function (node) {
      map[node.key] = {value: node.value, links: node.links}
    })
    .on('end', function () {
      cb(null, map)
    })
}

tape('clones', function (t) {
  var hyper = hyperlog(memdb())
  var clone = hyperlog(memdb())

  hyper.add(null, 'a', function () {
    hyper.add(null, 'b', function () {
      hyper.add(null, 'c', function () {
        sync(hyper, clone, function (err) {
          t.error(err)
          toJSON(clone, function (err, map1) {
            t.error(err)
            toJSON(hyper, function (err, map2) {
              t.error(err)
              t.same(map1, map2, 'logs are synced')
              t.end()
            })
          })
        })
      })
    })
  })
})

tape('clones with valueEncoding', function (t) {
  var hyper = hyperlog(memdb(), {valueEncoding: 'json'})
  var clone = hyperlog(memdb(), {valueEncoding: 'json'})

  hyper.add(null, 'a', function () {
    hyper.add(null, 'b', function () {
      hyper.add(null, 'c', function () {
        sync(hyper, clone, function (err) {
          t.error(err)
          toJSON(clone, function (err, map1) {
            t.error(err)
            toJSON(hyper, function (err, map2) {
              t.error(err)
              t.same(map1, map2, 'logs are synced')
              t.end()
            })
          })
        })
      })
    })
  })
})

tape('syncs with initial subset', function (t) {
  var hyper = hyperlog(memdb())
  var clone = hyperlog(memdb())

  clone.add(null, 'a', function () {
    hyper.add(null, 'a', function () {
      hyper.add(null, 'b', function () {
        hyper.add(null, 'c', function () {
          sync(hyper, clone, function (err) {
            t.error(err)
            toJSON(clone, function (err, map1) {
              t.error(err)
              toJSON(hyper, function (err, map2) {
                t.error(err)
                t.same(map1, map2, 'logs are synced')
                t.end()
              })
            })
          })
        })
      })
    })
  })
})

tape('syncs with initial superset', function (t) {
  var hyper = hyperlog(memdb())
  var clone = hyperlog(memdb())

  clone.add(null, 'd', function () {
    hyper.add(null, 'a', function () {
      hyper.add(null, 'b', function () {
        hyper.add(null, 'c', function () {
          sync(hyper, clone, function (err) {
            t.error(err)
            toJSON(clone, function (err, map1) {
              t.error(err)
              toJSON(hyper, function (err, map2) {
                t.error(err)
                t.same(map1, map2, 'logs are synced')
                t.end()
              })
            })
          })
        })
      })
    })
  })
})

tape('process', function (t) {
  var hyper = hyperlog(memdb())
  var clone = hyperlog(memdb())

  var process = function (node, enc, cb) {
    setImmediate(function () {
      cb(null, node)
    })
  }

  hyper.add(null, 'a', function () {
    hyper.add(null, 'b', function () {
      hyper.add(null, 'c', function () {
        var stream = hyper.replicate()
        pump(stream, clone.replicate({process: through.obj(process)}), stream, function () {
          toJSON(clone, function (err, map1) {
            t.error(err)
            toJSON(hyper, function (err, map2) {
              t.error(err)
              t.same(map1, map2, 'logs are synced')
              t.end()
            })
          })
        })
      })
    })
  })
})
