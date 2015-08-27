/**
 * A simple proxy server for handling simple HTTP requests to convert them to use HTTPS
 * using EFF's HTTPS Everywhere (https://www.eff.org/Https-everywhere)
 * rulesets.  This code is based in part on HTTPS Everywhere's own rewriter
 * (https://github.com/EFForg/https-everywhere/blob/master/rewriter/rewriter.js)
 *
 * From the HTTPS Everywhere LICENSE.txt
 * HTTPS Everwyhere:
 * Copyright © 2010-2012 Mike Perry <mikeperry@fscked.org>
 *                     Peter Eckersley <pde@eff.org>
 *                     and many others
 *                     (Licensed GPL v2+)
 *
 * Incorporating code from NoScript,
 * Copyright © 2004-2007 Giorgio Maone <g.maone@informaction.com>
 * Licensed GPL v2+
 *
 * Incorporating code from Convergence
 * Copyright © Moxie Marlinspike
 * Licensed GPL v3+
 *
 * Incorporating code from URI.js
 * Copyright © Rodney Rehm
 * Licensed MIT, GPL V3
 * 
 * Incorporating code from js-lru
 * Copyright © 2010 Rasmus Andersson
 * Licensed MIT
 *
 * The build system incorporates code from Python 2.6,
 * Copyright © 2001-2006 Python Software Foundation
 * Python Software Foundation License Version 2
 *
 * Net License:  GPL v3+ (complete tree)
 *               GPL v2+ (if Moxie's NSS.js is absent)
 *
 *
 * Text of MIT License:
 * ====================
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

var fs = require('fs');
var path = require('path');
var DOMParser = require('xmldom').DOMParser;
var URI = require('URIjs');

// The compiled rulesets XML file
// run `ceno/tools/fetchrules.sh` from the `ceno` directory if you haven't
// already done so.
const RULESET_FILE = 'httpse.rulesets';

/**
 * Overwrite the default URI find_uri_expression with a modified one that
 * mitigates a catastrophic backtracking issue common in CSS.
 * The workaround was to insist that URLs start with http, since those are the
 * only ones we want to rewrite anyhow. Note that this may still go exponential
 * on certain inputs. http://www.regular-expressions.info/catastrophic.html
 * Example string that blows up URI.withinString:
 *  image:url(http://img.youtube.com/vi/x7f
 */
URI.find_uri_expression = /\b((?:http:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+)+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))/ig;

// Copied from https://github.com/EFForg/https-everywhere/blob/master/chromium/rules.js
// Stubs so this runs under nodejs. They get overwritten later by util.js
var DBUG = 1;
function log(){};

/**
 * A single rule
 * @param from
 * @param to
 * @constructor
 */
function Rule(from, to) {
  //this.from = from;
  this.to = to;
  this.from_c = new RegExp(from);
}

/**
 * Regex-Compile a pattern
 * @param pattern The pattern to compile
 * @constructor
 */
function Exclusion(pattern) {
  //this.pattern = pattern;
  this.pattern_c = new RegExp(pattern);
}

/**
 * Generates a CookieRule
 * @param host The host regex to compile
 * @param cookiename The cookie name Regex to compile
 * @constructor
 */
function CookieRule(host, cookiename) {
  this.host = host;
  this.host_c = new RegExp(host);
  this.name = cookiename;
  this.name_c = new RegExp(cookiename);
}

/**
 *A collection of rules
 * @param set_name The name of this set
 * @param match_rule Quick test match rule
 * @param default_state activity state
 * @param note Note will be displayed in popup
 * @constructor
 */
function RuleSet(set_name, match_rule, default_state, note) {
  this.name = set_name;
  if (match_rule)
    this.ruleset_match_c = new RegExp(match_rule);
  else
    this.ruleset_match_c = null;
  this.rules = [];
  this.exclusions = [];
  this.targets = [];
  this.cookierules = [];
  this.active = default_state;
  this.default_state = default_state;
  this.note = note;
}

