# hyperlog

Graph database that replicates based on scuttlebutt logs and causal linking

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
  log.add([node.hash], 'world', function(err, node) {
    console.log('inserted new node', node)
  })
})
```

## Replicate graph

To replicate this log with another one simply use `log.createReplicationStream()` and pipe it together with a replication stream from another log.

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

A detailed write-up on how this replication protocol works will be added to this repo in the near
future. For now I refer to the source code.

## API

#### `log = hyperlog(db, [options])`

Create a new log instance. Options include:

``` js
{
  id: 'a-globally-unique-peer-id'
}
```

#### `log.add(links, value, [cb])`

Add a new node to the graph. `links` should be an array of node hashes that this node links to.
If it doesn't link to any nodes use `null` or an empty array. `value` is the value that you want to store
in the node. This should be a string or a buffer. The callback is called with the inserted node:

```
log.add([link], value, function(err, node) {
  // node looks like this
  {
    change: ... // the change number for this node in the local log
    hash:   ... // the hash of the node. this is also the key of the node
    value:  ... // the value (as a buffer) you inserted
    log:    ... // the peer log this node was appended to
    seq:    ... // the peer log seq number
    links: [{
      hash: ... // hash of the linked node
      log:  ... // peer log of the link
      seq:  ... // peer log seq number of the link
    }]
  }
})
```

#### `log.get(hash, cb)`

Lookup a node by its hash. Returns a node similar to `.add` above.

#### `log.heads(cb)`

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

#### `changesStream = log.createChangesStream([options])`

Tail the changes feed from the log. Everytime you add a node to the graph
the changes feed is updated with that node.

``` js
var changesStream = log.createChangesStream({live:true})

changesStream.on('data', function(node) {
  console.log('change:', node)
})
```

Options include:

``` js
{
  since: changeNumber // only returns changes AFTER the number
  live: false         // never close the change stream
  tail: false         // since = lastChange
}
```

#### `replicationStream = log.createReplicationStream([options])`

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
  mode: 'push' | 'pull' | 'sync' // set replication mode. defaults to sync
}
```

A detailed write up on how the graph replicates will be added later.

## License

MIT
