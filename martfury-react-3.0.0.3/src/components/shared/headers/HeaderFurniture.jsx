import React, { useEffect } from 'react';
import Link from 'next/link';
import menuData from '~/public/static/data/menu';
import CurrencyDropdown from '~/components/shared/headers/modules/CurrencyDropdown';
import LanguageSwicher from '~/components/shared/headers/modules/LanguageSwicher';
import SearchHeader from '~/components/shared/headers/modules/SearchHeader';
import ElectronicHeaderActions from '~/components/shared/headers/modules/ElectronicHeaderActions';
import DefaultMenu from '~/components/elements/menu/DefaultMenu';
import { stickyHeader } from '~/utilities/common-helpers';

const HeaderFurniture = () => {
    useEffect(() => {
        if (process.browser) {
            window.addEventListener('scroll', stickyHeader);
        }
    }, []);

    return (
        <header className="header header--furniture" id="headerSticky">
            <div className="header__top">
                <div className="container">
                    <div className="header__left">
                        <Link href="/home/furniture" className="ps-logo">
                            <img
                                src="/static/img/logo-furniture.png"
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
                                    data={menuData.product_categories}
                                    className="menu--dropdown"
                                />
                            </div>
                        </div>
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
                        <DefaultMenu
                            source={menuData.menuPrimary.menu_1}
                            className="menu menu--furniture"
                        />
                    </div>
                    <div className="navigation__right">
                        <ul className="navigation__extra">
                            <li>
                                <Link href="/page/blank">Sell on Martfury</Link>
                            </li>
                            <li>
                                <Link href="/page/blank">Tract your order</Link>
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

export default HeaderFurniture;
