'use strict';

/**
 * product-store service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::product-store.product-store');
