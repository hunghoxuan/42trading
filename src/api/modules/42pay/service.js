"use strict";

const { create42PayRepo } = require("./repo");

class Pay42Service {
  constructor(options = {}) {
    this.repo =
      options.repo && typeof options.repo.listProducts === "function"
        ? options.repo
        : create42PayRepo(options);
  }

  getStorageInfo() {
    return this.repo.getStorageInfo();
  }

  migrateLegacySqliteToProvider() {
    return this.repo.migrateLegacySqliteToProvider();
  }

  migrateLegacyActorIds() {
    return this.repo.migrateLegacyActorIds();
  }

  seedInitialData() {
    return this.repo.seedInitialData();
  }

  listProducts(input = {}) {
    return this.repo.listProducts(input);
  }

  upsertProduct(input = {}, options = {}) {
    return this.repo.upsertProduct(input, options);
  }

  listOffers(input = {}) {
    return this.repo.listOffers(input);
  }

  upsertOffer(input = {}, options = {}) {
    return this.repo.upsertOffer(input, options);
  }

  listOrders(input = {}) {
    return this.repo.listOrders(input);
  }

  createOrderFromQrCode(input = {}, options = {}) {
    return this.repo.createOrderFromQrCode(input, options);
  }

  previewOrderFromQrCode(input = {}, options = {}) {
    return this.repo.previewOrderFromQrCode(input, options);
  }

  getWalletSummary(input = {}) {
    return this.repo.getWalletSummary(input);
  }

  listWalletTopups(input = {}) {
    return this.repo.listWalletTopups(input);
  }

  topupWallet(input = {}, options = {}) {
    return this.repo.topupWallet(input, options);
  }

  listAdminUsers(input = {}) {
    return this.repo.listAdminUsers(input);
  }

  getDashboardSummary(input = {}) {
    return this.repo.getDashboardSummary(input);
  }
}

function create42PayService(options = {}) {
  return new Pay42Service(options);
}

module.exports = {
  Pay42Service,
  create42PayService,
};