RuleSet.prototype = {
  /**
   * Check if a URI can be rewritten and rewrite it
   * @param urispec The uri to rewrite
   * @returns {*} null or the rewritten uri
   */
  apply: function(urispec) {
    var returl = null;
    // If we're covered by an exclusion, go home
    for(var i = 0; i < this.exclusions.length; ++i) {
      if (this.exclusions[i].pattern_c.test(urispec)) {
        log(DBUG,"excluded uri " + urispec);
        return null;
      }
    }
    // If a ruleset has a match_rule and it fails, go no further
    if (this.ruleset_match_c && !this.ruleset_match_c.test(urispec)) {
      log(VERB, "ruleset_match_c excluded " + urispec);
      return null;
    }

    // Okay, now find the first rule that triggers
    for(var i = 0; i < this.rules.length; ++i) {
      returl = urispec.replace(this.rules[i].from_c,
                               this.rules[i].to);
      if (returl != urispec) {
        return returl;
      }
    }
    if (this.ruleset_match_c) {
      // This is not an error, because we do not insist the matchrule
      // precisely describes to target space of URLs ot redirected
      log(DBUG,"Ruleset "+this.name
              +" had an applicable match-rule but no matching rules");
    }
    return null;
  }

};

/**
 * Initialize Rule Sets
 * @param userAgent The browser's user agent
 * @param cache a cache object (lru)
 * @param ruleActiveStates default state for rules
 * @constructor
 */
function RuleSets(userAgent, cache, ruleActiveStates) {
  // Load rules into structure
  var t1 = new Date().getTime();
  this.targets = {};
  this.userAgent = userAgent;

  // A cache for potentiallyApplicableRulesets
  // Size chosen /completely/ arbitrarily.
  this.ruleCache = new cache(1000);

  // A cache for cookie hostnames.
  this.cookieHostCache = new cache(100);

  // A hash of rule name -> active status (true/false).
  this.ruleActiveStates = ruleActiveStates;
}


