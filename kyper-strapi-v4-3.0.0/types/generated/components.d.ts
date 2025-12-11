import type { Schema, Attribute } from '@strapi/strapi';

export interface ImageComponentImageComponent extends Schema.Component {
  collectionName: 'components_image_component_image_components';
  info: {
    displayName: 'Image Component';
    description: '';
  };
  attributes: {
    image: Attribute.Media & Attribute.Required;
    description: Attribute.String;
  };
}

export interface ProductOptionsAttributes extends Schema.Component {
  collectionName: 'components_product_options_attributes';
  info: {
    displayName: 'attributes';
  };
  attributes: {
    name: Attribute.String;
    default: Attribute.String;
    values: Attribute.Text;
    visible: Attribute.Boolean;
  };
}

export interface ProductOptionsOptions extends Schema.Component {
  collectionName: 'components_product_options_options';
  info: {
    displayName: 'options';
    description: '';
  };
  attributes: {
    name: Attribute.String;
    active: Attribute.Boolean & Attribute.DefaultTo<true>;
    description: Attribute.String;
    value: Attribute.String;
  };
}

declare module '@strapi/types' {
  export module Shared {
    export interface Components {
      'image-component.image-component': ImageComponentImageComponent;
      'product-options.attributes': ProductOptionsAttributes;
      'product-options.options': ProductOptionsOptions;
    }
  }
}
