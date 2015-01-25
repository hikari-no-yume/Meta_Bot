'use strict';

var config = require('./config.json'),
    request = require('request').defaults({jar: true}),
    url = require('url'),
    fs = require('fs'),
    _ = require('underscore');
    

var data, thingRecords;
try {
  data = require('./data.json');
  thingRecords = data.thingRecords;
} catch (e) {
  thingRecords = {};
}

function saveData() {
  fs.writeFileSync('data.json', JSON.stringify({
    thingRecords: thingRecords
  }));
}

function mSecs() {
  return (new Date()).getTime();
}

var lastRequest = 0, queue = [], metaThingsSeen = [], badThings = [];

function queueNext() {
  var popped;

  if (popped = queue.pop()) {
    waitRequest(processLink.apply(undefined, popped));
  } else {
    waitRequest(moreLinks);
  }
}

function waitRequest(callback, time) {
  var now = mSecs();

  if (!time) {
    if (now - lastRequest < 3000) {
      time = (3000 - (now - lastRequest));
    } else {
      lastRequest = now;
      callback();
      return;
    }
  }

  console.log('Delay ' + time + 'ms');
  setTimeout(function () {
    lastRequest = mSecs();
    callback();
  }, time);
}

var currentLinkSource = 0, linkSources = [
  'http://www.reddit.com/domain/reddit.com/new/.json',
  'http://www.reddit.com/domain/np.reddit.com/new/.json',
  'http://www.reddit.com/domain/www.reddit.com/new/.json'
];

function nextLinkSource() {
  currentLinkSource = (currentLinkSource + 1) % linkSources.length;
  console.log('Link source: ' + linkSources[currentLinkSource]);
  return linkSources[currentLinkSource];
}

var robots = {
    "comments-only": {},
    "posts-only": {},
    "disallowed": {},
    "permission": {}
};

function getRobots() {
    waitRequest(function () {
      request({
        uri: 'http://www.reddit.com/r/Bottiquette/wiki/robots_txt_json.json',
        method: 'GET',
        headers: {
          'User-Agent': config.userAgent
        }
      }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          console.log('All good for get robots');
          var data = JSON.parse(body);
          data = JSON.parse(data.data.content_md);
          for (var key in data) {
             if (data.hasOwnProperty(key)) {
                robots[key] = {};
                data[key].forEach(function (subreddit) {
                  robots[key][subreddit.toLowerCase()] = null;
                });
             }
          }
          console.dir(robots);
          console.log('Loaded robots');
        } else {
          console.log('Things bad for robots, panic!');
        }
        console.log('Will re-fetch robots in ~1hr');
        waitRequest(getRobots, 60 * 60 * 1000);
      });
    });
}

getRobots();

waitRequest(function () {
  request({
    uri: 'http://www.reddit.com/api/login',
    method: 'POST',
    headers: {
      'User-Agent': config.userAgent
    },
    form: {
      user: config.username,
      passwd: config.password,
      rem: 'False'
    }
  }, function (error, response) {
    if (!error && response.statusCode == 200) {
      console.log('All good for login');
      waitRequest(moreLinks);
    } else {
      console.log('Things bad for login');
    }
  });
});

function moreLinks() {
  request({
    uri: nextLinkSource(),
    method: 'GET',
    headers: {
      'User-Agent': config.userAgent
    }
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      console.log('All good for get new meta-links');
      process(JSON.parse(body));
    } else {
      if (response && response.statusCode >= 500 && response.statusCode < 600) {
        console.log('Get new meta-links was ' + response.statusCode + ', retrying');
        waitRequest(moreLinks);
      } else if (response) {
        console.log('Things bad for get new meta-links');
        console.log(response.statusCode + ', ' + error);
      } else {
        console.log('Things bad for get new meta-links');
        console.log(error);
      }
    }
  });
}

function getDataForURL(input) {
  var parsed, matched;

  parsed = url.parse(input);
  matched = parsed.pathname.match(/^\/r\/[a-zA-Z0-9]+\/comments\/([a-z0-9]+)\/[a-z0-9_]+\/([a-z0-9]+)?$/);

  if (matched && matched[2]) {
    return {
      thingID: 't1_' + matched[2],
      thingURL: parsed.pathname
    };
  } else if (matched) {
    return {
      thingID: 't3_' + matched[1],
      thingURL: parsed.pathname
    };
  } else {
    return null;
  }
}