RuleSets.prototype = {
  /**
   * Iterate through data XML and load rulesets
   */
  addFromXml: function(ruleXml) {
    var sets = ruleXml.getElementsByTagName("ruleset");
    for (var i = 0; i < sets.length; ++i) {
      try {
        this.parseOneRuleset(sets[i]);
      } catch (e) {
        log(WARN, 'Error processing ruleset:' + e);
      }
    }
  },

  /**
   * Return the RegExp for the local platform
   */
  localPlatformRegexp: (function() {
    var isOpera = /(?:OPR|Opera)[\/\s](\d+)(?:\.\d+)/.test(this.userAgent);
    if (isOpera && isOpera.length === 2 && parseInt(isOpera[1]) < 23) {
      // Opera <23 does not have mixed content blocking
      log(DBUG, 'Detected that we are running Opera < 23');
      return new RegExp("chromium|mixedcontent");
    } else {
      log(DBUG, 'Detected that we are running Chrome/Chromium');
      return new RegExp("chromium");
    }
  })(),

  /**
   * Load a user rule
   * @param params
   * @returns {boolean}
   */
  addUserRule : function(params) {
    log(INFO, 'adding new user rule for ' + JSON.stringify(params));
    var new_rule_set = new RuleSet(params.host, null, true, "user rule");
    var new_rule = new Rule(params.urlMatcher, params.redirectTo);
    new_rule_set.rules.push(new_rule);
    if (!(params.host in this.targets)) {
      this.targets[params.host] = [];
    }
    this.ruleCache.remove(params.host);
    // TODO: maybe promote this rule?
    this.targets[params.host].push(new_rule_set);
    if (new_rule_set.name in this.ruleActiveStates) {
      new_rule_set.active = (this.ruleActiveStates[new_rule_set.name] == "true");
    }
    log(INFO, 'done adding rule');
    return true;
  },

  /**
   * Does the loading of a ruleset.
   * @param ruletag The whole <ruleset> tag to parse
   */
  parseOneRuleset: function(ruletag) {
    var default_state = true;
    var note = "";
    if (ruletag.attributes.default_off) {
      default_state = false;
      note += ruletag.attributes.default_off.value + "\n";
    }

    // If a ruleset declares a platform, and we don't match it, treat it as
    // off-by-default
    var platform = ruletag.getAttribute("platform");
    if (platform) {
      if (platform.search(this.localPlatformRegexp) == -1) {
        default_state = false;
      }
      note += "Platform(s): " + platform + "\n";
    }

    var rule_set = new RuleSet(ruletag.getAttribute("name"),
                               ruletag.getAttribute("match_rule"),
                               default_state,
                               note.trim());

    // Read user prefs
    if (rule_set.name in this.ruleActiveStates) {
      rule_set.active = (this.ruleActiveStates[rule_set.name] == "true");
    }

    var rules = ruletag.getElementsByTagName("rule");
    for(var j = 0; j < rules.length; j++) {
      rule_set.rules.push(new Rule(rules[j].getAttribute("from"),
                                    rules[j].getAttribute("to")));
    }

    var exclusions = ruletag.getElementsByTagName("exclusion");
    for(var j = 0; j < exclusions.length; j++) {
      rule_set.exclusions.push(
            new Exclusion(exclusions[j].getAttribute("pattern")));
    }

    var cookierules = ruletag.getElementsByTagName("securecookie");
    for(var j = 0; j < cookierules.length; j++) {
      rule_set.cookierules.push(new CookieRule(cookierules[j].getAttribute("host"),
                                           cookierules[j].getAttribute("name")));
    }

    var targets = ruletag.getElementsByTagName("target");
    for(var j = 0; j < targets.length; j++) {
       var host = targets[j].getAttribute("host");
       if (!(host in this.targets)) {
         this.targets[host] = [];
       }
       this.targets[host].push(rule_set);
    }
  },

  /**
   * Insert any elements from fromList into intoList, if they are not
   * already there.  fromList may be null.
   * @param intoList
   * @param fromList
   */
  setInsert: function(intoList, fromList) {
    if (!fromList) return;
    for (var i = 0; i < fromList.length; i++)
      if (intoList.indexOf(fromList[i]) == -1)
        intoList.push(fromList[i]);
  },

  /**
   * Return a list of rulesets that apply to this host
   * @param host The host to check
   * @returns {*} (empty) list
   */
  potentiallyApplicableRulesets: function(host) {
    // Have we cached this result? If so, return it!
    var cached_item = this.ruleCache.get(host);
    if (cached_item !== undefined) {
        log(DBUG, "Ruleset cache hit for " + host + " items:" + cached_item.length);
        return cached_item;
    }
    log(DBUG, "Ruleset cache miss for " + host);

    var tmp;
    var results = [];
    if (this.targets[host]) {
      // Copy the host targets so we don't modify them.
      results = this.targets[host].slice();
    }

    // Replace each portion of the domain with a * in turn
    var segmented = host.split(".");
    for (var i = 0; i < segmented.length; ++i) {
      tmp = segmented[i];
      segmented[i] = "*";
      this.setInsert(results, this.targets[segmented.join(".")]);
      segmented[i] = tmp;
    }
    // now eat away from the left, with *, so that for x.y.z.google.com we
    // check *.z.google.com and *.google.com (we did *.y.z.google.com above)
    for (var i = 2; i <= segmented.length - 2; ++i) {
      t = "*." + segmented.slice(i,segmented.length).join(".");
      this.setInsert(results, this.targets[t]);
    }
    log(DBUG,"Applicable rules for " + host + ":");
    if (results.length == 0)
      log(DBUG, "  None");
    else
      for (var i = 0; i < results.length; ++i)
        log(DBUG, "  " + results[i].name);

    // Insert results into the ruleset cache
    this.ruleCache.set(host, results);
    return results;
  },

  /**
   * Check to see if the Cookie object c meets any of our cookierule citeria for being marked as secure.
   * knownHttps is true if the context for this cookie being set is known to be https.
   * @param cookie The cookie to test
   * @param knownHttps Is the context for setting this cookie is https ?
   * @returns {*} ruleset or null
   */
  shouldSecureCookie: function(cookie, knownHttps) {
    var hostname = cookie.domain;
    // cookie domain scopes can start with .
    while (hostname.charAt(0) == ".")
      hostname = hostname.slice(1);

    if (!knownHttps && !this.safeToSecureCookie(hostname)) {
        return null;
    }

    var rs = this.potentiallyApplicableRulesets(hostname);
    for (var i = 0; i < rs.length; ++i) {
      var ruleset = rs[i];
      if (ruleset.active) {
        for (var j = 0; j < ruleset.cookierules.length; j++) {
          var cr = ruleset.cookierules[j];
          if (cr.host_c.test(cookie.domain) && cr.name_c.test(cookie.name)) {
            return ruleset;
          }
        }
      }
    }
    return null;
  },

  /**
   * Check if it is secure to secure the cookie (=patch the secure flag in).
   * @param domain The domain of the cookie
   * @returns {*} true or false
   */
  safeToSecureCookie: function(domain) {
    // Check if the domain might be being served over HTTP.  If so, it isn't
    // safe to secure a cookie!  We can't always know this for sure because
    // observing cookie-changed doesn't give us enough context to know the
    // full origin URI.

    // First, if there are any redirect loops on this domain, don't secure
    // cookies.  XXX This is not a very satisfactory heuristic.  Sometimes we
    // would want to secure the cookie anyway, because the URLs that loop are
    // not authenticated or not important.  Also by the time the loop has been
    // observed and the domain blacklisted, a cookie might already have been
    // flagged as secure.

    if (domain in domainBlacklist) {
      log(INFO, "cookies for " + domain + "blacklisted");
      return false;
    }
    var cached_item = this.cookieHostCache.get(domain);
    if (cached_item !== undefined) {
        log(DBUG, "Cookie host cache hit for " + domain);
        return cached_item;
    }
    log(DBUG, "Cookie host cache miss for " + domain);

    // If we passed that test, make up a random URL on the domain, and see if
    // we would HTTPSify that.

    var nonce_path = "/" + Math.random().toString();
    var test_uri = "http://" + domain + nonce_path + nonce_path;

    log(INFO, "Testing securecookie applicability with " + test_uri);
    var rs = this.potentiallyApplicableRulesets(domain);
    for (var i = 0; i < rs.length; ++i) {
      if (!rs[i].active) continue;
      if (rs[i].apply(test_uri)) {
        log(INFO, "Cookie domain could be secured.");
        this.cookieHostCache.set(domain, true);
        return true;
      }
    }
    log(INFO, "Cookie domain could NOT be secured.");
    this.cookieHostCache.set(domain, false);
    return false;
  },

  /**
   * Rewrite an URI
   * @param urispec The uri to rewrite
   * @param host The host of this uri
   * @returns {*} the new uri or null
   */
  rewriteURI: function(urispec, host) {
    var newuri = null;
    var rs = this.potentiallyApplicableRulesets(host);
    for(var i = 0; i < rs.length; ++i) {
      if (rs[i].active && (newuri = rs[i].apply(urispec)))
        return newuri;
    }
    return null;
  }
};

