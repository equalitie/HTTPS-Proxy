# HTTPS Proxy

This is a simple proxy server using [request.js](https://github.com/request/request) and
[Node.js](https://nodejs.org/)' builtin [HTTP library](https://nodejs.org/api/http.html)
to rewrite incoming requests for sites using the HTTP protocol to use HTTPS.

It achieves this using the [Electronic Frontier Foundation](https://www.eff.org/)'s
[HTTPS Everywhere](https://github.com/EFForg/https-everywhere) ruleset
([official site](https://www.eff.org/HTTPS-EVERYWHERE)) and part of the codebase.
Below you will find a copy of the licensing information for the HTTPS Everywhere
project.  We ask that you kindly observe and respect existing copyrights and licensing
terms relevant to both the MIT license used by EFF as well as the GNU Affero GPL v0.3
license used by eQualit.ie.

# Using this software

## Dependencies

### Node.js and NPM

You can download Node.js and NPM together directly from the [official site](https://nodejs.org/download/).

### HTTPS Everywhere rulesets

Before you can use HTTPS-Proxy, HTTPS Everywhere's rulesets must first be downloaded and compiled
into a single xml file.  All of this and more is handled automatically with the `fetchrules` script.

```bash
sh tools/fetchrules.sh
```
### Libraries

Next you must install the dependencies HTTPS-Proxy relies on.

```bash
npm install
```

## Configuration

Configuration settings for HTTPS-Proxy are provided in `config.js`. Below are short explanations
for each of the available configuration options.  Note that most of the settings pertain to
options for the [request](https://github.com/request/request) library, which you can read more
about [in the request README](https://github.com/request/request#requestoptions-callback).

* `port` - The port number to have HTTPS-Proxy listen on
* `address` - The IP address HTTPS-Proxy should bind to
* `rewritePages` - Whether or not HTTPS-Proxy should rewrite HTTP URLs to HTTPS in responses it receives
* `aggressive` - When true, HTTPS-Proxy will overwrite URLs in all responses, otherwise only in text (html, css, ...)
* `followRedirect` - Whether or not HTTPS-Proxy should follow a status code 304 redirect
* `followAllRedirects` - Whether HTTPS-Proxy should follow **all** redirects
* `maxRedirects` - The maximum number of redirects HTTPS-Proxy should follow before returning the last response
* `useProxy` - Whether or not HTTPS-Proxy should use another proxy to send requests through
* `proxy` - The URI of the proxy to use. Only applies if `useProxy` is true
* `strictSSL` - Whether or not SSL certificate validity should be strictly enforced
* `useTunnel` - Whether or not HTTPS-Proxy should tunnel CONNECT requests and websocket data
* `tunnel` - The settings for the tunnel

## Running

After you have downloaded the HTTPS Everywhere rulesets, installed the required dependencies,
and changed any configuration settings you'd like, running HTTPS-Proxy is very simple.

```bash
npm start
```

## Testing

HTTPS-Proxy's unit tests can be run from the `HTTPS-Proxy/` directory with the following command:

```bash
npm test
```

### Okay, I know the tests pass, but how do I know I'm secure?

If you would like to verify that HTTPS-Proxy is doing its job and rewriting the URLs of requests you
proxy through it, run the following commands.

```bash
npm start # Start HTTPS-Proxy if you haven't already. Assuming it is still on port 5641
curl -i -x http://127.0.0.1:5641 http://reddit.com > download1
curl -i http://reddit.com > download2
/usr/bin/diff -y download1 download2
```

Sites like Reddit only use HTTPS, so trying to get it using HTTP as in the second `curl` will
not succeed.  When you run `diff`, you should see the headers received from the first request,
rewritten to use HTTPS, on the left, and the headers of the request that wasn't rewritten on
the right.

```
HTTP/1.1 200 OK                                               | HTTP/1.1 301 Moved Permanently
server: cloudflare-nginx                                      | Date: Thu, 27 Aug 2015 21:16:24 GMT
date: Thu, 27 Aug 2015 21:16:17 GMT                           | Transfer-Encoding: chunked
content-type: text/html; charset=UTF-8                        | Connection: keep-alive
transfer-encoding: chunked                                    | Set-Cookie: __cfduid=d49ff83163d2fa4e5151df7c33d3034181440710
connection: close                                             | Location: https://www.reddit.com/
set-cookie: __cfduid=d1e297e4e5de5b53248b2b591758c67db14      | X-Content-Type-Options: nosniff
x-ua-compatible: IE=edge                                      | Server: cloudflare-nginx
x-frame-options: SAMEORIGIN                                   | CF-RAY: 21cacc1b97ca0f9f-YYZ
x-content-type-options: nosniff                               <
x-xss-protection: 1; mode=block                               <
vary: accept-encoding                                         <
cache-control: max-age=0, must-revalidate                     <
x-moose: majestic                                             <
strict-transport-security: max-age=15552000; includeSubD      <
cf-cache-status: EXPIRED                                      <
cf-ray: 21cacbdc5e880fab-YYZ                                  <
```

### That's pretty cool, but what about the links in a page?

If you haven't changed the `rewritePages` configuration option from `true` to `false`,
HTTPS-Proxy will also rewrite any URLs it finds in pages using HTTP to HTTPS where there's
a rule for that URL.  You can test that it's working properly using a simple HTTP server
shipped with [Python](https://docs.python.org/2/library/simplehttpserver.html) and a simple
HTML document contained in the HTTPS-Proxy tests.

Load up two terminals.

In your first terminal:

```bash
npm start& # Start HTTPS-Proxy if you haven't already
cd tests
python -m SimpleHTTPServer 8080
```

In your second terminal:

```html
curl http://127.0.0.1:8080/contentrewrite.html
<!DOCTYPE html>
<html>
  <head>
    <title>HTTPS-Proxy Test</title>
  </head>
  <body>
    <p>
      <a href="http://reddit.com/">This anchor's URL should be rewritten</a>
    </p>
  </body>
</html>

curl -x http://127.0.0.1:5641 http://127.0.0.1:8080/contentrewrite.html
<!DOCTYPE html>
<html>
  <head>
    <title>HTTPS-Proxy Test</title>
  </head>
  <body>
    <p>
      <a href="https://reddit.com/">This anchor's URL should be rewritten</a>
    </p>
  </body>
</html>
```

As you can see, in the output from the first `curl` where we didn't proxy
through HTTPS-Proxy, we just got the contents of `contentrewrite.html` as
they are.  In the second case, we do proxy through HTTPS-Proxy and we can
see that the URL to Reddit in the anchor tag has been rewritten to use HTTPS!

# HTTPS Everywhere license

HTTPS Everwyhere:
Copyright © 2010-2012 Mike Perry <mikeperry@fscked.org>
                      Peter Eckersley <pde@eff.org>
                      and many others
                      (Licensed GPL v2+)

Incorporating code from NoScript,
Copyright © 2004-2007 Giorgio Maone <g.maone@informaction.com>
Licensed GPL v2+

Incorporating code from Convergence
Copyright © Moxie Marlinspike
Licensed GPL v3+

Incorporating code from URI.js
Copyright © Rodney Rehm
Licensed MIT, GPL V3

Incorporating code from js-lru
Copyright © 2010 Rasmus Andersson
Licensed MIT

The build system incorporates code from Python 2.6,
Copyright © 2001-2006 Python Software Foundation
Python Software Foundation License Version 2

Net License:  GPL v3+ (complete tree)
              GPL v2+ (if Moxie's NSS.js is absent)


Text of MIT License:
====================
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
