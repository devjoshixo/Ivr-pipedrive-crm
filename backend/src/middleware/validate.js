'use strict';

// Schema validation at the API boundary (Zod). Returns a 400 with a readable
// message on failure; on success replaces req.body / req.query with the parsed
// (coerced) value so handlers get clean, typed input.

const fail = (message) => ({ success: false, data: null, error: message });

function formatIssues(error) {
  return error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
}

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      return res.status(400).json(fail(formatIssues(result.error)));
    }
    req.body = result.data;
    return next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query || {});
    if (!result.success) {
      return res.status(400).json(fail(formatIssues(result.error)));
    }
    req.validatedQuery = result.data;
    return next();
  };
}

module.exports = { validateBody, validateQuery };