function processLink(queue, metaThingTitle, metaThingSubreddit, metaThingURL, metaThingID, thingURL, thingID) {
  return (function () {        
    var thingSubreddit = thingURL.split('/')[2].toLowerCase();
    if (robots['posts-only'].hasOwnProperty(thingSubreddit)
      || robots['permission'].hasOwnProperty(thingSubreddit)
      || robots['disallowed'].hasOwnProperty(thingSubreddit)
    ) {
      console.log('Skipping ' + thingID + ', robots disallows posts to /r/' + thingSubreddit);
      queueNext();
      return;
    }
    request({
      uri: 'http://www.reddit.com' + thingURL + '.json',
      method: 'GET',
      headers: {
        'User-Agent': config.userAgent
      }
    }, function (error, response, body) {
      var popped, page, record, comment, edit = false, options, numSubreddits;

      if (!error && response.statusCode == 200) {
        console.log('All good for fetching ' + thingID);

        page = JSON.parse(body);

        if (thingRecords.hasOwnProperty(thingID)) {
          if (!thingRecords[thingID].hasOwnProperty('commentID')) {
            console.log('ERROR! ' + thingID + ' lacks commentID! - ' + thingURL);
            return;
          }
          record = {
            thingID: thingRecords[thingID].thingID,
            thingURL: thingRecords[thingID].thingURL,
            metaThings: thingRecords[thingID].metaThings.slice(0),
            commentID: thingRecords[thingID].commentID
          };
          record.metaThings.push({
            thingID: metaThingID,
            thingURL: metaThingURL,
            subreddit: metaThingSubreddit,
            title: metaThingTitle
          });
          edit = true;
        } else {
          record = {
            thingID: thingID,
            thingURL: thingURL,
            metaThings: [
              {
                thingID: metaThingID,
                thingURL: metaThingURL,
                subreddit: metaThingSubreddit,
                title: metaThingTitle
              }
            ]
          };
          edit = false;
        }

        numSubreddits = _.uniq(_.pluck(record.metaThings, 'subreddit')).length;
        if (numSubreddits === 1) {
            comment = 'Someone submitted a link to this ' + (thingID[1] === '1' ? 'comment' : 'submission') + ' in the following subreddit:\n\n';
        } else {
            comment = 'Links to this ' + (thingID[1] === '1' ? 'comment' : 'submission') + ' have been submitted to ' + numSubreddits + ' subreddits:\n\n';
        }
            
        record.metaThings.forEach(function (metaThing) {
          // create np.reddit.com version
          var url = 'https://np.reddit.com' + metaThing.thingURL;
          comment += '* /r/' + metaThing.subreddit + ': [' + metaThing.title + '](' + url + ')\n';
        });
        comment += '\n----\n' + config.description;

        if (edit) {
          options = {
            uri: 'http://www.reddit.com/api/editusertext?api_type=json',
            method: 'POST',
            headers: {
              'User-Agent': config.userAgent,
              'X-Modhash': page[0].data.modhash
            },
            form: {
              text: comment,
              thing_id: record.commentID,
            }
          };
        } else {
          options = {
            uri: 'http://www.reddit.com/api/comment?api_type=json',
            method: 'POST',
            headers: {
              'User-Agent': config.userAgent,
              'X-Modhash': page[0].data.modhash
            },
            form: {
              text: comment,
              thing_id: thingID,
            }
          };
        }

        waitRequest(function () {
          request(options, function (error, response, body) {
            if (!error && response.statusCode === 200) {
              body = JSON.parse(body);
              if (!body.json.errors.length) {
                if (!edit) {
                  record.commentID = body.json.data.things[0].data.id;
                  if (!record.commentID) {
                    console.log('Invalid comment ID gotten: ' + record.commentID);
                    console.dir(body.json.data.things[0].data);
                    return;
                  }
                  console.log('Commented on ' + thingID);
                } else {
                  console.log('Updated comment on ' + thingID);
                }
                thingRecords[thingID] = record;
                saveData();

                queueNext();
              } else {
                if (body.json.errors[0][0] === "RATELIMIT") {
                  console.log(thingID + ' (meta: ' + metaThingSubreddit + ') rate limited (' + body.json.ratelimit + 's), postponing until appropriate time');
                  waitRequest(function () {
                    queue.push([queue, metaThingTitle, metaThingSubreddit, metaThingURL, metaThingID, thingURL, thingID]);
                  }, body.json.ratelimit * 1000);
                  queueNext();
                } else if (body.json.errors[0][0] === "DELETED_LINK" || body.json.errors[0][0] === "DELETED_COMMENT") {
                  console.log(thingID + ' was deleted, marking BAD and  moving on...');
                  badThings.push(thingID);
                  saveData();
                  queueNext();
                } else if (body.json.errors[0][0] === "TOO_OLD") {
                  console.log(thingID + ' was too old, marking BAD and  moving on...');
                  badThings.push(thingID);
                  saveData();
                  queueNext();
                } else if (body.json.errors[0][0] === "NOT_AUTHOR") {
                  console.log('Not author of ' + thingID + ' comment ' + record.commentID + '??');
                  return;
                } else {
                  console.log('Error posting/editing comment: ' + body.json.errors);
                  return;
                }
              }
            } else {
              if (response && response.statusCode >= 400 && response.statusCode < 500) {
                console.log(thingID + ' was ' + response.statusCode + ', marking BAD and moving on: ' + thingURL);
                badThings.push(thingID);
                saveData();
                queueNext();
              } else if (response && response.statusCode >= 500 && response.statusCode < 600) {
                console.log(thingID + ' was ' + response.statusCode + ', retrying');
                waitRequest(processLink(queue, metaThingTitle, metaThingSubreddit, metaThingURL, metaThingID, thingURL, thingID));
              } else if (response) {
                console.log('Error posting/editing comment: ' + response.statusCode + ', ' + error);
                return;
              } else {
                console.log('Error posting/editing comment: ' + error);
                return;
              }
            }
          });
        });
      } else {
        if (response && response.statusCode >= 500 && response.statusCode < 600) {
          console.log(thingID + ' was ' + response.statusCode + ', internal server error, retrying');
          waitRequest(processLink(queue, metaThingTitle, metaThingSubreddit, metaThingURL, metaThingID, thingURL, thingID));
        } else if (response && response.statusCode >= 400 && response.statusCode < 500) {
          console.log(thingID + ' was ' + response.statusCode + ', marking BAD and moving on: ' + thingURL);
          badThings.push(thingID);
          queueNext();
        } else if (response) {
          console.log('Error fetching ' + thingID + ': ' + response.statusCode + ', ' + error);
        } else {
          console.log('Error fetching ' + thingID + ': ' + error);
        }
      }
    });
  });
}

