'use strict';

/**
 * product-store controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::product-store.product-store');
