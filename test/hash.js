var hyperlog = require('../')
var tape = require('tape')
var memdb = require('memdb')
var framedHash = require('framed-hash')
var multihashing = require('multihashing')
var base58 = require('bs58')

var sha1 = function (links, value) {
  var hash = framedHash('sha1')
  for (var i = 0; i < links.length; i++) hash.update(links[i])
  hash.update(value)
  return hash.digest('hex')
}

var asyncSha2 = function (links, value, cb) {
  process.nextTick(function () {
    var prevalue = value.toString()
    links.forEach(function (link) { prevalue += link })
    var result = base58.encode(multihashing(prevalue, 'sha2-256'))
    cb(null, result)
  })
}

tape('add node using sha1', function (t) {
  var hyper = hyperlog(memdb(), {
    hash: sha1
  })

  hyper.add(null, 'hello world', function (err, node) {
    t.error(err)
    t.same(node.key, '99cf70777a24b574b8fb5b3173cd4073f02098b0')
    t.end()
  })
})

tape('add node with links using sha1', function (t) {
  var hyper = hyperlog(memdb(), {
    hash: sha1
  })

  hyper.add(null, 'hello', function (err, node) {
    t.error(err)
    t.same(node.key, '445198669b880239a7e64247ed303066b398678b')
    hyper.add(node, 'world', function (err, node2) {
      t.error(err)
      t.same(node2.key, '1d95837842db3995fb3e77ed070457eb4f9875bc')
      t.end()
    })
  })
})

tape('add node using async multihash', function (t) {
  var hyper = hyperlog(memdb(), {
    asyncHash: asyncSha2
  })

  hyper.add(null, 'hello world', function (err, node) {
    t.error(err)
    t.same(node.key, 'QmaozNR7DZHQK1ZcU9p7QdrshMvXqWK6gpu5rmrkPdT3L4')
    t.end()
  })
})

tape('add node with links using async multihash', function (t) {
  var hyper = hyperlog(memdb(), {
    asyncHash: asyncSha2
  })

  hyper.add(null, 'hello', function (err, node) {
    t.error(err)
    t.same(node.key, 'QmRN6wdp1S2A5EtjW9A3M1vKSBuQQGcgvuhoMUoEz4iiT5')
    hyper.add(node, 'world', function (err, node2) {
      t.error(err)
      t.same(node2.key, 'QmVeZeqV6sbzeDyzhxFHwBLddaQzUELCxLjrQVzfBuDrt8')
      hyper.add([node, node2], '!!!', function (err, node3) {
        t.error(err)
        t.same(node3.key, 'QmNs89mwydjboQGpvcK2F3hyKjSmdqQTqDWmRMsAQnL4ZU')
        t.end()
      })
    })
  })
})

tape('preadd event with async hash', function (t) {
  var hyper = hyperlog(memdb(), {
    asyncHash: asyncSha2
  })

  var prenode = null
  hyper.on('preadd', function (node) {
    prenode = node
  })

  hyper.add(null, 'hello world', function (err, node) {
    t.error(err)
    t.same(node.key, 'QmaozNR7DZHQK1ZcU9p7QdrshMvXqWK6gpu5rmrkPdT3L4')
    t.end()
  })
  t.equal(prenode.key, null)
})
