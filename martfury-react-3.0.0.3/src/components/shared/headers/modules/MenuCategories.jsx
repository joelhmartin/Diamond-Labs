import React from 'react';
import menuData from '~/public/static/data/menu.json';
import DefaultMenu from '~/components/elements/menu/DefaultMenu';

const MenuCategories = () => (
    <DefaultMenu
        source={menuData.product_categories}
        className="menu--dropdown"
    />
);

export default MenuCategories;
