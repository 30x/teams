'use strict'
var Pool = require('pg').Pool
var lib = require('http-helper-functions')
var pge = require('pg-event-producer')

var TEAMS = '/teams/'

var config = {
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE
}

var pool = new Pool(config)
var eventProducer = new pge.eventProducer(pool)

function createTeamThen(req, id, selfURL, team, callback) {
  var query = `INSERT INTO teams (id, etag, data) values('${id}', '${lib.uuid4()}', '${JSON.stringify(team)}') RETURNING etag`
  function eventData(pgResult) {
    return {url: selfURL, action: 'create', etag: pgResult.rows[0].etag, team: team}
  }
  eventProducer.queryAndStoreEvent(req, query, 'teams', eventData, function(err, pgResult, pgEventResult) {
    callback(err, pgResult.rows[0].etag)
  })
}

function withTeamDo(req, id, callback) {
  pool.query('SELECT etag, data FROM teams WHERE id = $1', [id], function (err, pg_res) {
    if (err) {
      callback(500)
    }
    else {
      if (pg_res.rowCount === 0) { 
        callback(404)
      }
      else {
        var row = pg_res.rows[0]
        callback(null, row.data, row.etag)
      }
    }
  })
}

function withTeamsForUserDo(req, user, callback) {
  //var query = "SELECT id FROM teams, jsonb_array_elements(teams.data->'members') AS member WHERE member = $1"
  var query = `SELECT id FROM teams WHERE data->'members' ? '${user}'`
  pool.query(query, function (err, pg_res) {
    if (err) {
      callback(err)
    }
    else {
      callback(null, pg_res.rows.map(row => row.id))
    }
  })
}
    
function deleteTeamThen(req, id, selfURL, callback) {
  var query = `DELETE FROM teams WHERE id = '${id}' RETURNING *`
  function eventData(pgResult) {
    return {url: TEAMS + id, action: 'delete', etag: pgResult.rows[0].etag, team: pgResult.rows[0].data}
  }
  eventProducer.queryAndStoreEvent(req, query, 'teams', eventData, function(err, pgResult, pgEventResult) {
    if (err)
      callback(err)
    else
      callback(err, pgResult.rows[0].data, pgResult.rows[0].etag)
  })
}

function updateTeamThen(req, id, selfURL, patchedTeam, etag, callback) {
  var key = lib.internalizeURL(id, req.headers.host)
  var query = `UPDATE teams SET (etag, data) = ('${lib.uuid4()}', '${JSON.stringify(patchedTeam)}') WHERE id = '${key}' AND etag = '${etag}' RETURNING etag`
  function eventData(pgResult) {
    return {url: selfURL, action: 'update', etag: pgResult.rows[0].etag, after: patchedTeam}
  }
  eventProducer.queryAndStoreEvent(req, query, 'teams', eventData, function(err, pgResult, pgEventResult) {
    if (err)
      callback(err)
    else
      callback(err, pgResult.rows[0].etag)
  })
}

function putTeamThen(req, id, selfURL, team, callback) {
  var key = lib.internalizeURL(id, req.headers.host)
  var query = `UPDATE teams SET (etag, data) = ('${lib.uuid4()}', '${JSON.stringify(patchedTeam)}') WHERE id = '${key}' AND etag = '${etag}' RETURNING etag`
  function eventData(pgResult) {
    return {url: selfURL, action: 'update', etag: pgResult.rows[0].etag, before: team, after: patchedTeam}
  }
  eventProducer.queryAndStoreEvent(req, query, 'teams', eventData, function(err, pgResult, pgEventResult) {
    if (err)
      callback(err)
    else
      callback(err, pgResult.rows[0].etag)
  })
}

function init(callback) {
  var query = 'CREATE TABLE IF NOT EXISTS teams (id text primary key, etag text, data jsonb)'
  pool.connect(function(err, client, release) {
    if(err)
      console.error('error creating teams table', err)
    else
      client.query(query, function(err, pgResult) {
        if(err) {
          release()
          console.error('error creating teams table', err)
        } else {
          query = "CREATE INDEX IF NOT EXISTS inxmembers ON teams USING gin ((data->'members'));"
          client.query(query, function(err, pgResult) {
            if(err) {
              release()
              console.error('error creating inmembers index on teams', err)
            } else {
              release()
              console.log('teams-pg: connected to PG, config: ', config)
              eventProducer.init(callback)
            }
          })
        }
      })
  })    
   
}

process.on('unhandledRejection', function(e) {
  console.log(e.message, e.stack)
})

exports.createTeamThen = createTeamThen
exports.updateTeamThen = updateTeamThen
exports.deleteTeamThen = deleteTeamThen
exports.withTeamDo = withTeamDo
exports.withTeamsForUserDo = withTeamsForUserDo
exports.init = init