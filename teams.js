'use strict'
const http = require('http')
const url = require('url')
const lib = require('http-helper-functions')
const db = require('./teams-db.js')
const pLib = require('permissions-helper-functions')

var TEAMS = '/teams/'

function verifyBases(req, res, team, callback) {
  var bases = Object.keys(team.role)
  if (bases.length > 0) {
    var count = 0
    var notAllowed = []
    for (let i=0; i<bases.length; i++) {
      pLib.withAllowedDo(req, res, bases[i], '_permissions', 'update', function(allowed) {
        if (!allowed) 
          notAllowed.push(bases[i])
        if (++count == bases.length) {
          callback(notAllowed.length == 0 ? null : `user ${lib.getUser(req.headers.authorization)} does not have the right to administer the permissions of the following base resources: ${notAllowed}`)            
        }
      })
    }
  } else
    calback(null)
}

function verifyTeam(req, res, team, callback) {
  var user = lib.getUser(req.headers.authorization)
  var rslt = lib.setStandardCreationProperties(req, team, user)
  if (team.isA == 'Team')
    if (Array.isArray(team.members))
      if (team.role !== undefined) 
        verifyBases(req, res, team, callback)
      else
        callback(null)
    else
      callback('team must have an array of members')
  else
    calback('invalid JSON: "isA" property not set to "Team" ' + JSON.stringify(team))
}

function createTeam(req, res, team) {
  pLib.ifAllowedThen(req, res, '/', 'teams', 'create', function() {
    verifyTeam(req, res, team, function(err) { 
      if (err !== null) 
        lib.badRequest(res, err)
      else {
        var id = lib.uuid4()
        var selfURL = makeSelfURL(req, id)
        var permissions = team._permissions
        if (permissions !== undefined) {
          delete team._permissions; // unusual case where ; is necessary
          (new pLib.Permissions(permissions)).resolveRelativeURLs(selfURL)
        }
        pLib.createPermissionsThen(req, res, selfURL, permissions, function(err, permissionsURL, permissions, responseHeaders){
          // Create permissions first. If we fail after creating the permissions resource but before creating the main resource, 
          // there will be a useless but harmless permissions document.
          // If we do things the other way around, a team without matching permissions could cause problems.
          db.createTeamThen(req, res, id, selfURL, team, function(etag) {
            team.self = selfURL 
            addCalculatedProperties(team)
            lib.created(req, res, team, team.self, etag)
          })
        })
      }
    })
  })
}

function makeSelfURL(req, key) {
  return 'scheme://authority' + TEAMS + key
}

function addCalculatedProperties(team) {
  var externalSelf = lib.externalizeURLs(team.self)
  team._permissions = `scheme://authority/permissions?${externalSelf}`
  team._permissionsHeirs = `scheme://authority/permissions-heirs?${externalSelf}`  
}

function getTeam(req, res, id) {
  pLib.ifAllowedThen(req, res, null, '_self', 'read', function(err, reason) {
    db.withTeamDo(req, res, id, function(team , etag) {
      team.self = makeSelfURL(req, id)
      addCalculatedProperties(team)
      lib.externalizeURLs(team, req.headers.host)
      lib.found(req, res, team, etag)
    })
  })
}

function deleteTeam(req, res, id) {
  pLib.ifAllowedThen(req, res, null, '_self', 'delete', function(err, reason) {
    db.deleteTeamThen(req, res, id, makeSelfURL(req, id), function (team, etag) {
      lib.sendInternalRequestThen(req, res, `/permissions?${TEAMS}${id}`, 'DELETE', undefined, function (clientRes) {
        lib.getClientResponseBody(clientRes, function(body) {
          var statusCode = clientRes.statusCode
          if (statusCode !== 200)
            console.log(`unable to delete permissions for ${TEAMS}${id}`)
        })
      })
      addCalculatedProperties(team)
      lib.found(req, res, team, etag)
    })
  })
}

function updateTeam(req, res, id, patch) {
  pLib.ifAllowedThen(req, res, null, '_self', 'update', function() {
    db.withTeamDo(req, res, id, function(team , etag) {
      lib.applyPatch(req, res, team, patch, function(patchedTeam) {
        verifyTeam(req, res, patchedTeam, function(err) {
          if (err)
            lib.badRequest(res, err)
          else
            db.updateTeamThen(req, res, id, makeSelfURL(req, id), team, patchedTeam, etag, function (etag) {
              patchedTeam.self = makeSelfURL(req, id) 
              addCalculatedProperties(patchedTeam)
              lib.found(req, res, patchedTeam, etag)
            })
        })
      })
    })
  })
}

function getTeamsForUser(req, res, user) {
  var requestingUser = lib.getUser(req.headers.authorization)
  user = lib.internalizeURL(user, req.headers.host)
  if (user == requestingUser) {
    db.withTeamsForUserDo(req, res, user, function (teamIDs) {
      var rslt = {
        self: `scheme://authority${req.url}`,
        contents: teamIDs.map(id => `//${req.headers.host}${TEAMS}${id}`)
      }
      lib.externalizeURLs(rslt)
      lib.found(req, res, rslt)
    })
  } else
    lib.forbidden(req, res)
}

function requestHandler(req, res) {
  if (req.url == '/teams') 
    if (req.method == 'POST') 
      lib.getServerPostObject(req, res, (t) => createTeam(req, res, t))
    else 
      lib.methodNotAllowed(req, res, ['POST'])
  else {
    var req_url = url.parse(req.url)
    if (req_url.pathname.startsWith(TEAMS)) {
      var id = req_url.pathname.substring(TEAMS.length)
      if (req.method == 'GET')
        getTeam(req, res, id)
      else if (req.method == 'DELETE') 
        deleteTeam(req, res, id)
      else if (req.method == 'PATCH') 
        lib.getServerPostObject(req, res, (jso) => updateTeam(req, res, id, jso))
      else
        lib.methodNotAllowed(req, res, ['GET', 'DELETE', 'PATCH'])
    } else if (req_url.pathname == '/teams' && req_url.search !== null)
      getTeamsForUser(req, res, req_url.search.substring(1))
    else
      lib.notFound(req, res)
  }
}

function start(){
  db.init(function(){
    var port = process.env.PORT
    http.createServer(requestHandler).listen(port, function() {
      console.log(`server is listening on ${port}`)
    })
  })
}

if (process.env.INTERNAL_SY_ROUTER_HOST == 'kubernetes_host_ip') 
  lib.getHostIPThen(function(err, hostIP){
    if (err) 
      process.exit(1)
    else {
      process.env.INTERNAL_SY_ROUTER_HOST = hostIP
      start()
    }
  })
else 
  start()
