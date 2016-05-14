'use strict';
require('../token.js');

var util   = require('util'),
    path   = require('path'),
    Bot    = require('slackbots'),
    github = require('octonode');

var DevBot = function Constructor(settings, controller) {
  this.settings = settings;
  this.settings.bot_id = settings.bot_id;

  this.user = null;
  this.slack_controller = controller;
};

// inherits methods and properties from the Bot constructor
util.inherits(DevBot, Bot);

DevBot.prototype.run = function () {
  DevBot.super_.call(this, this.settings);

  this.on('start', this._onStart);
  this.on('message', this._onMessage);
};

DevBot.prototype._onStart = function () {
  this._loadBotUser();
};

DevBot.prototype._onMessage = function (message) {
  var self = this;
  if (this._isChatMessage(message) &&
      this._isChannelConversation(message) &&
      !this._isFromDevBot(message) &&
      this._isGithubMessage(message)) {
    var link_github = process.env.baseBotUri + '/github-auth?id=' + message.user;
    var formatted_link = '<' + link_github + '|' + 'connect to your github account' +'>'
    var channel = this._getChannelById(message.channel);
    this.postMessageToChannel(channel.name, formatted_link, {as_user: true});
  }
  else if (this._isRepoMessage(message)) {
    this._getRepoNameAndUserId(message, function(hook_params) {
      hook_params.self.slack_controller.storage.users.get(hook_params.slack_id, function(err, user_data) {
        var github_client = github.client(user_data.github_access_token);
        var repo_name = user_data.github_username + '/' + hook_params.repo_name;
        var repo = github_client.repo(repo_name);
        var base = process.env.baseBotUri + '/webhooks/pull-request?slack_team_id=';
        var callback = base + user_data.team_id;
        repo.hook({
          "name": "web",
          "active": true,
          "events": ["pull_request"],
          "config": {
            "url": callback,
            "content_type": "json"
          }
        }, function(err, data, headers) {
          if (typeof data == 'undefined') {
            hook_params.self.postMessageToChannel(hook_params.channel_name, 'Could not find any repo by name: ' + hook_params.repo_name, { as_user: true });
          } else {
            hook_params.self.postMessageToChannel(hook_params.channel_name, 'Slackbot notifications set up for repo: ' + hook_params.repo_name, { as_user: true });
          }
        });
      });
    });
  }
};

DevBot.prototype._getRepoNameAndUserId = function (message, callback) {
  var split_arry = message.text.split(':');
  var hook_params = {
    channel_name: this._getChannelById(message.channel).name,
    repo_name: split_arry[split_arry.length-1],
    slack_id: message.user,
    self: this
  }
  callback(hook_params);
};

DevBot.prototype.slackTeamUsers = function(callback) {
  this.getUsers().always(function(data) {
    callback(data._value.members);
  });
}

DevBot.prototype.sendPrMessage = function(slackUserArray, prBody) {
  if (slackUserArray.length > 0) {
    for (var i = 0; i < slackUserArray.length; i++) {
      this.postMessageToUser(slackUserArray[i].user, prBody, function(data) {
        console.log(data);
      });
    }
  } else {
    return null;
  }
};

DevBot.prototype._loadBotUser = function () {
  var self = this;
  this.user = this.users.filter(function (user) {
    return user.id === self.settings.bot_id;
  })[0];
};

DevBot.prototype._isChatMessage = function (message) {
  return message.type === 'message' && Boolean(message.text);
};

DevBot.prototype._isChannelConversation = function (message) {
  return typeof message.channel === 'string' &&
    message.channel[0] === 'C'
    ;
};

DevBot.prototype._isFromDevBot = function (message) {
  return message.user === this.user.id;
};

DevBot.prototype._getChannelById = function (channelId) {
  return this.channels.filter(function (item) {
    return item.id === channelId;
  })[0];
};

DevBot.prototype._isRepoMessage = function (message) {
  if (typeof message.text == 'string') {
    return message.text.indexOf('repo:') > -1;
  } else {
    return false;
  }
}

DevBot.prototype._isGithubMessage = function (message) {
  if (typeof message.text == 'string') {
    return message.text == 'login to github';
  } else {
    return false;
  }
}

module.exports = DevBot;
