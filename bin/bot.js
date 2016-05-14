
require('../token.js');

var DevBot        = require('../lib/devbot'),
    Botkit        = require('botkit'),
    redisConfig   = {},
    redisStorage  = require('botkit-storage-redis')(redisConfig),
    github        = require('octonode');

const queryString = require('query-string');

if (!process.env.clientId || !process.env.clientSecret || !process.env.port) {
  console.log('Error: Specify clientId clientSecret and port in environment');
  process.exit(1);
}

var controller = Botkit.slackbot({storage: redisStorage, })
                       .configureSlackApp({
                         clientId: process.env.clientId,
                         clientSecret: process.env.clientSecret,
                         scopes: ['bot']
                       });


var oauth2 = require('simple-oauth2')({
  clientID: process.env.githubClientId,
  clientSecret: process.env.githubClientSecret,
  site: 'https://github.com/login',
  tokenPath: '/oauth/access_token',
  authorizationPath: '/oauth/authorize'
});

controller.setupWebserver(process.env.port,function(err, webserver) {

  webserver.post('/webhooks/pull-request', function(req, res) {
    var prBody = req.body.pull_request.body;

    // http://stackoverflow.com/questions/30281026/regex-parsing-github-usernames-javascript
    var ghUsernameArray = prBody.match(/\B@([a-z0-9](?:-?[a-z0-9]){0,38})/gi);
    if (ghUsernameArray == null) { return res.send(''); }

    var teamId = req.query.slack_team_id;

    controller.storage.teams.get(teamId, function(err, team) {
      var config = { token: team.bot.token, bot_id: team.bot.user_id };
      startBotWithoutTrack(config, function(passedBot) {
        passedBot.slackTeamUsers(function(members) {
          getRedisUsers(members, function(redisUsers) {
            slackUsersWithGithub(ghUsernameArray, redisUsers, function(ghSlackUsers) {
              passedBot.sendPrMessage(ghSlackUsers, prBody);
            });
          });
        });
      });
    });
  });

  webserver.get('/github-auth', function (req, res) {
    var authorizationURI = oauth2.authCode.authorizeURL({
      redirect_uri: process.env.baseBotUri + '/callback',
      scope: 'notifications, admin:repo_hook',
      state: req.query.id
    });
    res.redirect(authorizationURI);
  });

  // Callback service parsing the authorization token and asking for the access token
  webserver.get('/callback', function (req, res) {
    var code = req.query.code;
    var slackUserId = req.query.state;

    oauth2.authCode.getToken({
      code: code,
      redirect_uri: process.env.baseBotUri + '/callback'
    }, saveToken);

    function saveToken(error, result) {
      if (error) { console.log('Access Token Error', error.message); }
      var token = oauth2.accessToken.create(result);

      // use this method to preserve existing key value pairs associated with the user
      controller.storage.users.get(slackUserId, function(err, userData) {
        var parsedQueryString = queryString.parse(token.token);
        storeNew(userData, 'github_access_token', parsedQueryString.access_token);
        saveGithubUsername(slackUserId);
      });

      res.send(token);
    }
  });

  webserver.get('/github', function (req, res) {
    res.send('Hello<br><a href="/github-auth">Log in with Github</a>');
  });

  controller.createWebhookEndpoints(webserver);

  controller.createOauthEndpoints(controller.webserver, function(err, req, res) {
    if (err) {
      res.status(500).send('ERROR: ' + err);
    } else {
      res.send('Success!');
    }
  });
});

var _bots = {};
function trackBot(slackbotId, instance) {
  _bots[slackbotId] = instance;
}

function saveGithubUsername(slackId) {
  controller.storage.users.get(slackId, function(err, userData) {
    var github_client = github.client(userData.github_access_token);
    github_client.get('/user', {}, function (err, status, body, headers) {
      storeNew(userData, 'github_username', body.login);
    });
  });
}

function storeNew(existing, key, value) {
  existing[key] = value;
  controller.storage.users.save(existing, function(err) {
    console.log(err);
  });
}

// when server is started, loop through saved teams and
// create bots that should already be online.
controller.storage.teams.all(function(err, all_team_data) {
  for(var i = 1; i <= all_team_data.length; i++) {
    var index = i - 1;
    var bot_config = {
      token: all_team_data[index].bot.token,
      slackbot_id: all_team_data[index].bot.user_id
    };
    startBot(bot_config);
  }
});

controller.on('create_bot',function(bot,config) {
  if (_bots[config.user_id]) {
    // already online! do nothing.
  } else {
    var bot_config = {
      token: bot.config.token,
      slackbot_id: config.user_id 
    };
    startBot(bot_config);
  }
});

function startBot(bot_config) {
  var devbot = new DevBot({
    token: bot_config.token,
    bot_id: bot_config.slackbot_id
  }, controller);
  devbot.run();
  trackBot(bot_config.bot_id, devbot);
}

function startBotWithoutTrack(bot_config, func) {
  var devbot = new DevBot({
    token: bot_config.token,
    bot_id: bot_config.slackbot_id
  }, controller);
  devbot.run();
  func(devbot);
}

function getRedisUsers(members, callback) {
  var redisUsersArray = [];
  var callbackCount = 0;
  for (var i = 0; i < members.length; i++) {
    controller.storage.users.get(members[i].id, function(err, userData) {
      if (userData != null) {
        redisUsersArray.push(userData);
      }
      if (++callbackCount == members.length) {
        callback(redisUsersArray);
      }
    });
  }
}

function slackUsersWithGithub(ghUsernameArray, redisUsers, callback) {
  var slackUsersWithGithubArray = [];
  for (var i = 0; i < ghUsernameArray.length; i++) {
    var ghUsernameStripped = ghUsernameArray[i].slice(1); // stripped of @ symbol
    for (var ind = 0; ind < redisUsers.length; ind++) {
      if (ghUsernameStripped == redisUsers[ind].github_username) {
        slackUsersWithGithubArray.push(redisUsers[ind]);
      }
      if (ind == (redisUsers.length - 1) && i == (ghUsernameArray.length - 1)) {
        callback(slackUsersWithGithubArray);
      }
    }
  }
}