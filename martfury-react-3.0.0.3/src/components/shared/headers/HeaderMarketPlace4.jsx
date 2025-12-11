import React, { useEffect } from 'react';
import Link from 'next/link';
import menuData from '~/public/static/data/menu';
import CurrencyDropdown from '~/components/shared/headers/modules/CurrencyDropdown';
import LanguageSwicher from '~/components/shared/headers/modules/LanguageSwicher';
import SearchHeader from '~/components/shared/headers/modules/SearchHeader';
import ElectronicHeaderActions from '~/components/shared/headers/modules/ElectronicHeaderActions';
import DefaultMenu from '~/components/elements/menu/DefaultMenu';
import { stickyHeader } from '~/utilities/common-helpers';

const HeaderMarketPlace4 = () => {
    useEffect(() => {
        if (process.browser) {
            window.addEventListener('scroll', stickyHeader);
        }
    }, []);

    return (
        <header
            className="header header--standard header--market-place-4"
            id="headerSticky">
            <div className="header__top">
                <div className="container">
                    <div className="header__left">
                        <p>Welcome to Martfury Online Shopping Store !</p>
                    </div>
                    <div className="header__right">
                        <ul className="header__top-links">
                            <li>
                                <Link href="/vendor/store-list">
                                    Store Location
                                </Link>
                            </li>
                            <li>
                                <Link href="/page/blank">Track Your Order</Link>
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
            </div>
            <div className="header__content">
                <div className="container">
                    <div className="header__content-left">
                        <Link href="/home/market-place-4" className="ps-logo">
                            <img
                                src="/static/img/logo_light.png"
                                alt="martfury"
                            />
                        </Link>
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
                    </div>
                    <div className="header__content-center">
                        <SearchHeader />
                        <p>
                            <Link href={'/shop'}>iphone x</Link>
                            <Link href={'/shop'}>virtual</Link>
                            <Link href={'/shop'}>apple</Link>
                            <Link href={'/shop'}>wireless</Link>
                            <Link href={'/shop'}>simple chair</Link>
                            <Link href={'/shop'}>classic watch</Link>
                            <Link href={'/shop'}>macbook</Link>
                        </p>
                    </div>
                    <div className="header__content-right">
                        <ElectronicHeaderActions />
                    </div>
                </div>
            </div>
        </header>
    );
};

export default HeaderMarketPlace4;
