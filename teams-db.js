'use strict'
var Pool = require('pg').Pool
var lib = require('http-helper-functions')
const db = require('./teams-pg.js')

function withErrorHandling(req, res, callback) {
  return function (err) {
    if (err == 404) 
      lib.notFound(req, res)
    else if (err)
      lib.internalError(res, err)
    else 
      callback.apply(this, Array.prototype.slice.call(arguments, 1))
  }
}

function createTeamThen(req, res, id, selfURL, team, callback) {
  db.createTeamThen(req, id, selfURL, team, withErrorHandling(req, res, callback))
}

function withTeamDo(req, res, id, callback) {
  db.withTeamDo(req, id, withErrorHandling(req, res, callback))
}

function withTeamsForUserDo(req, res, user, callback) {
  db.withTeamsForUserDo(req, user, withErrorHandling(req, res, callback))
}
    
function deleteTeamThen(req, res, id, callback) {
  db.deleteTeamThen(req, id, withErrorHandling(req, res, callback))
}

function updateTeamThen(req, res, id, team, patchedTeam, etag, callback) {
  db.updateTeamThen(req, id, team, patchedTeam, etag, withErrorHandling(req, res, callback))
}

function init(callback) {
  db.init(callback)
}

exports.createTeamThen = createTeamThen
exports.updateTeamThen = updateTeamThen
exports.deleteTeamThen = deleteTeamThen
exports.withTeamDo = withTeamDo
exports.withTeamsForUserDo = withTeamsForUserDo
exports.init = init