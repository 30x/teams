'use strict'
const http = require('http')
const url = require('url')
const lib = require('http-helper-functions')
const db = require('./teams-db.js')
const pLib = require('permissions-helper-functions')
const rLib = require('response-helper-functions')

const TEAMS = '/teams/'

function verifyBases(req, res, team, callback) {
  var bases = Object.keys(team.role)
  var pathCount
  var count = 0
  var notAllowed = []
  for (let i=0; i<bases.length; i++) {
    var base = bases[i]
    var paths = Object.keys(base)
    pathCount += path.length
    for (let j=0; j< paths.length; j++)
      pLib.withAllowedDo(lib.flowThroughHeaders(req), res, base, '_self', 'govern', base, paths[j], function(allowed) {
        if (!allowed) 
          notAllowed.push(bases[i])
        if (++count == pathCount)
          callback(notAllowed.length == 0 ? null : `user ${lib.getUser(req.headers.authorization)} does not have the right to administer the permissions of the following base resources: ${notAllowed}`)            
      })
  }
  if (pathCount == 0)
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
  pLib.ifAllowedThen(lib.flowThroughHeaders(req), res, '/', 'teams', 'create', function() {
    verifyTeam(req, res, team, function(err) { 
      if (err !== null) 
        rLib.badRequest(res, err)
      else {
        var id = rLib.uuid4()
        var selfURL = makeSelfURL(req, id)
        var permissions = team._permissions
        if (permissions !== undefined) {
          delete team._permissions; // unusual case where ; is necessary
          (new pLib.Permissions(permissions)).resolveRelativeURLs(selfURL)
        }
        pLib.createPermissionsThen(lib.flowThroughHeaders(req), res, selfURL, permissions, function(err, permissionsURL, permissions, responseHeaders){
          // Create permissions first. If we fail after creating the permissions resource but before creating the main resource, 
          // there will be a useless but harmless permissions document.
          // If we do things the other way around, a team without matching permissions could cause problems.
          db.createTeamThen(req, res, id, selfURL, team, permissions.scopes, function(etag) {
            team.self = selfURL 
            addCalculatedProperties(team)
            rLib.created(res, team, req.headers.accept, team.self, etag)
          })
        })
      }
    })
  })
}

function makeSelfURL(req, key) {
  return `${rLib.INTERNAL_URL_PREFIX}${TEAMS}${key}`
}

function addCalculatedProperties(team) {
  var externalSelf = lib.externalizeURLs(team.self)
  team._permissions = `${rLib.INTERNAL_URL_PREFIX}/permissions?${externalSelf}`
  team._permissionsHeirs = `${rLib.INTERNAL_URL_PREFIX}/permissions-heirs?${externalSelf}`  
}

function getTeam(req, res, id) {
  pLib.ifAllowedThen(lib.flowThroughHeaders(req), res, req.url, '_self', 'read', function(err, reason) {
    db.withTeamDo(req, res, id, function(team , etag) {
      team.self = makeSelfURL(req, id)
      addCalculatedProperties(team)
      rLib.found(res, team, req.headers.accept, team.self, etag)
    })
  })
}

function deleteTeam(req, res, id) {
  pLib.ifAllowedThen(lib.flowThroughHeaders(req), res, req.url, '_self', 'delete', function() {
    db.deleteTeamThen(req, res, id, makeSelfURL(req, id), function (team, etag) {
      pLib.deletePermissionsThen(lib.flowThroughHeaders(req), res, `${TEAMS}${id}`, function () {
        console.log(`deleted permissions for ${TEAMS}${id}`)
      })
      team.self = makeSelfURL(req, id)
      addCalculatedProperties(team)
      rLib.found(res, team, req.headers.accept, team.self, etag)
    })
  })
}

function updateTeam(req, res, id, patch) {
  var selfURL =  makeSelfURL(req, id) 
  pLib.ifAllowedThen(lib.flowThroughHeaders(req), res, req.url, '_self', 'update', function(allowed) {
    db.withTeamDo(req, res, id, function(team , etag) {
      if (req.headers['if-match'] == etag) { 
        lib.applyPatch(req, res, team, patch, function(patchedTeam) {
          verifyTeam(req, res, patchedTeam, function(err) {
            if (err)
              rLib.badRequest(res, err)
            else
              db.updateTeamThen(req, res, id, makeSelfURL(req, id), patchedTeam, allowed.scopes, etag, function (etag) {
                patchedTeam.self = selfURL 
                addCalculatedProperties(patchedTeam)
                rLib.found(res, patchedTeam, req.headers.accept, patchedTeam.self, etag)
              })
          })
        })
      } else {
        var err = (req.headers['if-match'] === undefined) ? 'missing If-Match header' : 'If-Match header does not match etag ' + req.headers['If-Match'] + ' ' + etag
        rLib.badRequest(res, err)
      }      
    })
  }, true)
}

function putTeam(req, res, id, team) {
  pLib.ifAllowedThen(lib.flowThroughHeaders(req), res, req.url, '_self', 'put', function(allowed) {
    verifyTeam(req, res, team, function(err) {
      if (err)
        rLib.badRequest(res, err)
      else
        db.updateTeamThen(req, res, id, makeSelfURL(req, id), team, allowed.scopes, null, function (etag) {
          team.self = makeSelfURL(req, id) 
          addCalculatedProperties(team)
          rLib.found(res, team, req.headers.accept, team.self, etag)
        })
    })
  }, true)
}

function getTeamsForUser(req, res, user) {
  var requestingUser = lib.getUser(req.headers.authorization)
  user = lib.internalizeURL(user, req.headers.host)
  if (user == requestingUser) {
    db.withTeamsForUserDo(req, res, user, function (teamIDs) {
      var rslt = {
        self: req.url,
        contents: teamIDs.map(id => `//${req.headers.host}${TEAMS}${id}`)
      }
      rLib.found(res, rslt, req.headers.accept, rslt.self)
    })
  } else
    rLib.forbidden(res)
}

function requestHandler(req, res) {
  if (req.url == '/teams') 
    if (req.method == 'POST') 
      lib.getServerPostObject(req, res, (t) => createTeam(req, res, t))
    else 
      rLib.methodNotAllowed(res, ['POST'])
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
      else if (req.method == 'PUT') 
        lib.getServerPostObject(req, res, (jso) => putTeam(req, res, id, jso))
      else
        rLib.methodNotAllowed(res, ['GET', 'DELETE', 'PATCH', 'PUT'])
    } else if (req_url.pathname == '/teams' && req_url.search !== null)
      getTeamsForUser(req, res, req_url.search.substring(1))
    else
      rLib.notFound(res, `//${req.headers.host}${req.url} not found`)
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
