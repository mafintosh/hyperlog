var pump = require('pump')
var vector = require('./')

var v1 = vector(require('memdb')(), {id:'v1'})
var v2 = vector(require('memdb')(), {id:'v2'})

var replicate = function() {
  var a = v1.replicate()
  var b = v2.replicate()

  console.log('replicating ...')
  pump(a, b, a, function() {
    console.log('replicated! :)')
    console.log('resolving...')
    v2.resolve(function() {
      console.log('resolved! :)')
    })
  })
}

v1.add(null, 'hi', {peer:'thomas'}, function(err, node1) {
  v1.add([node1.key], 'der', {peer: 'thomas'}, function() {
    v1.add(null, 'sup', {peer: 'max'}, function(err, node) {
      v1.add([node.key], 'hej', {peer: 'mathias'}, function() {
        v1.add(null, 'med', {peer: 'mathias'}, function() {
          v1.add([node1.key], 'dig', {peer: 'mathias'}, function(err, node) {
            v1.add([node.key], 'mig og thomas', {peer: 'max'}, function() {
              replicate()            
            })
          })
        })    
      })
    })
  })
})