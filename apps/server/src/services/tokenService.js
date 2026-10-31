/**
 * Token Cryptography Service
 * Provides Ed25519 signing for booth nodes and verification for all nodes.
 */

const fs = require('fs');
const path = require('path');
const { signTicket, verifyTicket, parseToken } = require('@festpass/shared');
const config = require('../config');
const logger = require('../logger');

let cachedPrivateKey = null;
let cachedPublicKey = null;

function getPrivateKey() {
  if (cachedPrivateKey) return cachedPrivateKey;

  if (config.ed25519PrivateKey) {
    cachedPrivateKey = config.ed25519PrivateKey;
    return cachedPrivateKey;
  }

  // Look for keys/ed25519-private.pem
  let keyPath = path.resolve(process.cwd(), 'keys', 'ed25519-private.pem');
  if (!fs.existsSync(keyPath)) {
    keyPath = path.resolve(__dirname, '../../../../keys', 'ed25519-private.pem');
  }
  if (fs.existsSync(keyPath)) {
    cachedPrivateKey = fs.readFileSync(keyPath, 'utf8');
    return cachedPrivateKey;
  }

  return null;
}

function getPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;

  if (config.ed25519PublicKey) {
    cachedPublicKey = config.ed25519PublicKey;
    return cachedPublicKey;
  }

  // Look for keys/ed25519-public.pem
  let keyPath = path.resolve(process.cwd(), 'keys', 'ed25519-public.pem');
  if (!fs.existsSync(keyPath)) {
    keyPath = path.resolve(__dirname, '../../../../keys', 'ed25519-public.pem');
  }
  if (fs.existsSync(keyPath)) {
    cachedPublicKey = fs.readFileSync(keyPath, 'utf8');
    return cachedPublicKey;
  }

  return null;
}

/**
 * Sign ticket using node's private key (booth nodes only)
 */
function sign(ticketId, eventId) {
  const privateKey = getPrivateKey();
  if (!privateKey) {
    throw new Error('Node does not have an Ed25519 private key configured. Cannot issue tickets.');
  }

  return signTicket({ ticketId, eventId, privateKey });
}

/**
 * Verify ticket token using public key (available to all nodes)
 */
function verify(token) {
  const publicKey = getPublicKey();
  if (!publicKey) {
    logger.warn('No Ed25519 public key configured; attempting verification without key');
    throw new Error('Ed25519 public key is not configured on this node');
  }

  return verifyTicket({ token, publicKey });
}

module.exports = {
  sign,
  verify,
  parseToken,
  getPrivateKey,
  getPublicKey,
};
