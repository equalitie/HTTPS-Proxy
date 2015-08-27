/**
 * Test that the HTTPS Rewriter based on HTTPS Everywhere's code works.
 */

var HttpsRewriter = require('../rewriter').HttpsRewriter;
var should = require('should');

const TESTS = {
  'html': '<html><head></head><body><a href="http://reddit.com"><p>Reddit</p></a></body></html>',
  'python code': 'def test():\n\treturn Link("http://google.com")',
  'javascript code': 'document.location.href = "http://reddit.com";',
  'json': '{"url": "http://news.ycombinator.com"}',
  'markdown': 'Read more on [Github](http://github.com)!',
  'raw string': 'http://reddit.com?returnto=index&numberofcats=allofthem'
};

describe('httpsrewriter', function () {

  before(function (done) {
    this.rewriter = new HttpsRewriter();
    done();
  });

  it('should successfully initialize the ruleset library object', function (done) {
    this.rewriter.should.have.property('_rules'); // The RuleSets member object
    this.rewriter._rules.should.have.property('targets'); // An attribute of RuleSets.
    this.rewriter._rules.should.have.property('rewriteURI'); // A method of RuleSets.
    this.rewriter._rules.rewriteURI.should.be.type('function');
    done();
  });
  
  it('should have the process method for modifying web documents', function (done) {
    this.rewriter.should.have.property('process');
    this.rewriter.process.should.be.type('function');
    done();
  });

  it('should produce an document containing an HTTPS URI in place of an existing HTTP URI', function (done) {
    var testCases = Object.keys(TESTS);
    for (var i = 0, len = testCases.length; i < len; i++) {
      var test = TESTS[testCases[i]];
      var rewritten = this.rewriter.process(test);
      rewritten.indexOf('http://').should.be.eql(-1, 'http:// found');
      rewritten.indexOf('https://').should.be.greaterThan(-1, 'https:// not found');
    }
    done();
  });
});
