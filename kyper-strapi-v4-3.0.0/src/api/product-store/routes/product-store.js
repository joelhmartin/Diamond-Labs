'use strict';

/**
 * product-store router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::product-store.product-store');
