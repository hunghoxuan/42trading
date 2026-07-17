"use strict";

const { createTradesRepo } = require("./repo");

class TradesService {
  constructor(options = {}) {
    this.repo =
      options.repo && typeof options.repo.listTrades === "function"
        ? options.repo
        : createTradesRepo(options);
  }

  getStorageInfo() {
    return this.repo.getStorageInfo();
  }

  listTrades(input = {}) {
    return this.repo.listTrades(input);
  }

  getTrade(input = {}) {
    return this.repo.getTrade(input);
  }

  listTradeEvents(input = {}) {
    return this.repo.listTradeEvents(input);
  }

  upsertTrade(input = {}, options = {}) {
    return this.repo.upsertTrade(input, options);
  }

  countTradesByExecutionStatus(input = {}) {
    return this.repo.countTradesByExecutionStatus(input);
  }

  dashboard(input = {}) {
    return this.repo.dashboard(input);
  }

  cloneFromCurrentTrades(input = {}) {
    return this.repo.cloneFromCurrentTrades(input);
  }

  pullLeasedTrades(
    userId,
    accountId,
    maxItems = 1,
    leaseSeconds = 30,
    taskTypeFilter = null,
    options = {},
  ) {
    return this.repo.pullLeasedTrades(
      userId,
      accountId,
      maxItems,
      leaseSeconds,
      taskTypeFilter,
      options,
    );
  }

  pullAndLockNextTask(accountId, options = {}) {
    return this.repo.pullAndLockNextTask(accountId, options);
  }

  ackTrade(userId, accountId, payload = {}, options = {}) {
    return this.repo.ackTrade(userId, accountId, payload, options);
  }

  brokerSyncTrades(userId, accountId, items = [], options = {}) {
    return this.repo.brokerSyncTrades(userId, accountId, items, options);
  }
}

function createTradesService(options = {}) {
  return new TradesService(options);
}

module.exports = {
  TradesService,
  createTradesService,
};