function process(obj) {
  obj.data.children.forEach(function (child) {
    var data = child.data, thingData;

    if (!_.contains(metaThingsSeen, data.name)) {
      console.log('Haven\'t seen ' + data.name + ' (' + data.subreddit + ')');
      metaThingsSeen.push(data.name);
      thingData = getDataForURL(data.url);
      if (!thingData) {
        console.log('Rejected non-comment/submission: ' + data.url);
        return;
      } else if (_.contains(badThings, thingData.thingID)) {
        console.log('Rejected known bad thing: ' + data.url);
        return;
      } else if (_.contains(config.subredditBlacklist, data.subreddit.toLowerCase())) {
        console.log('Rejected thing from blacklisted subreddit (' + data.subreddit + '): ' + data.url);
        return;
      } else if (_.contains(config.usernameBlacklist, data.author.toLowerCase())) {
        console.log('Rejected thing from blacklisted username (' + data.author + '): ' + data.url);
        return;
      // if meta thing already seen
      } else if (thingRecords.hasOwnProperty(thingData.thingID) && _.contains(_.pluck(thingRecords[thingData.thingID].metaThings, 'thingID'), data.name)) {
        console.log('Rejected already known of meta thing ' + data.name + ': ' +  data.permalink);
        return;
      }
      queue.push([queue, data.title, data.subreddit, data.permalink, data.name, thingData.thingURL, thingData.thingID]);
    }
  });
  queueNext();
}
