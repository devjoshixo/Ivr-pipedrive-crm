'use strict';

// Telephony + mapping endpoints (all authenticated with the App Extensions SDK token):
//   POST /api/ivr/click-to-call   { phone }      -> c2c callback (rings the agent)
//   GET  /api/ivr/dids                            -> account DIDs (mapping page)
//   GET  /api/ivr/extensions?did=                 -> extensions on a DID (mapping page)
//   GET  /api/pd/users                            -> Pipedrive users (mapping page)
//   GET  /api/mappings                            -> DID/extension -> user mappings
//   POST /api/mappings            { pdUserId, did, extension }

const express = require('express');
const { resolveIdentity } = require('../pipedrive/requestAuth');
const { lastTen } = require('../phone');

const ok = (data) => ({ success: true, data, error: null });
const fail = (message) => ({ success: false, data: null, error: message });

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {{getIvrToken: Function}} deps.installStore
 * @param {{triggerClickToCall: Function, getDids: Function, getExtensions: Function}} deps.ivrClient
 * @param {{listMappings: Function, getForUser: Function, saveMapping: Function}} deps.mappingStore
 * @param {{getAccessToken: Function}} deps.tokenService
 * @param {{listUsers: Function}} deps.pipedriveClient
 */
function createTelephonyRouter({ config, installStore, ivrClient, mappingStore, tokenService, pipedriveClient, apiKeyStore }) {
  const router = express.Router();
  const jwtSecret = config.pipedrive.jwtSecret || config.pipedrive.clientSecret;

  // Dual auth: API key (server-to-server) or SDK token (in-Pipedrive). Throws -> 401.
  function identify(req) {
    return resolveIdentity(req, { jwtSecret, apiKeyStore });
  }

  async function ivrToken(companyId) {
    const token = await installStore.getIvrToken(companyId);
    if (!token) throw new Error('IVR account is not connected');
    return token;
  }

  // Click-to-call: ring the agent's endpoints (softphone + cell) then bridge the customer.
  router.post('/ivr/click-to-call', async (req, res) => {
    let id;
    try {
      id = await identify(req);
    } catch {
      return res.status(401).json(fail('Unauthorized'));
    }
    const phone = String(req.body?.phone || '').trim();
    if (!phone) return res.status(400).json(fail('phone is required'));

    // DID/extension: explicit overrides, else the mapping for the SDK user (or a
    // pdUserId the API-key caller specifies, since key auth has no user context).
    let did = req.body?.did;
    let ext = req.body?.extNo || req.body?.extension;
    const mapUserId = id.userId || (req.body && req.body.pdUserId);
    if ((!did || !ext) && mapUserId) {
      const m = await mappingStore.getForUser(id.companyId, String(mapUserId));
      if (m) {
        did = did || m.did;
        ext = ext || m.extension;
      }
    }
    if (!did || !ext) {
      return res.status(400).json(fail('No DID/extension mapped for your user — set it on the mapping page'));
    }
    try {
      const token = await ivrToken(id.companyId);
      const result = await ivrClient.triggerClickToCall(token, { did, extNo: ext, phone: lastTen(phone) });
      if (result && result.status && Number(result.status) !== 200) {
        return res.status(502).json(fail(result.message || 'Click-to-call was rejected'));
      }
      return res.json(ok({ recordid: result && result.recordid }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Click-to-call failed:', err.message);
      return res.status(502).json(fail('Could not place the call'));
    }
  });

  router.get('/ivr/dids', async (req, res) => {
    let id;
    try {
      id = await identify(req);
    } catch {
      return res.status(401).json(fail('Unauthorized'));
    }
    try {
      const data = await ivrClient.getDids(await ivrToken(id.companyId));
      return res.json(ok(data));
    } catch (err) {
      return res.status(502).json(fail(err.message));
    }
  });

  router.get('/ivr/extensions', async (req, res) => {
    let id;
    try {
      id = await identify(req);
    } catch {
      return res.status(401).json(fail('Unauthorized'));
    }
    const did = String(req.query.did || '').trim();
    if (!did) return res.status(400).json(fail('did is required'));
    try {
      const data = await ivrClient.getExtensions(await ivrToken(id.companyId), did);
      return res.json(ok(data));
    } catch (err) {
      return res.status(502).json(fail(err.message));
    }
  });

  router.get('/pd/person', async (req, res) => {
    let id;
    try {
      id = await identify(req);
    } catch {
      return res.status(401).json(fail('Unauthorized'));
    }
    const personId = String(req.query.personId || '').trim();
    if (!personId) return res.status(400).json(fail('personId is required'));
    try {
      const { accessToken, apiDomain } = await tokenService.getAccessToken(id.companyId);
      const person = await pipedriveClient.getPerson(apiDomain, accessToken, personId);
      return res.json(ok({ person }));
    } catch {
      return res.status(502).json(fail('Could not load the contact'));
    }
  });

  router.get('/pd/users', async (req, res) => {
    let id;
    try {
      id = await identify(req);
    } catch {
      return res.status(401).json(fail('Unauthorized'));
    }
    try {
      const { accessToken, apiDomain } = await tokenService.getAccessToken(id.companyId);
      const users = await pipedriveClient.listUsers(apiDomain, accessToken);
      return res.json(ok({ users }));
    } catch (err) {
      return res.status(502).json(fail('Could not list users'));
    }
  });

  router.get('/mappings', async (req, res) => {
    let id;
    try {
      id = await identify(req);
    } catch {
      return res.status(401).json(fail('Unauthorized'));
    }
    try {
      const mappings = await mappingStore.listMappings(id.companyId);
      return res.json(ok({ mappings }));
    } catch {
      return res.status(502).json(fail('Could not read mappings'));
    }
  });

  router.post('/mappings', async (req, res) => {
    let id;
    try {
      id = await identify(req);
    } catch {
      return res.status(401).json(fail('Unauthorized'));
    }
    const pdUserId = String(req.body?.pdUserId || '').trim();
    if (!pdUserId) return res.status(400).json(fail('pdUserId is required'));
    try {
      await mappingStore.saveMapping(id.companyId, {
        pdUserId,
        did: req.body?.did || null,
        extension: req.body?.extension || null,
      });
      return res.json(ok({ saved: true }));
    } catch {
      return res.status(502).json(fail('Could not save the mapping'));
    }
  });

  return router;
}

module.exports = { createTelephonyRouter };
