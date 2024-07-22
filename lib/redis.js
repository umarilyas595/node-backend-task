var config = require('../config')

var engine = {
  undefined: require('fakeredis'),
  test: require('fakeredis'),
  production: require('redis'),
  development: require('redis')
}[process.env.NODE_ENV]

var redis = module.exports = engine.createClient(config.redis)



function setAcceptPerDay (id, count, cb) {
  redis.set(`acceptPerDay${id}`, count, function (err) {
    if (err) return cb(err)
    cb()
  })
}

redis.healthCheck = function (cb) {
  var now = Date.now().toString()
  redis.set('!healthCheck', now, function (err) {
    if (err) return cb(err)

    redis.get('!healthCheck', function (err, then) {
      if (err) return cb(err)
      if (now !== then.toString()) return cb(new Error('Redis write failed'))

      cb()
    })
  })
}


redis.getLastTargetID = function (cb) {
  redis.get('targets', function (err, targets) {
    if (err) return cb(err)
    const ID = targets ? JSON.parse(targets)[0].id : 0
    cb(ID)
  })
}

redis.postTarget = function (target, cb) {
  redis.get('targets', function (err, targets) {
    if (err) return cb(err)
    const previousTargets = targets ? JSON.parse(targets) : []
    redis.set('targets', JSON.stringify([target, ...previousTargets]), function (err) {
      if (err) return cb(err)
      setAcceptPerDay(target.id, target.maxAcceptsPerDay, function () {
        cb(target)
      })
    })
  })
}


redis.updateTarget = function (id, target, cb) {
  redis.get('targets', function (err, targets) {
    if (err) return cb(err)
    const targetsArr = JSON.parse(targets)
    const updatedTargets = targetsArr.map((el) => el.id === id ? { id: el.id, ...target } : target)
    redis.set('targets', JSON.stringify(updatedTargets), function (err) {
      err ? cb(err) : cb({ id: id, target })
    })
  })
}


redis.getTargets = function (cb) {
  redis.get('targets', function (err, targets) {
    if (err) return cb(err)
    cb(JSON.parse(targets))
  })
}


redis.getTarget = function (id, cb) {
  redis.get('targets', function (err, targets) {
    if (err) return cb(err)
    if (targets) {
      const targetsArr = JSON.parse(targets)
      const target = targetsArr.find((target) => target.id === id)
      cb(target || new Error('Target not found'))
    } else {
      cb(new Error('Target not found.'))
    }
  })
}

redis.filterTarget = function (data, cb) {
  redis.get('targets', function (err, targets) {
    if (err) return cb(err)
    if (targets) {
      const targetsArr = JSON.parse(targets)
      const currentState = data.geoState
      const currentHour = new Date(data.timestamp).getHours()
      let filterTargetArr = targetsArr.filter((el) => {
        const targetStates = el.accept.geoState.$in
        const targetHours = el.accept.hour.$in
        return targetStates.includes(currentState) && targetHours.includes(`${currentHour}`)
      })

      if (filterTargetArr.length === 0) {
        cb({ decision: 'reject' })
      } else {
        filterTargetArr = filterTargetArr.sort((a, b) => parseFloat(b.value) - parseFloat(a.value)).sort((a, b) => parseInt(b.maxAcceptsPerDay) - parseInt(a.maxAcceptsPerDay))
        const selectedTargetItem = filterTargetArr[0]
        redis.get(`acceptPerDay${selectedTargetItem.id}`, function (err, count) {
          if (!err && count) {
            const acceptPerDay = +count
            if (acceptPerDay > 0) {
              setAcceptPerDay(selectedTargetItem.id, acceptPerDay - 1, function () {
                cb({ url: selectedTargetItem.url })
              })
            } else {
              cb({ decision: 'reject' })
            }
          } else {
            cb({ decision: 'reject' })
          }
        })
      }
    }
  })
}
