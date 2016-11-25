'use strict'
const http = require('http')
const url = require('url')
const lib = require('http-helper-functions')
const db = require('./teams-db.js')
const pLib = require('permissions-helper-functions')

var TEAMS = '/teams/'

function verifyTeam(req, team) {
  var user = lib.getUser(req.headers.authorization)
  var rslt = lib.setStandardCreationProperties(req, team, user)
  if (team.isA == 'Team')
    if (Array.isArray(team.members))
      return null
    else
      return 'team must have an array of members'
  else
    return 'invalid JSON: "isA" property not set to "Team" ' + JSON.stringify(team)
}

function createTeam(req, res, team) {
  pLib.ifAllowedThen(req, res, '/', 'teams', 'create', function() {
    var err = verifyTeam(req, team)
    if (err !== null) 
      lib.badRequest(res, err)
    else {
      var id = lib.uuid4()
      var selfURL = makeSelfURL(req, id)
      var permissions = team.permissions
      if (permissions !== undefined) {
        delete team.permissions; // interesting unusual case where ; is necessary
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
}

function makeSelfURL(req, key) {
  return 'scheme://authority' + TEAMS + key
}

function addCalculatedProperties(team) {
  team._permissions = `scheme://authority/permissions?${team.self}`
  team._permissionsHeirs = `scheme://authority/permissions-heirs?${team.self}`  
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
    db.deleteTeamThen(req, res, id, function (team, etag) {
      lib.found(req, res, team, etag)
    })
  })
}

function updateTeam(req, res, id, patch) {
  pLib.ifAllowedThen(req, res, null, '_self', 'update', function() {
    db.withTeamDo(req, res, id, function(team , etag) {
      lib.applyPatch(req, res, team, patch, function(patchedTeam) {
        db.updateTeamThen(req, res, id, team, patchedTeam, etag, function (etag) {
          patchedPermissions.self = selfURL(id, req) 
          lib.found(req, res, team, etag)
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
    if (req_url.pathname.lastIndexOf(TEAMS, 0) > -1) {
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