// Copied from https://raw.githubusercontent.com/EFForg/https-everywhere/master/chromium/lru.js
/**
 * A doubly linked list-based Least Recently Used (LRU) cache. Will keep most
 * recently used items while discarding least recently used items when its limit
 * is reached.
 *
 * Licensed under MIT. Copyright (c) 2010 Rasmus Andersson <http://hunch.se/>
 * See README.md for details.
 *
 * Illustration of the design:
 *
 *       entry             entry             entry             entry
 *       ______            ______            ______            ______
 *      | head |.newer => |      |.newer => |      |.newer => | tail |
 *      |  A   |          |  B   |          |  C   |          |  D   |
 *      |______| <= older.|______| <= older.|______| <= older.|______|
 *
 *  removed  <--  <--  <--  <--  <--  <--  <--  <--  <--  <--  <--  added
 */
function LRUCache (limit) {
  // Current size of the cache. (Read-only).
  this.size = 0;
  // Maximum number of items this cache can hold.
  this.limit = limit;
  this._keymap = {};
}

/**
 * Put <value> into the cache associated with <key>. Returns the entry which was
 * removed to make room for the new entry. Otherwise undefined is returned
 * (i.e. if there was enough room already).
 */
LRUCache.prototype.put = function(key, value) {
  var entry = {key:key, value:value};
  // Note: No protection agains replacing, and thus orphan entries. By design.
  this._keymap[key] = entry;
  if (this.tail) {
    // link previous tail to the new tail (entry)
    this.tail.newer = entry;
    entry.older = this.tail;
  } else {
    // we're first in -- yay
    this.head = entry;
  }
  // add new entry to the end of the linked list -- it's now the freshest entry.
  this.tail = entry;
  if (this.size === this.limit) {
    // we hit the limit -- remove the head
    return this.shift();
  } else {
    // increase the size counter
    this.size++;
  }
};

