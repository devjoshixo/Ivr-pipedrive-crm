'use strict';

const express = require('express');

function createHealthRouter() {
  const router = express.Router();
  router.get('/healthz', (req, res) => {
    res.json({ success: true, data: { status: 'ok' }, error: null });
  });
  return router;
}

module.exports = { createHealthRouter };
