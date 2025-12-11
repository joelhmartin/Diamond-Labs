import React from 'react';
import { Drawer } from 'antd';
import PanelMenu from '../panel/PanelMenu';
import PanelCartMobile from '../panel/PanelCartMobile';
import PanelSearch from '../panel/PanelSearch';
import PanelCategories from '../panel/PanelCategories';
import { useBoolean } from 'ahooks';
import cx from 'classnames';

export default function MobileNavigation() {
    const [
        menuDrawer,
        { setTrue: enableMenuDrawer, setFalse: disableMenuDrawer },
    ] = useBoolean(false);

    const [
        cartDrawer,
        { setTrue: enableCartDrawer, setFalse: disableCartDrawer },
    ] = useBoolean(false);
    const [
        searchDrawer,
        { setTrue: enableSearchDrawer, setFalse: disableSearchDrawer },
    ] = useBoolean(false);

    const [
        categoriesDrawer,
        { setTrue: enableCategoriesDrawer, setFalse: disableCategoriesDrawer },
    ] = useBoolean(false);

    return (
        <div className="navigation--bottom-mobile">
            <Drawer
                className="ps-panel--mobile"
                placement="right"
                open={menuDrawer}
                closable={false}
                onClose={disableMenuDrawer}>
                <div className="ps-panel--wrapper">
                    <div className="ps-panel__header">
                        <h3>Menu</h3>
                        <span
                            className="ps-panel__close"
                            onClick={disableMenuDrawer}>
                            <i className="icon-cross" />
                        </span>
                    </div>
                    <div className="ps-panel__content">
                        <PanelMenu />
                    </div>
                </div>
            </Drawer>
            <Drawer
                className="ps-panel--mobile"
                placement="right"
                closable={false}
                open={cartDrawer}
                onClose={disableCartDrawer}>
                <div className="ps-panel--wrapper">
                    <div className="ps-panel__header">
                        <h3>Shopping Cart</h3>
                        <span
                            className="ps-panel__close"
                            onClick={disableCartDrawer}>
                            <i className="icon-cross" />
                        </span>
                    </div>
                    <div className="ps-panel__content">
                        <PanelCartMobile />
                    </div>
                </div>
            </Drawer>
            <Drawer
                className="ps-panel--mobile"
                placement="right"
                closable={false}
                open={searchDrawer}
                onClose={disableSearchDrawer}>
                <div className="ps-panel--wrapper">
                    <div className="ps-panel__header">
                        <h3>Search</h3>
                        <span
                            className="ps-panel__close"
                            onClick={disableSearchDrawer}>
                            <i className="icon-cross" />
                        </span>
                    </div>
                    <div className="ps-panel__content">
                        <PanelSearch />
                    </div>
                </div>
            </Drawer>
            <Drawer
                className="ps-panel--mobile"
                placement="right"
                closable={false}
                open={categoriesDrawer}
                onClose={disableCategoriesDrawer}>
                <div className="ps-panel--wrapper">
                    <div className="ps-panel__header">
                        <h3>Categories</h3>
                        <span
                            className="ps-panel__close"
                            onClick={disableCategoriesDrawer}>
                            <i className="icon-cross" />
                        </span>
                    </div>
                    <div className="ps-panel__content">
                        <PanelCategories />
                    </div>
                </div>
            </Drawer>
            <div className="navigation__content">
                <button
                    className={cx('navigation__item', menuDrawer && 'active')}
                    onClick={enableMenuDrawer}>
                    <i className="icon-menu" />
                    <span> Menu</span>
                </button>
                <button
                    className={cx(
                        'navigation__item',
                        categoriesDrawer && 'active'
                    )}
                    onClick={enableCategoriesDrawer}>
                    <i className="icon-list4" />
                    <span> Categories</span>
                </button>
                <button
                    className={cx('navigation__item', searchDrawer && 'active')}
                    onClick={enableSearchDrawer}>
                    <i className="icon-magnifier" />
                    <span> Search</span>
                </button>
                <button
                    className={cx('navigation__item', cartDrawer && 'active')}
                    onClick={enableCartDrawer}>
                    <i className="icon-bag2" />
                    <span> Cart</span>
                </button>
            </div>
        </div>
    );
}
