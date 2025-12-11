import React, { useEffect } from 'react';

import Link from 'next/link';
import menuData from '~/public/static/data/menu';
import CurrencyDropdown from '~/components/shared/headers/modules/CurrencyDropdown';
import LanguageSwicher from '~/components/shared/headers/modules/LanguageSwicher';
import SearchHeader from '~/components/shared/headers/modules/SearchHeader';
import ElectronicHeaderActions from '~/components/shared/headers/modules/ElectronicHeaderActions';
import DefaultMenu from '~/components/elements/menu/DefaultMenu';
import { stickyHeader } from '~/utilities/common-helpers';

const HeaderElectronic = () => {
    useEffect(() => {
        if (process.browser) {
            window.addEventListener('scroll', stickyHeader);
        }
    }, []);

    const menuElectronic = [
        {
            text: 'Hot Deal',
            url: '/shop',
            icon: 'icon-star',
        },
        {
            text: 'Home Electronics',
            url: '/shop',
            icon: 'icon-laundry',
        },
        {
            text: 'Computer & Technology',
            url: '/shop',
            icon: 'icon-laptop',
        },
        {
            text: 'Camera & Videos',
            url: '/shop',
            icon: 'icon-camera2',
        },
        {
            text: 'Office Electronics',
            url: '/shop',
            icon: 'icon-surveillance',
        },
    ];
    return (
        <header
            className="header header--standard header--electronic"
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
                        <Link href="/home/electronic" className="ps-logo">
                            <img
                                src="/static/img/logo-electronic.png"
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
                    </div>
                    <div className="header__content-right">
                        <ElectronicHeaderActions />
                    </div>
                </div>
            </div>
            <nav className="navigation">
                <div className="container">
                    <DefaultMenu
                        source={menuElectronic}
                        className="menu menu--electronic"
                    />
                </div>
            </nav>
        </header>
    );
};

export default HeaderElectronic;
