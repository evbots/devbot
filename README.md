# DevBot

### A helpful Slackbot assistant for developers

#### What does it do?

DevBot will Slack message any member of your Slack org when they are tagged in a pull request on Github.

#### How do I use it?

* Any user can install the bot on your organization by visiting `<root_url>/login`, assuming the user has the correct access rights. The URL will redirect to a slack page asking for permission on your slack organization.
* Any user can interact with DevBot after it is installed. A user can type `login to github` in any public channel, and DevBot will respond with a link to authenticate with Github.
* Any repo owner, after authenticating with Github, can set up repo notifications by typing `repo:<repo name here>` (replacing with the repo name and no brackets). An example would be `repo:devbot`, assuming the user owns a repository named devbot.
* Once repository notifications are setup, DevBot will private message any slack user that has authenticated with Github if they are tagged in a pull request. The message will be the body of the pull request.

#### How do I set it up?

You can deploy DevBot to any hosting service of your choice. Heroku would be the easiest solution.

Copy create a token.js file with the keys defined in token.js.sample with a client ID and client secret from both Github and Slack.

Start the Redis server before running the webserver:
```
redis-server
```

To run the server:
```
npm start
```

To run the server in debug mode:
```
npm run-script debug
```