/**
 * Purge the least recently used (oldest) entry from the cache. Returns the
 * removed entry or undefined if the cache was empty.
 *
 * If you need to perform any form of finalization of purged items, this is a
 * good place to do it. Simply override/replace this function:
 *
 *   var c = new LRUCache(123);
 *   c.shift = function() {
 *     var entry = LRUCache.prototype.shift.call(this);
 *     doSomethingWith(entry);
 *     return entry;
 *   }
 */
LRUCache.prototype.shift = function() {
  // todo: handle special case when limit == 1
  var entry = this.head;
  if (entry) {
    if (this.head.newer) {
      this.head = this.head.newer;
      this.head.older = undefined;
    } else {
      this.head = undefined;
    }
    // Remove last strong reference to <entry> and remove links from the purged
    // entry being returned:
    entry.newer = entry.older = undefined;
    // delete is slow, but we need to do this to avoid uncontrollable growth:
    delete this._keymap[entry.key];
  }
  return entry;
};

/**
 * Get and register recent use of <key>. Returns the value associated with <key>
 * or undefined if not in cache.
 */
LRUCache.prototype.get = function(key, returnEntry) {
  // First, find our cache entry
  var entry = this._keymap[key];
  if (entry === undefined) return; // Not cached. Sorry.
  // As <key> was found in the cache, register it as being requested recently
  if (entry === this.tail) {
    // Already the most recenlty used entry, so no need to update the list
    return entry.value;
  }
  // HEAD--------------TAIL
  //   <.older   .newer>
  //  <--- add direction --
  //   A  B  C  <D>  E
  if (entry.newer) {
    if (entry === this.head)
      this.head = entry.newer;
    entry.newer.older = entry.older; // C <-- E.
  }
  if (entry.older)
    entry.older.newer = entry.newer; // C. --> E
  entry.newer = undefined; // D --x
  entry.older = this.tail; // D. --> E
  if (this.tail)
    this.tail.newer = entry; // E. <-- D
  this.tail = entry;
  return returnEntry ? entry : entry.value;
};

// ----------------------------------------------------------------------------
// Following code is optional and can be removed without breaking the core
// functionality.

/**
 * Check if <key> is in the cache without registering recent use. Feasible if
 * you do not want to chage the state of the cache, but only "peek" at it.
 * Returns the entry associated with <key> if found, or undefined if not found.
 */
LRUCache.prototype.find = function(key) {
  return this._keymap[key];
};

/**
 * Update the value of entry with <key>. Returns the old value, or undefined if
 * entry was not in the cache.
 */
LRUCache.prototype.set = function(key, value) {
  var oldvalue, entry = this.get(key, true);
  if (entry) {
    oldvalue = entry.value;
    entry.value = value;
  } else {
    oldvalue = this.put(key, value);
    if (oldvalue) oldvalue = oldvalue.value;
  }
  return oldvalue;
};

/**
 * Remove entry <key> from cache and return its value. Returns undefined if not
 * found.
 */
