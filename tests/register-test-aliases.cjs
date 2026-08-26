const Module = require('node:module');
const path = require('node:path');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  let mappedRequest = request;

  if (request.startsWith('@/')) {
    mappedRequest = path.join(process.cwd(), '.tmp-tests', 'src', request.slice(2));
  } else if (request.startsWith('@shared/')) {
    mappedRequest = path.join(process.cwd(), '.tmp-tests', 'shared', request.slice('@shared/'.length));
  }

  return originalResolveFilename.call(this, mappedRequest, parent, isMain, options);
};
