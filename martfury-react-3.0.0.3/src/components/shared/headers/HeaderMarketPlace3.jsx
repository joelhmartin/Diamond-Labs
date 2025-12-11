import React, { useEffect } from 'react';
import Link from 'next/link';
import menuData from '~/public/static/data/menu';
import CurrencyDropdown from '~/components/shared/headers/modules/CurrencyDropdown';
import LanguageSwicher from '~/components/shared/headers/modules/LanguageSwicher';
import SearchHeader from '~/components/shared/headers/modules/SearchHeader';
import ElectronicHeaderActions from '~/components/shared/headers/modules/ElectronicHeaderActions';
import DefaultMenu from '~/components/elements/menu/DefaultMenu';
import { stickyHeader } from '~/utilities/common-helpers';

const HeaderMarketPlace3 = () => {
    useEffect(() => {
        if (process.browser) {
            window.addEventListener('scroll', stickyHeader);
        }
    }, []);

    return (
        <header className="header header--market-place-3" id="headerSticky">
            <div className="header__top">
                <div className="container">
                    <div className="header__left">
                        <div className="menu--product-categories">
                            <div className="menu__toggle">
                                <i className="icon-menu" />
                                <span> Shop by Department</span>
                            </div>
                            <div className="menu__content">
                                <DefaultMenu
                                    source={menuData.product_categories}
                                    className="menu--dropdown"
                                />
                            </div>
                        </div>
                        <Link href="/home/market-place-3" className="ps-logo">
                            q
                            <img
                                src="/static/img/logo_light.png"
                                alt="martfury"
                            />
                        </Link>
                    </div>
                    <div className="header__center">
                        <SearchHeader />
                    </div>
                    <div className="header__right">
                        <ElectronicHeaderActions />
                    </div>
                </div>
            </div>
            <nav className="navigation">
                <div className="container">
                    <div className="navigation__left">
                        <div className="menu--product-categories">
                            <div className="menu__toggle active">
                                <i className="icon-menu" />
                                <span> Shop by Department</span>
                            </div>
                            <div className="menu__content">
                                <DefaultMenu
                                    source={menuData.product_categories}
                                    className="menu--dropdown"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="navigation__right">
                        <ul className="menu menu--recent-view">
                            <li className="menu-item-has-children">
                                <Link href="/page/blank">
                                    Your Recently Viewed
                                </Link>
                                <div className="navigation__recent-products">
                                    <p>
                                        <Link href="/page/blank">
                                            See all your recently viewed items
                                        </Link>
                                    </p>
                                </div>
                            </li>
                        </ul>
                        <ul className="navigation__extra">
                            <li>
                                <Link href="/vendor/become-a-vendor">
                                    Sell on Martfury
                                </Link>
                            </li>
                            <li>
                                <Link href="/account/order-tracking">
                                    Tract your order
                                </Link>
                            </li>
                            <li>
                                <CurrencyDropdown />
                            </li>
                            <li>
                                <LanguageSwicher />
                            </li>
                        </ul>
                    </div>
                </div>
            </nav>
        </header>
    );
};

export default HeaderMarketPlace3;
