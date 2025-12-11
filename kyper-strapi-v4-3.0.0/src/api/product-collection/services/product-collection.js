'use strict';

/**
 * product-collection service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::product-collection.product-collection');
