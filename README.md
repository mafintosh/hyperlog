# hypergraph

Database that replicates based on scuttlebutt logs and causal linking

Currently a work in progress.
See [pfraze/phoenix#170](https://github.com/pfraze/phoenix/issues/170) for more info

``` js
var hypergraph = require('hypergraph')

// currently you NEED to pass a globally unique id - this will change in the future
var graph = hypergraph(db, {id:'mathias'}) // where db is a levelup instance

// add a node with value 'hello' and no links
graph.add(null, 'hello', function(err, node) {
  console.log('inserted node', node)

  // insert 'world' with a link back to the above node
  graph.add([node.key], 'world', function(err, node) {
    console.log('inserted new node', node)
  })
})
```

To replicate this graph with another once simple pipe the `sync` streams together.
After the replication stream finished call `resolve` to apply the changes fetched to your graph

``` js
var g1 = hypergraph(db1, {id:'g1'})
var g2 = hypergraph(db2, {id:'g2'})

var a = g1.sync()
var b = g2.sync()

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
