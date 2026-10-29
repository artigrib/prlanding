import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedPeer, parseCidr, trustedCidrs } from '../src/trusted-proxy.ts';

test('only peers inside the configured subnets or loopback are trusted', () => {
  const cidrs = trustedCidrs({ TRUST_PROXY_CIDRS: '172.30.5.0/24' });
  assert.equal(isTrustedPeer('172.30.5.17', cidrs), true);
  assert.equal(isTrustedPeer('::ffff:172.30.5.1', cidrs), true);
  assert.equal(isTrustedPeer('127.0.0.1', cidrs), true);
  assert.equal(isTrustedPeer('::1', cidrs), true);
  assert.equal(isTrustedPeer('172.30.6.1', cidrs), false);
  assert.equal(isTrustedPeer('203.0.113.9', cidrs), false);
  assert.equal(isTrustedPeer('2001:db8::1', cidrs), false);
  assert.equal(isTrustedPeer(undefined, cidrs), false);
});

test('parseCidr rejects junk', () => {
  assert.equal(parseCidr('300.1.1.1/24'), null);
  assert.equal(parseCidr('10.0.0.0/33'), null);
  assert.deepEqual(parseCidr('10.1.2.3/8'), { net: 0x0a000000, mask: 0xff000000 });
});
