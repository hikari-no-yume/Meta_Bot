What it is
==========

Meta Bot is a reddit bot that trawls the new queues of the reddit.com, www.reddit.com and np.reddit.com domains on reddit, to find links to submissions to comments. It then comments on those submissions and comments, informing them that they were linked elsewhere on the site.

The live version is [/u/Meta_Bot2](https://www.reddit.com/user/Meta_Bot2).

Setup
=====

Requires node.js.

1. Run `npm install` to install the dependencies.

2. Copy `config.example.json` to `config.json` and edit as appropriate.

3. Run it with `node bot.js`. It's not a daemon, so I'd suggest running it in a `screen` session, and it may crash, so keep an eye on it.
