import React from 'react';
import Link from 'next/link';
import DefaultMenu from '../../elements/menu/DefaultMenu';
import menuData from '~/public/static/data/menu';
import CurrencyDropdown from '../headers/modules/CurrencyDropdown';
import LanguageSwicher from '../headers/modules/LanguageSwicher';
import MenuCategoriesDropdown from '~/components/shared/menus/MenuCategoriesDropdown';

export default function DesktopNavigation() {
    return (
        <nav className="navigation">
            <div className="ps-container">
                <div className="navigation__left">
                    <MenuCategoriesDropdown />
                </div>
                <div className="navigation__right">
                    <DefaultMenu
                        source={menuData.menuPrimary.menu_1}
                        className="menu"
                    />
                    <ul className="navigation__extra">
                        <li>
                            <Link href={'/vendor/become-a-vendor'}>
                                Sell on Martfury
                            </Link>
                        </li>
                        <li>
                            <Link href={'/account/order-tracking'}>
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
    );
}
