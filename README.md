# hyperlog

Database that replicates based on scuttlebutt logs and causal linking

Currently a work in progress.
See [pfraze/phoenix#170](https://github.com/pfraze/phoenix/issues/170) for more info

``` js
var hyperlog = require('hyperlog')

// currently you NEED to pass a globally unique id - this will change in the future
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

To replicate this log with another once simple pipe the `replicate` streams together.
After the replication stream finished call `resolve` to apply the changes fetched to your log

``` js
var l1 = hyperlog(db1)
var l2 = hyperlog(db2)

var a = l1.replicate()
var b = l2.replicate()

a.pipe(b).pipe(a)

a.on('end', function() {
  a.resolve(function() {
    console.log('the changes received from b are now applied :)')
  })
})
```

A detailed write-up on how this replication protocol works will be added to this repo in the near
future. For now I refer to the source code and the above link.

## License

MIT
