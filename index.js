var http = require('http');
var request = require('request');
var HttpsRewriter = require('./rewriter').HttpsRewriter;

// It takes a little time to load up the rulesets so it's probably best
// to just do it once.
var rewriter = new HttpsRewriter();

// Status code for a redirect.
const STATUS_REDIRECT = 301;

http.createServer(function (req, res) {
  var newUrl = rewriter.process(req.url);
  console.log(req.url, '=>', newUrl, '[', req.method, ']\n');
  if (newUrl !== req.url) {
    // In the case that we succeeded in rewriting the URL, redirect
    // the user's browser to it so they switch to HTTPS.
    res.statusCode = STATUS_REDIRECT;
    res.setHeader('Location', newUrl);
    res.end();
  } else {
    // If we couldn't find an HTTPS version of a site, then stick
    // to proxying the HTTP request as is.
    var newRequest = request(req.url);
    req.pipe(newRequest);
    newRequest.pipe(res);
  }
}).listen(5641);

console.log('Server ready - Listening on http://127.0.0.1:5641');
