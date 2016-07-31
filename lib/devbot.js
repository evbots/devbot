require('dotenv').load();

var Botkit        = require('botkit'),
    redisConfig   = { url: process.env.REDIS_URL },
    redisStorage  = require('botkit-storage-redis')(redisConfig),
    github        = require('octonode'),
    _bots         = {};

const queryString = require('query-string');

if (!process.env.clientId || !process.env.clientSecret || !process.env.PORT) {
  console.log('Error: Specify clientId clientSecret and port in environment');
  process.exit(1);
}


var controller = Botkit.slackbot({
  storage: redisStorage
}).configureSlackApp({
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


controller.setupWebserver(process.env.PORT, function(err, webserver) {
  controller.createOauthEndpoints(controller.webserver, function(err, req, res) {
    if (err) {
      res.status(500).send('ERROR: ' + err);
    } else {
      res.send('Success!');
    }
  });

  // Redirects user to github
  webserver.get('/github-auth', function (req, res) {
    var state_str = req.query.user_id + '#' + req.query.team_id;
    var authorizationURI = oauth2.authCode.authorizeURL({
      redirect_uri: process.env.baseBotUri + '/callback',
      scope: 'notifications, admin:repo_hook',
      state: state_str
    });
    res.redirect(authorizationURI);
  });

  webserver.get('/callback', function (req, res) {
    var code = req.query.code;
    var state = req.query.state;
    var slackUserId = state.split('#')[0];
    var slackTeamId = state.split('#')[1];

    oauth2.authCode.getToken({
      code: code,
      redirect_uri: process.env.baseBotUri + '/callback'
    }, saveToken);

    function saveToken(error, result) {
      if (error) { console.log('Access Token Error', error.message); }
      var token = oauth2.accessToken.create(result);
      var parsedQueryString = queryString.parse(token.token);

      controller.storage.users.get(slackUserId, function(err, userData) {
        if (userData == null) {
          controller.storage.users.save({
            id: slackUserId,
            github_access_token: parsedQueryString.access_token,
            team_id: slackTeamId
          }, function(err) {
            saveGithubUsername(slackUserId);
          });
        } else {
          storeNew(userData, 'github_access_token', parsedQueryString.access_token);
          saveGithubUsername(slackUserId);
        }
      });

      res.send(token);
    }
  });

  // Message users that are identified in the pull request body
  webserver.post('/webhooks/pull-request', function(req, res) {
    var prBody = req.body.pull_request.body;
    var ghUsernameArray = prBody.match(/\B@([a-z0-9](?:-?[a-z0-9]){0,38})/gi);
    if (ghUsernameArray == null) { return res.send(''); }

    controller.storage.teams.get(req.query.slack_team_id, function(err, team) {
      var existingBot = _bots[team.bot.token];

      existingBot.api.users.list({}, function(err, response) {        
        localUsersMatchingSlackUsers(response.members, function(redisUsers) {
          localUsersMatchingGithubUsernames(ghUsernameArray, redisUsers, function(ghSlackUsers) {
            sendPrMessage(ghSlackUsers, prBody, existingBot, function() {
              res.send('done');
            });
          });
        });
      });
    });
  });
});

controller.storage.teams.all(function(err, teams) {
  for (var t in teams) {
    controller.spawn(teams[t]).startRTM(function(err, bot) {
      if (err) {
        console.log('Error connecting DevBot to Slack:', err);
      } else {
        trackBot(bot);
      }
    });
  }
});

controller.on('create_bot',function(bot, config) {
  if (_bots[config.token]) {
    // already online!
  } else {
    bot.startRTM(function(err) {
      if (!err) {
        trackBot(bot);
      }
    });
  }
});

controller.hears(['repo:'], ['direct_message'], function(bot, message) {
  var repoName = message.text.split(':')[1];
  var repoOwner = message.user;
  controller.storage.users.get(repoOwner, function(err, userData) {
    var githubClient = github.client(userData.github_access_token);
    var repoLocation = userData.github_username + '/' + repoName;
    var repo = githubClient.repo(repoLocation);
    var callback = process.env.baseBotUri + '/webhooks/pull-request?slack_team_id=' + userData.team_id;
    repo.hook({
      'name': 'web',
      'active': true,
      'events': ['pull_request'],
      'config': {
        'url': callback,
        'content_type': 'json'
      }
    }, function(err, data, headers) {
      if (typeof data == 'undefined') {
        bot.reply(message, 'Could not find any repo by name: ' + repoName);
      } else {
        bot.reply(message, 'Notification set up for: ' + repoName);
      }
    });
  });
});

controller.hears(['login to github'], ['direct_message'], function(bot, message) {
  bot.api.auth.test({}, function(err, response) {
    var link_github = process.env.baseBotUri + '/github-auth?user_id=' + message.user + '&team_id=' + response.team_id;
    bot.reply(message, {
      "text": "<" + link_github + "|connect to your github account>",
      "attachments": []
    });
  });
});

function trackBot(bot) {
  _bots[bot.config.token] = bot;
}

function sendPrMessage(slackUserArray, prBody, existingBot, callbackFunc) {
  if (slackUserArray.length > 0) {
    for (var i = 0; i < slackUserArray.length; i++) {
      existingBot.startPrivateConversation({ user: slackUserArray[i].id }, function(err, convo) {
        convo.say(prBody);
        if (i == slackUserArray.length) {
          callbackFunc();
        }
      });
    }
  } else {
    return null;
  }
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

function localUsersMatchingSlackUsers(members, callback) {
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

function localUsersMatchingGithubUsernames(ghUsernameArray, redisUsers, callback) {
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
