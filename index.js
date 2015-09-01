var http = require('http');
var request = require('request');
var config = require('./config');
var HttpsRewriter = require('./rewriter').HttpsRewriter;

// It takes a little time to load up the rulesets so it's probably best
// to just do it once.
console.log('Loading rulesets. Please wait a moment.');
var rewriter = new HttpsRewriter();

// Status code for a redirect.
const STATUS_REDIRECT = 301;

// Generate a set of options to pass to proxied requests.
var requestOptions = {
  followRedirects: config.followRedirects,
  followAllRedirects: config.followAllRedirects,
  maxRedirects: config.maxRedirects,
  strictSSL: config.strictSSL
};
if (config.useProxy) {
  requestOptions.proxy = config.proxy;
}
if (config.useTunnel) {
  requestOptions.tunnel = config.tunnel;
}

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
    var newRequest = request.defaults(requestOptions)(req.url);
    req.pipe(newRequest);
    newRequest.pipe(res);
  }
}).listen(config.port, config.address);

console.log('Server ready - Listening on http://' + config.address + ':' + config.port);
console.log('Remember to only set the HTTP proxy setting in your browser.');
