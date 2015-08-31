/**
 * Test the behavior of the proxy server.
 */

var http = require('http');
var url = require('url');
var qs = require('querystring');
var request = require('request');
var should = require('should');
var proxy = require('../index');

const TEST_PORT = 54345;

describe('proxy', function () {
  
  describe('handleBody', function () {

    before(function (done) {
      this.testFlag = false;
      this.testData = 'argument1=hello&argument2=world';
      this.recvData= '';
      var thisInit= this;
      // Set up a server that will provide some indication that the handler was
      // called and will give us access to what handleBody produces.
      this.server = http.createServer(function (req, res) {
        proxy.handleBody(req, function (err, data) {
          should.not.exist(err);
          thisInit.recvData += data;
          thisInit.testFlag = true;
          res.end();
        });
      }).listen(TEST_PORT);
      done();
    });

    it('should produce the body of a request', function (done) {
      var thisTest = this;
      request({
        url: 'http://localhost:' + TEST_PORT,
        method: 'post',
        body: thisTest.testData
      }, function (err, response, body) {
        should.not.exist(err);
        response.statusCode.should.be.exactly(200);
        thisTest.testFlag.should.be.true;
        thisTest.recvData.should.be.type('string');
        thisTest.recvData.should.be.eql(thisTest.testData);
        done();
      });
    });

    after(function () {
      this.server.close();
    });
  });

  describe('reportError', function () {

    before(function (done) {
      this.testFlag = false;
      this.errorMessage = 'Error1234';
      var thisInitializer = this;
      // Set up a server that will provide indication that the handler was called.
      this.server = http.createServer(function (req, res) {
        thisInitializer.testFlag = true;
        proxy.reportError(res, new Error(thisInitializer.errorMessage));
      }).listen(TEST_PORT);
      done();
    });

    it('should write an error to the requestor and set statusCode to 500', function (done) {
      var thisTest = this;
      request('http://localhost:' + TEST_PORT, function (err, response, body) {
        should.not.exist(err);
        response.statusCode.should.be.exactly(500);
        thisTest.testFlag.should.be.true;
        body.toString().should.be.exactly(thisTest.errorMessage);
        done();
      });
    });

    after(function () {
      this.server.close();
    });
  });

  describe('forwardRequest', function () {

    before(function (done) {
      this.server = http.createServer(function (req, res) {
        // Send requests to http://localhost:TEST_PORT?url=<url>
        var uri = qs.parse(url.parse(req.url).query).url;
        proxy.forwardRequest(res, {url: uri});
      }).listen(TEST_PORT);
      done();
    });

    it('should write an error for requests that fail', function (done) {
      request('http://localhost:' + TEST_PORT + '?url=adhfadgf234', function (err, res, body) {
        should.not.exist(err); // This request won't fail, but the response will be an error
        res.statusCode.should.be.exactly(500);
        done();
      });
    });

    it('should write back whatever it receives', function (done) {
      request('http://localhost:' + TEST_PORT + '?url=https://google.com', function (err, res, body) {
        should.not.exist(err);
        res.statusCode.should.be.exactly(200);
        res.headers.should.have.property('content-type');
        res.headers['content-type'].indexOf('text/html').should.be.exactly(0);
        done();
      });
    });

    after(function () {
      this.server.close();
    });
  });

  describe('proxy', function () {
    
    before(function (done) {
      // Set up a server that will act as the endpoint we want to send a request to.
      // We will set special headers to be tested.
      this.responseBody = 'Hello World! We got the request!';
      this.innerPort = 55555;
      var thisInitializer = this;
      this.endServer = http.createServer(function (req, res) {
        res.setHeader('x-reached-endserver', true);
        res.statusCode = 200;
        // If we get a POST/PUT/PATCH request, use the handleBody function to
        // write it back so that we can be sure it made it here.
        if (['POST', 'PUT', 'PATCH'].indexOf(req.method.toUpperCase()) >= 0) {
          proxy.handleBody(req, function (err, body) {
            res.write(body);
            res.end();
          });
        } else {
          res.write(thisInitializer.responseBody);
          res.end();
        }
      }).listen(this.innerPort); 
      // Also set up a server that will invoke the proxy method for us.
      this.server = http.createServer(proxy.proxy).listen(TEST_PORT);
      done();
    });

    it('should forward headers and content written by the end server', function (done) {
      var thisTest = this;
      request({
        url: 'http://localhost:' + thisTest.innerPort,
        proxy: 'http://localhost:' + TEST_PORT
      }, function (err, response, body) {
        should.not.exist(err);
        response.statusCode.should.be.exactly(200);
        response.headers.should.have.property('x-reached-endserver');
        response.headers['x-reached-endserver'].should.be.true;
        body.toString().should.be.eql(thisTest.responseBody);
        done();
      });
    });

    it('should pass on the body of PUT/POST/PATCH requests', function (done) {
      var thisTest = this;
      var testBody = 'This is the body we expect to be written back by our echo server.';
      request({
        url: 'http://localhost:' + thisTest.innerPort,
        proxy: 'http://localhost:' + TEST_PORT,
        method: 'POST',
        body: testBody
      }, function (err, response, body) {
        should.not.exist(err);
        response.statusCode.should.be.exactly(200);
        response.headers.should.have.property('x-reached-endserver');
        response.headers['x-reached-endserver'].should.be.true;
        body.toString().should.be.eql(testBody);
        done();
      });
    });

    after(function () {
      this.server.close();
      this.endServer.close();
    });
  });
});
