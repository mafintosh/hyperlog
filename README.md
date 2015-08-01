# hyperlog

[Merkle DAG](https://github.com/jbenet/random-ideas/issues/20) that replicates based on scuttlebutt logs and causal linking

```
npm install hyperlog
```

[![build status](http://img.shields.io/travis/mafintosh/hyperlog.svg?style=flat)](http://travis-ci.org/mafintosh/hyperlog)
![dat](http://img.shields.io/badge/Development%20sponsored%20by-dat-green.svg?style=flat)

``` js
var hyperlog = require('hyperlog')

var log = hyperlog(db) // where db is a levelup instance

// add a node with value 'hello' and no links
log.add(null, 'hello', function(err, node) {
  console.log('inserted node', node)

  // insert 'world' with a link back to the above node
  log.add([node.key], 'world', function(err, node) {
    console.log('inserted new node', node)
  })
})
```

## Replicate graph

To replicate this log with another one simply use `log.replicate()` and pipe it together with a replication stream from another log.

``` js
var l1 = hyperlog(db1)
var l2 = hyperlog(db2)

var s1 = l1.replicate()
var s2 = l2.replicate()

s1.pipe(s2).pipe(s1)

s1.on('end', function() {
  console.log('replication ended')
})
```

A detailed write-up on how this replication protocol works will be added to this repo in the near
future. For now see the source code.

## API

#### `log = hyperlog(db, [options])`

Create a new log instance. Options include:

``` js
{
  id: 'a-globally-unique-peer-id',
  valueEncoding: 'a levelup-style encoding property' // example: 'json'
}
```

You can also pass in a `identity` and a `sign` and `verify` function
which can be used to create a signed log

``` js
{
  identity: aPublicKeyBuffer, // will be added to all nodes you insert
  sign: function (node, cb) {
    // will be called with all nodes you add
    var signatureBuffer = someCrypto.sign(node.key, mySecretKey)
    cb(null, signatureBuffer)
  },
  verify: function (node, cb) {
    // will be called with all nodes you receive
    if (!node.signature) return cb(null, false)
    cb(null, someCrypto.verify(node.key, node.signature. node.identity))
  }
}
```

#### `log.add(links, value, opts={}, [cb])`

Add a new node to the graph. `links` should be an array of node keys that this node links to.
If it doesn't link to any nodes use `null` or an empty array. `value` is the value that you want to store
in the node. This should be a string or a buffer. The callback is called with the inserted node:

``` js
log.add([link], value, function(err, node) {
  // node looks like this
  {
    change: ... // the change number for this node in the local log
    key:   ... // the hash of the node. this is also the key of the node
    value:  ... // the value (as a buffer) you inserted
    log:    ... // the peer log this node was appended to
    seq:    ... // the peer log seq number
    links: ['hash-of-link-1', ...]
  }
})
```

Optionally supply an `opts.valueEncoding`.

#### `log.append(value, opts={}, [cb])`

Add a value that links all the current heads.

Optionally supply an `opts.valueEncoding`.

#### `log.get(hash, opts={}, cb)`

Lookup a node by its hash. Returns a node similar to `.add` above.

Optionally supply an `opts.valueEncoding`.

#### `log.heads(opts={}, cb)`

Get the heads of the graph as a list. A head is node that no other node
links to.

``` js
log.heads(function(err, heads) {
  console.log(heads) // prints an array of nodes
})
```

The method also returns a stream of heads which is useful
if, for some reason, your graph has A LOT of heads

``` js
var headsStream = log.heads()

headsStream.on('data', function(node) {
  console.log('head:', node)
})

headsStream.on('end', function() {
  console.log('(no more heads)')
})
```

Optionally supply an `opts.valueEncoding`.

#### `changesStream = log.createReadStream([options])`

Tail the changes feed from the log. Everytime you add a node to the graph
the changes feed is updated with that node.

``` js
var changesStream = log.createReadStream({live:true})

changesStream.on('data', function(node) {
  console.log('change:', node)
})
```

Options include:

``` js
{
  since: changeNumber     // only returns changes AFTER the number
  live: false             // never close the change stream
  tail: false             // since = lastChange
  valueEncoding: 'binary'
}
```

#### `replicationStream = log.replicate([options])`

Replicate the log to another one using a replication stream.
Simply pipe your replication stream together with another log's replication stream.

``` js
var l1 = hyperlog(db1)
var l2 = hyperlog(db2)

var s1 = l1.createReplicationStream()
var s2 = l2.createReplicationStream()

s1.pipe(s2).pipe(s1)

s1.on('end', function() {
  console.log('replication ended')
})
```

Options include:

``` js
{
  mode: 'push' | 'pull' | 'sync', // set replication mode. defaults to sync
  live: true, // keep the replication stream open. defaults to false
  metadata: someBuffer, // send optional metadata as part of the handshake
  frame: true // frame the data with length prefixes. defaults to true
}
```

If you send `metadata` it will be emitted as an `metadata` event on the stream.
A detailed write up on how the graph replicates will be added later.

#### log.on('preadd', function (node) {})

On the same tick as `log.add()` is called, this event fires with the `node`
about to be inserted into the log. At this stage of the add process, node has
these properties:

* `node.log`
* `node.key`
* `node.value`
* `node.links`

#### log.on('add', function (node) {})

After a node has been successfully added to the log, this event fires with the
full `node` object that the callback to `.add()` gets.

## License

MIT
