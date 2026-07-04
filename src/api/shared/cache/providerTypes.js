"use strict";

const CACHE_PROVIDER_IDS = Object.freeze({
  memory: "memory",
  redis: "redis",
  noop: "noop",
});

module.exports = {
  CACHE_PROVIDER_IDS,
};