LRUCache.prototype.remove = function(key) {
  var entry = this._keymap[key];
  if (!entry) return;
  delete this._keymap[entry.key]; // need to do delete unfortunately
  if (entry.newer && entry.older) {
    // relink the older entry with the newer entry
    entry.older.newer = entry.newer;
    entry.newer.older = entry.older;
  } else if (entry.newer) {
    // remove the link to us
    entry.newer.older = undefined;
    // link the newer entry to head
    this.head = entry.newer;
  } else if (entry.older) {
    // remove the link to us
    entry.older.newer = undefined;
    // link the newer entry to head
    this.tail = entry.older;
  } else {// if(entry.older === undefined && entry.newer === undefined) {
    this.head = this.tail = undefined;
  }

  this.size--;
  return entry.value;
};

/** Removes all entries */
LRUCache.prototype.removeAll = function() {
  // This should be safe, as we never expose strong refrences to the outside
  this.head = this.tail = undefined;
  this.size = 0;
  this._keymap = {};
};

/**
 * Return an array containing all keys of entries stored in the cache object, in
 * arbitrary order.
 */
if (typeof Object.keys === 'function') {
  LRUCache.prototype.keys = function() { return Object.keys(this._keymap); };
} else {
  LRUCache.prototype.keys = function() {
    var keys = [];
    for (var k in this._keymap) keys.push(k);
    return keys;
  };
}

/**
 * Call `fun` for each entry. Starting with the newest entry if `desc` is a true
 * value, otherwise starts with the oldest (head) enrty and moves towards the
 * tail.
 *
 * `fun` is called with 3 arguments in the context `context`:
 *   `fun.call(context, Object key, Object value, LRUCache self)`
 */
LRUCache.prototype.forEach = function(fun, context, desc) {
  var entry;
  if (context === true) { desc = true; context = undefined; }
  else if (typeof context !== 'object') context = this;
  if (desc) {
    entry = this.tail;
    while (entry) {
      fun.call(context, entry.key, entry.value, this);
      entry = entry.older;
    }
  } else {
    entry = this.head;
    while (entry) {
      fun.call(context, entry.key, entry.value, this);
      entry = entry.newer;
    }
  }
};

/** Returns a JSON (array) representation */
LRUCache.prototype.toJSON = function() {
  var s = [], entry = this.head;
  while (entry) {
    s.push({key:entry.key.toJSON(), value:entry.value.toJSON()});
    entry = entry.newer;
  }
  return s;
};

/** Returns a String representation */
LRUCache.prototype.toString = function() {
  var s = '', entry = this.head;
  while (entry) {
    s += String(entry.key)+':'+entry.value;
    entry = entry.newer;
    if (entry)
      s += ' < ';
  }
  return s;
};

/**
 * Object containing rulesets and a single method for rewriting the contnent
 * of a provided web page to change HTTP URLs to HTTPS.
 */
function HttpsRewriter() {
  var contents = fs.readFileSync(path.join(__dirname, RULESET_FILE), 'utf-8');
  var xml = new DOMParser().parseFromString(contents, 'text/xml');
  this._rules = new RuleSets('Bundler user agent', LRUCache, {});
  this._rules.addFromXml(xml);
}

/**
 * Rewrite the content of a web page so that URLs with the HTTP protocol
 * are rewritten to use HTTPS.
 * @param {string} pageContent - The raw, utf-8 encoded content of a document
 * @return the raw content of the modified document
 */
HttpsRewriter.prototype.process = function (pageContent) {
  var thisLibrary = this;
  return URI.withinString(pageContent, function (url) {
    var uri = new URI(url);
    if (uri.protocol() !== 'http') {
      return url;
    }
    uri.normalize();
    var rewritten = thisLibrary._rules.rewriteURI(uri.toString(), uri.host());
    if (rewritten) {
      // If the rewrite was just a protocol change, output protocol-relative URIs.
      var rewrittenUri = new URI(rewritten).protocol('http');
      if (rewrittenUri.toString() === uri.toString()) {
        return rewrittenUri.protocol('https').toString();
      } else {
        return rewritten;
      }
    } else {
      return url;
    }
  });
};

module.exports = {
  HttpsRewriter: HttpsRewriter
};
