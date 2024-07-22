var URL = require('url')
var http = require('http')
var cuid = require('cuid')
var Corsify = require('corsify')
var sendJson = require('send-data/json')
var ReqLogger = require('req-logger')
var healthPoint = require('healthpoint')
var HttpHashRouter = require('http-hash-router')

var redis = require('./redis')
var version = require('../package.json').version

var router = HttpHashRouter()
var logger = ReqLogger({ version: version })
var health = healthPoint({ version: version }, redis.healthCheck)
var cors = Corsify({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, accept, content-type'
})

router.set('/favicon.ico', empty)


function getData (req, cb) {
  let data = ''
  req.on('data', chunk => {
    data += chunk
  })
  req.on('end', () => {
    cb(JSON.parse(data))
  })
}

router.set('/route', function (req, res) {
  if (req.method === 'POST') {
    getData(req, function (data) {
      redis.filterTarget(data, function (decision) {
        sendJson(req, res, { ...decision, status: 'OK' })
      })
    })
  } 
})

router.set('/api/targets/:id', function (req, res, opt) {
  if (req.method === 'GET') {
    redis.getTarget(+opt.params.id, function (target) {
      sendJson(req, res, { target, status: 'OK' })
    })
  }
  if (req.method === 'POST') {
    getData(req, function (data) {
      redis.updateTarget(+opt.params.id, data, function (target) {
        sendJson(req, res, { target, status: 'OK' })
      })
    })
  }
})


router.set('/api/targets', function (req, res) {
  if (req.method === 'POST') {
    getData(req, function (data) {
      redis.getLastTargetID(function (ID) {
        redis.postTarget({ id: ID + 1, ...data }, function (target) {
          console.log(target)
          sendJson(req, res, { target, status: 'OK' })
        })
      })
    })
  }
  if (req.method === 'GET') {
    redis.getTargets(function (targets) {
      sendJson(req, res, { targets, status: 'OK' })
    })
  }
})



module.exports = function createServer () {
  return http.createServer(cors(handler))
}

function handler (req, res) {
  if (req.url === '/health') return health(req, res)
  req.id = cuid()
  logger(req, res, { requestId: req.id }, function (info) {
    info.authEmail = (req.auth || {}).email
    console.log(info)
  })
  router(req, res, { query: getQuery(req.url) }, onError.bind(null, req, res))
}

function onError (req, res, err) {
  if (!err) return

  res.statusCode = err.statusCode || 500
  logError(req, res, err)

  sendJson(req, res, {
    error: err.message || http.STATUS_CODES[res.statusCode]
  })
}

function logError (req, res, err) {
  if (process.env.NODE_ENV === 'test') return

  var logType = res.statusCode >= 500 ? 'error' : 'warn'

  console[logType]({
    err: err,
    requestId: req.id,
    statusCode: res.statusCode
  }, err.message)
}

function empty (req, res) {
  res.writeHead(204)
  res.end()
}


function getQuery (url) {
  return URL.parse(url, true).query // eslint-disable-line
}
